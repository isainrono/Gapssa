<?php

namespace Espo\Custom\Classes\RecordHooks\Meeting;

use Espo\Core\Record\Hook\SaveHook;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\Modules\Crm\Tools\Meeting\InvitationService;
use Espo\ORM\Entity;

/**
 * Envía las invitaciones a los asistentes justo después de crear una cita.
 *
 * @implements SaveHook<Meeting>
 */
class SendInvitationsAfterCreate implements SaveHook
{
    public function __construct(
        private InvitationService $invitationService,
    ) {}

    public function process(Entity $entity): void
    {
        $this->invitationService->send(Meeting::ENTITY_TYPE, $entity->getId());
    }
}
