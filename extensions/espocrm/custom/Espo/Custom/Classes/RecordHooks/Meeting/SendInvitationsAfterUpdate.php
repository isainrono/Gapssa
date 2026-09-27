<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

use Espo\Core\Record\Hook\SaveHook;
use Espo\Core\Utils\Log;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\Modules\Crm\Tools\Meeting\Invitation\Invitee;
use Espo\Modules\Crm\Tools\Meeting\InvitationService;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;

/**
 * Reenvía la invitación / confirmación de cita a los clientes cuando:
 * 1. La cita es confirmada por el centro (cEstadoReserva pasa a 'Confirmed').
 * 2. Cambia el horario (dateStart, dateEnd) o el profesional (assignedUserId) de una cita ya confirmada.
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
        private InvitationService $invitationService,
        private EntityManager $entityManager,
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

        $this->ensureParentContactIsAttendee($entity);

        $targets = [];
        $contacts = $this->entityManager
            ->getRelation($entity, Meeting::LINK_CONTACTS)
            ->find();

        foreach ($contacts as $contact) {
            if (!$contact->getEmailAddress()) {
                continue;
            }

            $targets[] = new Invitee(
                $contact->getEntityType(),
                $contact->getId(),
                $contact->getEmailAddress(),
            );
        }

        // Respaldo de seguridad: si no se encontró en la relación en memoria, buscar directamente el contacto principal
        if (empty($targets)) {
            $contactId = null;
            if ($entity->get('parentType') === 'Contact' && $entity->get('parentId')) {
                $contactId = (string) $entity->get('parentId');
            } elseif ($entity->get('contactId')) {
                $contactId = (string) $entity->get('contactId');
            }

            if ($contactId) {
                $contact = $this->entityManager->getEntity('Contact', $contactId);
                if ($contact && $contact->getEmailAddress()) {
                    $targets[] = new Invitee(
                        $contact->getEntityType(),
                        $contact->getId(),
                        $contact->getEmailAddress(),
                    );
                }
            }
        }

        if ($targets === []) {
            return;
        }

        try {
            $this->invitationService->send(
                Meeting::ENTITY_TYPE,
                $entity->getId(),
                $targets,
            );
        } catch (\Throwable $e) {
            if ($this->log) {
                $this->log->error("Error enviando confirmación de cita {$entity->getId()} a cliente: " . $e->getMessage());
            }
        }
    }

    private function ensureParentContactIsAttendee(Entity $entity): void
    {
        $contactId = null;

        if ($entity->get('parentType') === 'Contact' && $entity->get('parentId')) {
            $contactId = (string) $entity->get('parentId');
        } elseif ($entity->get('contactId')) {
            $contactId = (string) $entity->get('contactId');
        }

        if (!$contactId) {
            return;
        }

        $contact = $this->entityManager->getEntity('Contact', $contactId);
        if (!$contact) {
            return;
        }

        $relation = $this->entityManager->getRelation($entity, Meeting::LINK_CONTACTS);
        $existing = $relation->where(['id' => $contactId])->findOne();

        if (!$existing) {
            $relation->relate($contact);
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
