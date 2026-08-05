<?php

/**
 * Google Calendar Sync — AfterInstall.
 *
 * Idempotente: se vuelve a ejecutar en cada actualización de la extensión
 * (con $params['isUpgrade'] === true). Aquí irán las migraciones futuras.
 */
class AfterInstall
{
    public function run($container, $params = [])
    {
        $config = $container->get('config');
        $entityManager = $container->get('entityManager');
        $injectableFactory = $container->get('injectableFactory');

        // 1. Redirect URI por defecto (editable en Administración).
        if (!$config->get('gcsRedirectUri')) {
            $siteUrl = rtrim((string) $config->get('siteUrl'), '/');

            if ($siteUrl) {
                $configWriter = $injectableFactory
                    ->create(\Espo\Core\Utils\Config\ConfigWriter::class);

                $configWriter->set('gcsRedirectUri', $siteUrl . '/?entryPoint=gcsCallback');
                $configWriter->save();
            }
        }

        // 2. Cuenta Business por defecto (una sola; nunca se duplica).
        try {
            $existing = $entityManager
                ->getRDBRepository('GcsAccount')
                ->where(['type' => 'Business'])
                ->findOne();

            if (!$existing) {
                $account = $entityManager->getNewEntity('GcsAccount');

                $account->set([
                    'name' => $this->translate($container, 'Business Calendar'),
                    'type' => 'Business',
                    'status' => 'Disconnected',
                ]);

                $entityManager->saveEntity($account, ['silent' => true]);
            }
        } catch (\Throwable $e) {
            $container->get('log')->warning('GoogleCalendarSync AfterInstall: ' . $e->getMessage());
        }

        // 3. Scheduled job de barrido (idempotente; el rebuild también lo crea).
        try {
            $job = $entityManager
                ->getRDBRepository('ScheduledJob')
                ->where(['job' => 'GcsPushSweep'])
                ->findOne();

            if (!$job) {
                $job = $entityManager->getNewEntity('ScheduledJob');

                $job->set([
                    'name' => 'Google Calendar Sync — Push Sweep',
                    'job' => 'GcsPushSweep',
                    'status' => 'Active',
                    'scheduling' => '*/5 * * * *',
                ]);

                $entityManager->saveEntity($job);
            }
        } catch (\Throwable $e) {
            $container->get('log')->warning('GoogleCalendarSync AfterInstall: ' . $e->getMessage());
        }
    }

    /**
     * Traduce una etiqueta al idioma por defecto de la instancia.
     * Si la traducción no está disponible, devuelve la etiqueta en inglés.
     */
    private function translate($container, string $label): string
    {
        try {
            $translated = $container->get('defaultLanguage')
                ->translateLabel($label, 'labels', 'GcsAccount');

            if (is_string($translated) && $translated !== '') {
                return $translated;
            }
        } catch (\Throwable $e) {
            // Sin traductor disponible: se usa el inglés.
        }

        return $label;
    }
}
