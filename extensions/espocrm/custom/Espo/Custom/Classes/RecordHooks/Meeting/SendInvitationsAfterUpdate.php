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
        if (!$this->hasNotifiableChange($entity)) {
            return;
        }

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
