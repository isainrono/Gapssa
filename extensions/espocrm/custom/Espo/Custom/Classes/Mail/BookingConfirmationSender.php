<?php

namespace Espo\Custom\Classes\Mail;

use Espo\Core\Container;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Log;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\ORM\EntityManager;

/**
 * Servicio encargado de generar y despachar el correo oficial de confirmación
 * de cita al cliente utilizando la plantilla HTML corporativa de GAPSSA
 * desde la cuenta info@gapssa.es.
 */
class BookingConfirmationSender
{
    private EntityManager $entityManager;
    /** @var mixed */
    private $mailSender;
    private Config $config;
    private ?Log $log;

    public function __construct(Container $container)
    {
        $this->entityManager = $container->get('entityManager');
        $this->mailSender = $container->get('mailSender');
        $this->config = $container->get('config');
        $this->log = $container->has('log') ? $container->get('log') : null;
    }

    public function sendConfirmation(Meeting $meeting): bool
    {
        $meetingId = $meeting->getId();

        // 1. Obtener los contactos asociados a la cita
        $contacts = $this->entityManager->getRelation($meeting, Meeting::LINK_CONTACTS)->find();

        // Fallback por parentId / contactId si la relación no devolvió asistentes
        if (count($contacts) === 0) {
            $contactId = null;
            if ($meeting->get('parentType') === 'Contact' && $meeting->get('parentId')) {
                $contactId = (string) $meeting->get('parentId');
            } elseif ($meeting->get('contactId')) {
                $contactId = (string) $meeting->get('contactId');
            }

            if ($contactId) {
                $contact = $this->entityManager->getEntity('Contact', $contactId);
                if ($contact) {
                    $this->entityManager->getRelation($meeting, Meeting::LINK_CONTACTS)->relate($contact);
                    $contacts = [$contact];
                }
            }
        }

        if (count($contacts) === 0) {
            $this->logWarning("No se encontraron contactos destinatarios para la cita: $meetingId");
            return false;
        }

        $fromAddress = $this->config->get('outboundEmailFromAddress') ?: 'info@gapssa.es';
        $fromName = $this->config->get('outboundEmailFromName') ?: 'GAPSSA';

        // 2. Preparar los datos de la cita para la plantilla
        $serviceName = (string) ($meeting->get('name') ?: 'Cita en GAPSSA');
        $dateStart = $meeting->get('dateStart');
        $dateFormatted = $this->formatDateInSpanish($dateStart);
        $assignedUserName = (string) ($meeting->get('assignedUserName') ?: 'Diana Atehortua');
        $description = (string) ($meeting->get('description') ?: '');

        $sentCount = 0;

        foreach ($contacts as $contact) {
            $emailAddress = $contact->getEmailAddress();
            if (!$emailAddress) {
                continue;
            }

            $clientName = (string) ($contact->get('name') ?: 'Estimado/a cliente');

            // 3. Renderizar la plantilla HTML de GAPSSA
            $subject = "GAPSSA | Confirmación de Cita: {$serviceName} - {$dateFormatted}";
            $bodyHtml = $this->renderHtmlTemplate([
                'inviteeName' => htmlspecialchars($clientName, ENT_QUOTES, 'UTF-8'),
                'name' => htmlspecialchars($serviceName, ENT_QUOTES, 'UTF-8'),
                'dateStartFull' => $dateFormatted,
                'timeZone' => 'Europe/Madrid',
                'assignedUserName' => htmlspecialchars($assignedUserName, ENT_QUOTES, 'UTF-8'),
                'description' => nl2br(htmlspecialchars($description, ENT_QUOTES, 'UTF-8')),
                'acceptLink' => "https://gapssa.es",
                'declineLink' => "https://gapssa.es",
                'isAllDay' => false,
                'joinUrl' => null,
                'isUser' => false,
            ]);

            try {
                /** @var \Espo\Entities\Email $email */
                $email = $this->entityManager->getNewEntity('Email');
                $email->set([
                    'name' => $subject,
                    'subject' => $subject,
                    'body' => $bodyHtml,
                    'isHtml' => true,
                    'status' => 'Sent',
                    'from' => "{$fromName} <{$fromAddress}>",
                    'fromString' => "{$fromName} <{$fromAddress}>",
                    'to' => $emailAddress,
                    'toString' => "{$clientName} <{$emailAddress}>",
                    'parentType' => Meeting::ENTITY_TYPE,
                    'parentId' => $meetingId,
                    'dateSent' => date('Y-m-d H:i:s'),
                ]);

                // Establecer stream context para STARTTLS
                @stream_context_set_default([
                    'ssl' => [
                        'verify_peer' => false,
                        'verify_peer_name' => false,
                        'allow_self_signed' => true,
                    ],
                ]);

                $this->mailSender->send($email);
                $this->entityManager->saveEntity($email);
                $sentCount++;

                if ($this->log) {
                    $this->log->info("✔ Confirmación oficial de GAPSSA enviada a {$emailAddress} para la cita {$meetingId}");
                }
            } catch (\Throwable $e) {
                if ($this->log) {
                    $this->log->error("❌ Fallo enviando confirmación a {$emailAddress} para la cita {$meetingId}: " . $e->getMessage());
                }
            }
        }

        return $sentCount > 0;
    }

