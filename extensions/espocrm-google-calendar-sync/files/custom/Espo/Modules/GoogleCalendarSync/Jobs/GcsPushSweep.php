<?php

namespace Espo\Modules\GoogleCalendarSync\Jobs;

use Espo\Core\Job\JobDataLess;
use Espo\Modules\GoogleCalendarSync\Classes\SyncService;

/**
 * Scheduled job (cada 5 minutos): reintenta exportaciones fallidas o pendientes.
 * Idempotente: no genera duplicados gracias a GcsEventLink y a la búsqueda
 * por extendedProperties.private.espoMeetingId.
 */
class GcsPushSweep implements JobDataLess
{
    public function __construct(private SyncService $syncService)
    {}

    public function run(): void
    {
        $this->syncService->sweep();
    }
}
