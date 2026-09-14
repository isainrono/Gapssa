<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

use Espo\Core\Record\Hook\SaveHook;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\Modules\Crm\Tools\Meeting\InvitationService;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;

/**
 * Envía las invitaciones a los asistentes justo después de crear una cita.
 * Auto-relaciona el Contacto vinculado (Parent / Contact) si no fue añadido explícitamente a Asistentes.
 *
 * @implements SaveHook<Meeting>
 */
class SendInvitationsAfterCreate implements SaveHook
{
    public function __construct(
        private InvitationService $invitationService,
        private EntityManager $entityManager,
    ) {}

    public function process(Entity $entity): void
    {
        $this->ensureParentContactIsAttendee($entity);

        $this->invitationService->send(Meeting::ENTITY_TYPE, $entity->getId());
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
}
