<?php

namespace Espo\Custom\Classes\Mail;

use Espo\Core\Container;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Log;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\ORM\EntityManager;

/**
 * Servicio encargado de gestionar y enviar los correos de recordatorio
 * automático de citas (24 horas antes y 2 horas antes) para clientes de GAPSSA.
 */
class AppointmentReminderSender
{
    private EntityManager $entityManager;
    /** @var mixed */
    private $mailSender;
    private Config $config;
    private ?Log $log;
    private Container $container;

    public function __construct(Container $container)
    {
        $this->container = $container;
        $this->entityManager = $container->get('entityManager');
        $this->mailSender = $container->get('mailSender');
        $this->config = $container->get('config');
        $this->log = $container->has('log') ? $container->get('log') : null;
    }

    /**
     * Revisa todas las citas activas y despacha los recordatorios de 24h y 2h que correspondan.
     *
     * @return array{sent24h: int, sent2h: int, checked: int}
     */
    public function processPendingReminders(): array
    {
        $nowUtc = time();
        $sent24h = 0;
        $sent2h = 0;
        $checked = 0;

        // Asegurar usuario del sistema en el contenedor para evitar excepciones de ORM/Mail
        $this->ensureSystemUser();

        // Ventana de consulta: citas en las próximas 36 horas
        $windowStart = gmdate('Y-m-d H:i:s', $nowUtc);
        $windowEnd = gmdate('Y-m-d H:i:s', $nowUtc + (36 * 3600));

        try {
            /** @var Meeting[] $meetings */
            $meetings = $this->entityManager->getRDBRepository('Meeting')
                ->where([
                    'dateStart>=' => $windowStart,
                    'dateStart<=' => $windowEnd,
                    'status!=' => ['Held', 'Not Held'],
                ])
                ->find();

            foreach ($meetings as $meeting) {
                $checked++;
                $meetingId = $meeting->getId();
                $cEstado = (string) $meeting->get('cEstadoReserva');

                // Omitir citas canceladas o pendientes de aprobación
                if (in_array($cEstado, ['PendingCenterApproval', 'Canceled', 'NoShow', 'Completed'], true)) {
                    continue;
                }

                $dateStartUtc = $meeting->get('dateStart');
                if (!$dateStartUtc) {
                    continue;
                }

                $startTimestamp = strtotime($dateStartUtc . ' UTC');
                if (!$startTimestamp) {
                    continue;
                }

                $secondsUntilStart = $startTimestamp - $nowUtc;

                // -------------------------------------------------------------
                // 1. Recordatorio 24 horas antes:
                // Se envía cuando faltan entre 2 y 26 horas para la cita
                // y la bandera cRecordatorio24hEnviado es falsa.
                // -------------------------------------------------------------
                $is24hSent = (bool) $meeting->get('cRecordatorio24hEnviado');
                if (!$is24hSent && $secondsUntilStart <= (26 * 3600) && $secondsUntilStart >= (2 * 3600)) {
                    $success = $this->sendReminder($meeting, 'reminder_24h');
                    if ($success) {
                        $meeting->set('cRecordatorio24hEnviado', true);
                        try {
                            $this->entityManager->saveEntity($meeting);
                        } catch (\Throwable $e) {
                            $this->markFlagDirectSql($meetingId, 'c_recordatorio24h_enviado');
                        }
                        $sent24h++;
                    }
                }

                // -------------------------------------------------------------
                // 2. Recordatorio 2 horas antes:
                // Se envía cuando faltan entre 10 minutos y 2 horas y 15 minutos
                // y la bandera cRecordatorio2hEnviado es falsa.
                // -------------------------------------------------------------
                $is2hSent = (bool) $meeting->get('cRecordatorio2hEnviado');
                if (!$is2hSent && $secondsUntilStart <= (2 * 3600 + 900) && $secondsUntilStart >= 600) {
                    $success = $this->sendReminder($meeting, 'reminder_2h');
                    if ($success) {
                        $meeting->set('cRecordatorio2hEnviado', true);
                        try {
                            $this->entityManager->saveEntity($meeting);
                        } catch (\Throwable $e) {
                            $this->markFlagDirectSql($meetingId, 'c_recordatorio2h_enviado');
                        }
                        $sent2h++;
                    }
                }
            }
        } catch (\Throwable $e) {
            $this->logError("Error procesando recordatorios de citas: " . $e->getMessage());
        }

        return [
            'checked' => $checked,
            'sent24h' => $sent24h,
            'sent2h' => $sent2h,
        ];
    }

