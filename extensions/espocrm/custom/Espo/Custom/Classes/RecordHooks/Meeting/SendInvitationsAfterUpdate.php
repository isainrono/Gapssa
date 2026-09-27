<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

use Espo\Core\Record\Hook\SaveHook;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\Modules\Crm\Tools\Meeting\Invitation\Invitee;
use Espo\Modules\Crm\Tools\Meeting\InvitationService;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;

/**
 * Reenvía la invitación a los clientes si cambia el horario o el profesional.
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
    ) {}

    public function process(Entity $entity): void
    {
        $becameConfirmed = $entity->isAttributeChanged('cEstadoReserva') && $entity->get('cEstadoReserva') === 'Confirmed';
        $hasScheduleChange = $this->hasNotifiableChange($entity);

        // Si la reserva está pendiente de aprobación y cambia algo menor, no notificamos aún.
        if ($entity->get('cEstadoReserva') === 'PendingCenterApproval' && !$becameConfirmed) {
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

        if ($targets === []) {
            return;
        }

        $this->invitationService->send(
            Meeting::ENTITY_TYPE,
            $entity->getId(),
            $targets,
        );
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
