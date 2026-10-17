<?php

namespace Espo\Custom\Jobs;

use Espo\Core\Container;
use Espo\Core\Job\JobDataLess;
use Espo\Core\Utils\Log;
use Espo\Custom\Classes\Mail\AppointmentReminderSender;

/**
 * Scheduled Job ejecutado periódicamente (ej. cada 10 minutos)
 * para evaluar y enviar automáticamente los recordatorios de cita
 * a 24 horas y 2 horas antes de la sesión.
 */
class SendAppointmentReminders implements JobDataLess
{
    private AppointmentReminderSender $sender;
    private ?Log $log;

    public function __construct(Container $container)
    {
        $this->sender = new AppointmentReminderSender($container);
        $this->log = $container->has('log') ? $container->get('log') : null;
    }

    public function run(): void
    {
        $result = $this->sender->processPendingReminders();

        $msg = sprintf(
            "SendAppointmentReminders: revisadas %d citas, enviados %d recordatorios de 24h y %d recordatorios de 2h.",
            $result['checked'],
            $result['sent24h'],
            $result['sent2h']
        );

        if ($result['sent24h'] > 0 || $result['sent2h'] > 0) {
            echo "✔ {$msg}\n";
        }

        if ($this->log) {
            $this->log->info($msg);
        }
    }
}