    /**
     * Envía un recordatorio específico a los contactos asociados a la cita.
     *
     * @param Meeting $meeting
     * @param 'reminder_24h'|'reminder_2h' $templateType
     * @return bool
     */
    public function sendReminder(Meeting $meeting, string $templateType): bool
    {
        $meetingId = $meeting->getId();

        try {
            $this->ensureSystemUser();

            // 1. Obtener contactos de la cita
            $contacts = $this->getMeetingContacts($meeting);
            if (count($contacts) === 0) {
                return false;
            }

            $fromAddress = $this->config->get('outboundEmailFromAddress') ?: 'info@gapssa.es';
            $fromName = $this->config->get('outboundEmailFromName') ?: 'GAPSSA';

            $serviceName = (string) ($meeting->get('name') ?: 'Tratamiento en GAPSSA');
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

                $subject = ($templateType === 'reminder_24h')
                    ? "GAPSSA | Recordatorio: Mañana es tu cita de {$serviceName}"
                    : "GAPSSA | ¡Te esperamos en 2 horas! - {$serviceName}";

                $bodyHtml = $this->renderHtmlTemplate($templateType, [
                    'inviteeName' => htmlspecialchars($clientName, ENT_QUOTES, 'UTF-8'),
                    'name' => htmlspecialchars($serviceName, ENT_QUOTES, 'UTF-8'),
                    'dateStartFull' => $dateFormatted,
                    'timeZone' => 'Europe/Madrid',
                    'assignedUserName' => htmlspecialchars($assignedUserName, ENT_QUOTES, 'UTF-8'),
                    'description' => nl2br(htmlspecialchars($description, ENT_QUOTES, 'UTF-8')),
                ]);

                try {
                    /** @var \Espo\Entities\Email $email */
                    $email = $this->entityManager->getNewEntity('Email');
                    $email->set([
                        'name' => $subject,
                        'subject' => $subject,
                        'body' => $bodyHtml,
                        'isHtml' => true,
                        'from' => $fromAddress,
                        'fromName' => $fromName,
                        'fromString' => "{$fromName} <{$fromAddress}>",
                        'to' => $emailAddress,
                        'toString' => "{$clientName} <{$emailAddress}>",
                        'parentType' => 'Meeting',
                        'parentId' => $meetingId,
                        'dateSent' => date('Y-m-d H:i:s'),
                    ]);

                    @stream_context_set_default([
                        'ssl' => [
                            'verify_peer' => false,
                            'verify_peer_name' => false,
                            'allow_self_signed' => true,
                        ],
                    ]);

                    $this->ensureTlsStreamPrepared();
                    $this->mailSender->send($email);
                    $this->entityManager->saveEntity($email);
                    $sentCount++;

                    $this->logInfo("✔ Recordatorio [{$templateType}] enviado a {$emailAddress} (Cita: {$serviceName}, ID: {$meetingId})");
                } catch (\Throwable $e) {
                    $this->logError("❌ Fallo enviando recordatorio [{$templateType}] a {$emailAddress}: " . $e->getMessage());
                }
            }

            return $sentCount > 0;
        } catch (\Throwable $e) {
            $this->logError("❌ Error en sendReminder para cita {$meetingId}: " . $e->getMessage());
            return false;
        }
    }

    private function getMeetingContacts(Meeting $meeting): array
    {
        $contacts = [];
        try {
            $rel = $this->entityManager->getRelation($meeting, 'contacts')->find();
            foreach ($rel as $c) {
                $contacts[] = $c;
            }
        } catch (\Throwable $e) {}

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
                    $contacts[] = $contact;
                }
            }
        }

        return $contacts;
    }

    private function renderHtmlTemplate(string $templateType, array $params): string
    {
        $baseDir = dirname(__DIR__, 2) . "/Resources/templates/{$templateType}/es_ES/body.tpl";
        $altDir = "/var/www/html/custom/Espo/Custom/Resources/templates/{$templateType}/es_ES/body.tpl";

        $templatePath = file_exists($altDir) ? $altDir : $baseDir;
        $template = file_exists($templatePath) ? file_get_contents($templatePath) : $this->fallbackTemplate($templateType);

        // Bloques condicionales
        $template = preg_replace_callback(
            '/\{\{#if\s+([a-zA-Z0-9_]+)\}\}(.*?)(?:\{\{else\}\}(.*?))?\{\{\/if\}\}/s',
            function ($matches) use ($params) {
                $var = $matches[1];
                $ifPart = $matches[2];
                $elsePart = $matches[3] ?? '';
                $isTrue = !empty($params[$var]);
                return $isTrue ? $ifPart : $elsePart;
            },
            $template
        );

        // Variables
        foreach ($params as $key => $val) {
            if (is_string($val) || is_numeric($val)) {
                $template = str_replace('{{{' . $key . '}}}', (string) $val, $template);
                $template = str_replace('{{' . $key . '}}', (string) $val, $template);
            }
        }

        return preg_replace('/\{\{[#\/]?.*?\}\}/s', '', $template);
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

    private function ensureSystemUser(): void
    {
        if (!$this->container->has('user')) {
            $systemUser = $this->entityManager->getEntity('User', 'system') ?? $this->entityManager->getEntity('User', '1');
            if ($systemUser) {
                if (method_exists($this->container, 'setUser')) {
                    $this->container->setUser($systemUser);
                }
                if (method_exists($this->container, 'set')) {
                    $this->container->set('user', $systemUser);
                }
            }
        }
    }

    private function ensureTlsStreamPrepared(): void
    {
        try {
            $refSender = new \ReflectionClass($this->mailSender);
            if ($refSender->hasProperty("transport")) {
                $transProp = $refSender->getProperty("transport");
                $transProp->setAccessible(true);
                $t = $transProp->getValue($this->mailSender);
                if ($t instanceof \Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport) {
                    $stream = $t->getStream();
                    if ($stream instanceof \Symfony\Component\Mailer\Transport\Smtp\Stream\SocketStream) {
                        $stream->setStreamOptions([
                            'ssl' => [
                                'verify_peer' => false,
                                'verify_peer_name' => false,
                                'allow_self_signed' => true,
                            ],
                        ]);
                    }
                }
            }
        } catch (\Throwable $e) {}
    }

    private function markFlagDirectSql(string $meetingId, string $column): void
    {
        try {
            $pdo = $this->container->has('pdo') ? $this->container->get('pdo') : null;
            if ($pdo) {
                $stmt = $pdo->prepare("UPDATE meeting SET {$column} = 1 WHERE id = ?");
                $stmt->execute([$meetingId]);
            }
        } catch (\Throwable $e) {}
    }

    private function fallbackTemplate(string $templateType): string
    {
        $titulo = ($templateType === 'reminder_24h') ? 'Recordatorio: Mañana es su cita en GAPSSA' : '¡En 2 horas le esperamos en GAPSSA!';
        return "<html><body><h2>{$titulo}</h2><p>Estimado/a {{inviteeName}}, le recordamos su cita para <strong>{{name}}</strong> el día {{dateStartFull}} con {{assignedUserName}}.</p><p>Dirección: Carrer de Gayarre 24, Entresuelo 2, Barcelona. WhatsApp: +34 680 373 663.</p></body></html>";
    }

    private function logInfo(string $msg): void
    {
        echo $msg . "\n";
        if ($this->log) {
            $this->log->info($msg);
        }
    }

    private function logError(string $msg): void
    {
        echo $msg . "\n";
        if ($this->log) {
            $this->log->error($msg);
        }
    }
}
