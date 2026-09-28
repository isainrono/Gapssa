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

    private Container $container;

    public function __construct(Container $container)
    {
        $this->container = $container;
        $this->entityManager = $container->get('entityManager');
        $this->mailSender = $container->get('mailSender');
        $this->config = $container->get('config');
        $this->log = $container->has('log') ? $container->get('log') : null;
    }

    public function sendConfirmation(Meeting $meeting): bool
    {
        $meetingId = $meeting->getId();

        try {
            // Asegurar que hay un usuario activo en el contenedor para evitar 'Could not load user service'
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

            // 1. Obtener los contactos asociados a la cita
            $contacts = $this->entityManager->getRelation($meeting, 'contacts')->find();

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
                        try {
                            $this->entityManager->getRelation($meeting, 'contacts')->relate($contact);
                        } catch (\Throwable $e) {}
                        $contacts = [$contact];
                    }
                }
            }

            // Fallback directo por SQL si ORM relation devolvió 0 contactos
            if (count($contacts) === 0) {
                $pdo = $this->container->has('pdo') ? $this->container->get('pdo') : null;
                if ($pdo) {
                    $stmt = $pdo->prepare("SELECT contact_id FROM meeting_contact WHERE meeting_id = ? AND deleted = 0");
                    $stmt->execute([$meetingId]);
                    $contactIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
                    foreach ($contactIds as $cId) {
                        $c = $this->entityManager->getEntity('Contact', $cId);
                        if ($c) {
                            $contacts[] = $c;
                        }
                    }
                }
            }

            if (count($contacts) === 0) {
                echo "ℹ Cita {$meetingId} ({$meeting->get('name')}): sin contactos asociados.\n";
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
                    echo "ℹ Contacto {$contact->getId()} ({$contact->get('name')}) sin dirección de correo.\n";
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
                        'from' => $fromAddress,
                        'fromName' => $fromName,
                        'fromString' => "{$fromName} <{$fromAddress}>",
                        'to' => $emailAddress,
                        'toString' => "{$clientName} <{$emailAddress}>",
                        'parentType' => 'Meeting',
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

                    $this->ensureTlsStreamPrepared();
                    $this->mailSender->send($email);
                    $this->entityManager->saveEntity($email);
                    $sentCount++;

                    echo "✔ Correo de confirmación oficial enviado a {$emailAddress} para la cita {$serviceName} (ID: {$meetingId})\n";
                    if ($this->log) {
                        $this->log->info("✔ Confirmación oficial de GAPSSA enviada a {$emailAddress} para la cita {$meetingId}");
                    }
                } catch (\Throwable $e) {
                    $prevMsg = $e->getPrevious() ? " (Causa: " . $e->getPrevious()->getMessage() . ")" : "";
                    echo "❌ Error enviando correo a {$emailAddress} (Cita {$meetingId}): " . $e->getMessage() . $prevMsg . "\n";
                    if ($this->log) {
                        $this->log->error("❌ Fallo enviando confirmación a {$emailAddress} para la cita {$meetingId}: " . $e->getMessage() . $prevMsg);
                    }
                }
            }

            return $sentCount > 0;
        } catch (\Throwable $e) {
            echo "❌ Error general en sendConfirmation (Cita {$meetingId}): " . $e->getMessage() . "\n";
            if ($this->log) {
                $this->log->error("❌ Error general en sendConfirmation para cita {$meetingId}: " . $e->getMessage());
            }
            return false;
        }
    }

    private function renderHtmlTemplate(array $params): string
    {
        $templatePath = '/var/www/html/custom/Espo/Custom/Resources/templates/invitation/es_ES/body.tpl';
        if (!file_exists($templatePath)) {
            $templatePath = dirname(__DIR__, 2) . '/Resources/templates/invitation/es_ES/body.tpl';
        }

        $template = file_exists($templatePath) ? file_get_contents($templatePath) : $this->fallbackTemplate();

        // 1. Evaluar bloques condicionales {{#if key}}...{{else}}...{{/if}} y {{#if key}}...{{/if}}
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

        // 2. Reemplazo de variables simples {{{variable}}} y {{variable}}
        foreach ($params as $key => $val) {
            if (is_string($val) || is_numeric($val)) {
                $template = str_replace('{{{' . $key . '}}}', (string) $val, $template);
                $template = str_replace('{{' . $key . '}}', (string) $val, $template);
            }
        }

        // 3. Limpieza de cualquier etiqueta de plantilla residual {{...}}
        $template = preg_replace('/\{\{[#\/]?.*?\}\}/s', '', $template);

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
                } else {
                    $transProp->setValue($this->mailSender, null);
                }
            }

            if ($refSender->hasProperty("transportPreparatorFactory")) {
                $tpfProp = $refSender->getProperty("transportPreparatorFactory");
                $tpfProp->setAccessible(true);
                $innerTpf = $tpfProp->getValue($this->mailSender);

                if (!$innerTpf || !(new \ReflectionClass($innerTpf))->isAnonymous()) {
                    $injectableFactory = $this->container->get("injectableFactory");
                    $customTpf = new class($injectableFactory, $innerTpf) extends \Espo\Core\Mail\Sender\TransportPreparatorFactory {
                        private $inner;
                        public function __construct($injectableFactory, $inner) {
                            parent::__construct($injectableFactory);
                            $this->inner = $inner;
                        }
                        public function create(\Espo\Core\Mail\SmtpParams $smtpParams): \Espo\Core\Mail\Sender\TransportPreparator {
                            $innerPrep = $this->inner ? $this->inner->create($smtpParams) : parent::create($smtpParams);
                            return new class($innerPrep) implements \Espo\Core\Mail\Sender\TransportPreparator {
                                private $inner;
                                public function __construct($inner) { $this->inner = $inner; }
                                public function prepare(\Espo\Core\Mail\SmtpParams $params): \Symfony\Component\Mailer\Transport\TransportInterface {
                                    $t = $this->inner->prepare($params);
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
                                    return $t;
                                }
                            };
                        }
                    };
                    $tpfProp->setValue($this->mailSender, $customTpf);
                }
            }
        } catch (\Throwable $e) {
            if ($this->log) {
                $this->log->warning("Aviso configurando TLS en MailSender: " . $e->getMessage());
            }
        }
    }

    private function logWarning(string $msg): void
    {
        if ($this->log) {
            $this->log->warning($msg);
        }
    }
}

