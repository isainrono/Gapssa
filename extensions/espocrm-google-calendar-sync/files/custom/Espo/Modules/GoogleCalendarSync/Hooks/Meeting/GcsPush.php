<?php

namespace Espo\Modules\GoogleCalendarSync\Hooks\Meeting;

use Espo\Core\Hook\Hook\AfterRelate;
use Espo\Core\Hook\Hook\AfterRemove;
use Espo\Core\Hook\Hook\AfterSave;
use Espo\Core\Hook\Hook\AfterUnrelate;
use Espo\Core\Job\JobSchedulerFactory;
use Espo\Core\Utils\Config;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\Modules\GoogleCalendarSync\Classes\SyncService;
use Espo\Modules\GoogleCalendarSync\Jobs\GcsPushEvent;
use Espo\ORM\Entity;
use Espo\ORM\Repository\Option\RelateOptions;
use Espo\ORM\Repository\Option\RemoveOptions;
use Espo\ORM\Repository\Option\SaveOptions;
use Espo\ORM\Repository\Option\UnrelateOptions;

/**
 * Encola la exportación de la cita hacia Google Calendar.
 * Nunca llama a la API de Google directamente: solo encola un job.
 *
 * Además del guardado, se escucha el vínculo y desvínculo de contactos: el
 * título del evento incluye sus nombres, así que un cambio de contactos debe
 * reexportar la cita. EspoCRM guarda los campos linkMultiple llamando a
 * `relateById()`/`unrelateById()` del repositorio (ver
 * `Espo\Core\FieldProcessing\Relation\LinkMultipleSaver`), que sí disparan
 * estos hooks; el `afterSave` por sí solo no vería el cambio.
 */
class GcsPush implements AfterSave, AfterRemove, AfterRelate, AfterUnrelate
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

    /**
     * Trabajos ya encolados en esta petición, para no repetirlos.
     *
     * @var array<string, true>
     */
    private array $scheduled = [];

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

    public function afterRelate(
        Entity $entity,
        string $relationName,
        Entity $relatedEntity,
        array $columnData,
        RelateOptions $options
    ): void {

        $this->handleContactsChange($entity, $relationName, $options);
    }

    public function afterUnrelate(
        Entity $entity,
        string $relationName,
        Entity $relatedEntity,
        UnrelateOptions $options
    ): void {

        $this->handleContactsChange($entity, $relationName, $options);
    }

    /**
     * Reexporta la cita cuando cambian sus contactos.
     *
     * **`silent` NO se ignora aquí.** En una cita nueva EspoCRM relaciona los
     * contactos con `SaveOption::SILENT` (ver `LinkMultipleSaver::process()`),
     * y saltárselo abría una carrera real:
     *
     *   1. `afterSave` encola el UPSERT.
     *   2. El daemon lo procesa antes de que terminen de crearse las
     *      relaciones.
     *   3. Google recibe el evento sin el nombre del cliente.
     *   4. El `afterRelate` posterior se ignoraba por venir con `silent`.
     *   5. El barrido tampoco lo corrige: filtra por `Meeting.modifiedAt`, que
     *      relacionar un contacto no modifica.
     *   6. El título se quedaba sin cliente de forma permanente.
     *
     * Procesar la relación cierra esa ventana. La deduplicación por
     * `meetingId:acción` evita el trabajo repetido mientras se comparta la
     * instancia del hook —`HookManager` cachea las instancias por clase, así
     * que dentro de una petición se comparte—, y si aun así se encolaran dos,
     * ambos son UPSERT sobre la misma cita: `SyncService` es idempotente y
     * `GcsEventLink` + `espoMeetingId` impiden duplicar el evento. Un UPSERT de
     * más es preferible a un evento permanentemente sin cliente.
     *
     * `gcsSync` sí se respeta: marca los cambios originados por la propia
     * sincronización y evita bucles.
     */
    private function handleContactsChange(
        Entity $entity,
        string $relationName,
        RelateOptions|UnrelateOptions $options
    ): void {

        if ($relationName !== Meeting::LINK_CONTACTS) {
            return;
        }

        if ($options->get('gcsSync')) {
            return;
        }

        if (!$this->config->get('gcsSyncStartAt')) {
            return;
        }

        $this->schedule($entity->getId(), SyncService::ACTION_UPSERT);
    }

    private function schedule(string $meetingId, string $action): void
    {
        // Guardar una cita con tres contactos nuevos dispara tres afterRelate.
        // El resultado sería idéntico —pushMeeting es idempotente— pero se
        // encolarían tres trabajos: basta con uno por cita y acción.
        $key = $meetingId . ':' . $action;

        if (isset($this->scheduled[$key])) {
            return;
        }

        $this->scheduled[$key] = true;

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