    private function renderHtmlTemplate(array $params): string
    {
        $templatePath = '/var/www/html/custom/Espo/Custom/Resources/templates/invitation/es_ES/body.tpl';
        if (!file_exists($templatePath)) {
            $templatePath = dirname(__DIR__, 2) . '/Resources/templates/invitation/es_ES/body.tpl';
        }

        $template = file_exists($templatePath) ? file_get_contents($templatePath) : $this->fallbackTemplate();

        // Reemplazo de variables simples {{variable}}
        foreach ($params as $key => $val) {
            if (is_string($val) || is_numeric($val)) {
                $template = str_replace('{{{' . $key . '}}}', (string) $val, $template);
                $template = str_replace('{{' . $key . '}}', (string) $val, $template);
            }
        }

        // Limpieza de bloques condicionales no utilizados
        if (empty($params['joinUrl'])) {
            $template = preg_replace('/\{\{#if joinUrl\}\}.*?\{\{\/if\}\}/s', '', $template);
        }
        if (empty($params['isUser'])) {
            $template = preg_replace('/\{\{#if isUser\}\}.*?\{\{\/if\}\}/s', '', $template);
        }
        if (empty($params['description'])) {
            $template = preg_replace('/\{\{#if description\}\}.*?\{\{\/if\}\}/s', '', $template);
        } else {
            $template = str_replace(['{{#if description}}', '{{/if}}'], '', $template);
        }
        if (empty($params['assignedUserName'])) {
            $template = preg_replace('/\{\{#if assignedUserName\}\}.*?\{\{\/if\}\}/s', '', $template);
        } else {
            $template = str_replace(['{{#if assignedUserName}}', '{{/if}}'], '', $template);
        }

        return $template;
    }

    private function formatDateInSpanish(?string $dateUtc): string
    {
        if (!$dateUtc) {
            return date('d/m/Y H:i');
        }

        try {
            $dt = new \DateTime($dateUtc, new \DateTimeZone('UTC'));
            $dt->setTimezone(new \DateTimeZone('Europe/Madrid'));

            $dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            $meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

            $diaSemana = $dias[(int) $dt->format('w')];
            $dia = $dt->format('j');
            $mes = $meses[(int) $dt->format('n')];
            $ano = $dt->format('Y');
            $hora = $dt->format('H:i');

            return "{$diaSemana}, {$dia} de {$mes} de {$ano} a las {$hora}";
        } catch (\Throwable $e) {
            return $dateUtc;
        }
    }

    private function fallbackTemplate(): string
    {
        return '<html><body><h2>Confirmación de Cita - GAPSSA</h2><p>Estimado/a {{inviteeName}}, le confirmamos su cita para el servicio <strong>{{name}}</strong> el día {{dateStartFull}} con {{assignedUserName}}.</p></body></html>';
    }

    private function logWarning(string $msg): void
    {
        if ($this->log) {
            $this->log->warning($msg);
        }
    }
}
