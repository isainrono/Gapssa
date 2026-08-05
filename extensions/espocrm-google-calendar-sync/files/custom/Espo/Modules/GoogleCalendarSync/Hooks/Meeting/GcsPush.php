<?php

namespace Espo\Modules\GoogleCalendarSync\Hooks\Meeting;

use Espo\Core\Hook\Hook\AfterRemove;
use Espo\Core\Hook\Hook\AfterSave;
use Espo\Core\Job\JobSchedulerFactory;
use Espo\Core\Utils\Config;
use Espo\Modules\GoogleCalendarSync\Classes\SyncService;
use Espo\Modules\GoogleCalendarSync\Jobs\GcsPushEvent;
use Espo\ORM\Entity;
use Espo\ORM\Repository\Option\RemoveOptions;
use Espo\ORM\Repository\Option\SaveOptions;

/**
 * Encola la exportación de la cita hacia Google Calendar.
 * Nunca llama a la API de Google directamente: solo encola un job.
 */
class GcsPush implements AfterSave, AfterRemove
{
    private const RELEVANT_ATTRIBUTES = [
        'name',
        'description',
        'dateStart',
        'dateEnd',
        'dateStartDate',
        'dateEndDate',
        'isAllDay',
        'status',
        'assignedUserId',
    ];

    public function __construct(
        private JobSchedulerFactory $jobSchedulerFactory,
        private Config $config
    ) {}

    public function afterSave(Entity $entity, SaveOptions $options): void
    {
        if ($options->get('silent') || $options->get('gcsSync')) {
            return;
        }

        if (!$this->config->get('gcsSyncStartAt')) {
            // La integración nunca se ha activado.
            return;
        }

        if (!$entity->isNew() && !$this->hasRelevantChange($entity)) {
            return;
        }

        $this->schedule($entity->getId(), SyncService::ACTION_UPSERT);
    }

    public function afterRemove(Entity $entity, RemoveOptions $options): void
    {
        if (!$this->config->get('gcsSyncStartAt')) {
            return;
        }

        $this->schedule($entity->getId(), SyncService::ACTION_DELETE);
    }

    private function schedule(string $meetingId, string $action): void
    {
        $this->jobSchedulerFactory
            ->create()
            ->setClassName(GcsPushEvent::class)
            ->setGroup('gcs-push')
            ->setData([
                'meetingId' => $meetingId,
                'action' => $action,
            ])
            ->schedule();
    }

    private function hasRelevantChange(Entity $entity): bool
    {
        foreach (self::RELEVANT_ATTRIBUTES as $attribute) {
            if ($entity->isAttributeChanged($attribute)) {
                return true;
            }
        }

        return false;
    }
}
