<?php

namespace Espo\Modules\GoogleCalendarSync\Jobs;

use Espo\Core\Exceptions\Error;
use Espo\Core\Job\Job;
use Espo\Core\Job\Job\Data;
use Espo\Modules\GoogleCalendarSync\Classes\SyncService;

/**
 * Job encolado por el hook de Meeting: exporta una cita a Google Calendar.
 */
class GcsPushEvent implements Job
{
    public function __construct(private SyncService $syncService)
    {}

    public function run(Data $data): void
    {
        $meetingId = $data->get('meetingId');

        if (!$meetingId) {
            throw new Error('GcsPushEvent: falta meetingId en los datos del job.');
        }

        $this->syncService->pushMeeting(
            $meetingId,
            $data->get('action') ?? SyncService::ACTION_UPSERT
        );
    }
}
