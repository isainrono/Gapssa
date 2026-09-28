<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

use Espo\Core\Mail\MailSender;
use Espo\Core\Record\Hook\SaveHook;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Log;
use Espo\Custom\Classes\Mail\BookingConfirmationSender;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;

/**
 * Reenvía la invitación / confirmación de cita a los clientes cuando:
 * 1. La cita es confirmada por el centro (cEstadoReserva pasa a 'Confirmed').
 * 2. Cambia el horario (dateStart, dateEnd) o el profesional (assignedUserId) de una cita ya confirmada.
 *
 * Utiliza BookingConfirmationSender con la plantilla oficial de GAPSSA y remitente info@gapssa.es.
 *
 * @implements SaveHook<Meeting>
 */
class SendInvitationsAfterUpdate implements SaveHook
{
    private const NOTIFIABLE_FIELDS = [
        'dateStart',
        'dateEnd',
        'assignedUserId',
    ];

    public function __construct(
        private EntityManager $entityManager,
        private MailSender $mailSender,
        private Config $config,
        private ?Log $log = null,
    ) {}

    public function process(Entity $entity): void
    {
        $currentEstado = $entity->get('cEstadoReserva');
        $oldEstado = $entity->getFetched('cEstadoReserva');

        $becameConfirmed = ($currentEstado === 'Confirmed') && (
            $entity->isAttributeChanged('cEstadoReserva') ||
            $oldEstado === 'PendingCenterApproval' ||
            empty($oldEstado)
        );

        $hasScheduleChange = $this->hasNotifiableChange($entity);

        // Si la reserva está pendiente de aprobación del centro y no ha pasado a Confirmed, no notificamos aún.
        if ($currentEstado === 'PendingCenterApproval' && !$becameConfirmed) {
            return;
        }

        if (!$becameConfirmed && !$hasScheduleChange) {
            return;
        }

        try {
            $confirmationSender = new BookingConfirmationSender(
                $this->entityManager,
                $this->mailSender,
                $this->config,
                $this->log
            );

            if ($entity instanceof Meeting) {
                $confirmationSender->sendConfirmation($entity);
            }
        } catch (\Throwable $e) {
            if ($this->log) {
                $this->log->error("Error en SendInvitationsAfterUpdate para la cita {$entity->getId()}: " . $e->getMessage());
            }
        }
    }

    private function hasNotifiableChange(Entity $entity): bool
    {
        foreach (self::NOTIFIABLE_FIELDS as $field) {
            if ($entity->isAttributeChanged($field)) {
                return true;
            }
        }

        return false;
    }
}
