<?php

/**
 * Google Calendar Sync — BeforeUninstall.
 *
 * Política: la desinstalación NO elimina datos. Las citas, las cuentas
 * GcsAccount, los vínculos GcsEventLink y sus tablas se conservan.
 * Ver docs/UNINSTALL.md para la limpieza manual opcional.
 */
class BeforeUninstall
{
    public function run($container, $params = [])
    {
        // Desactivar el scheduled job para que no queden ejecuciones huérfanas.
        try {
            $entityManager = $container->get('entityManager');

            $job = $entityManager
                ->getRDBRepository('ScheduledJob')
                ->where(['job' => 'GcsPushSweep'])
                ->findOne();

            if ($job) {
                $entityManager->removeEntity($job);
            }
        } catch (\Throwable $e) {
            $container->get('log')->warning('GoogleCalendarSync BeforeUninstall: ' . $e->getMessage());
        }
    }
}
