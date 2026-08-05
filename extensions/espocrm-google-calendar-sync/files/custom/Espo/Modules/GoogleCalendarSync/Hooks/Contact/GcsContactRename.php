<?php

namespace Espo\Modules\GoogleCalendarSync\Hooks\Contact;

use Espo\Core\Hook\Hook\AfterSave;
use Espo\Core\Job\JobSchedulerFactory;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Log;
use Espo\Modules\Crm\Entities\Contact;
use Espo\Modules\GoogleCalendarSync\Classes\SyncService;
use Espo\Modules\GoogleCalendarSync\Jobs\GcsPushEvent;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Espo\ORM\Repository\Option\SaveOptions;

/**
 * Reexporta las citas de un contacto cuando cambia su nombre.
 *
 * El título del evento de Google incluye el nombre del cliente, así que
 * renombrar un Contact deja desactualizados los eventos de todas sus citas.
 *
 * El barrido programado **no** lo arregla: filtra por `Meeting.modifiedAt`, y
 * editar un Contact no modifica sus citas. Sin este hook, el título quedaría
 * obsoleto indefinidamente.
 *
 * Nunca llama a Google: solo encola trabajos, igual que el hook de Meeting.
 */
class GcsContactRename implements AfterSave
{
    /**
     * Atributos que componen `name` en una entidad de tipo Person, según
     * `Espo\Core\Utils\Database\Orm\FieldConverters\PersonName`: el formato
     * configurado combina first/middle/last.
     */
    private const NAME_ATTRIBUTES = ['firstName', 'middleName', 'lastName'];

    /**
     * Relación inversa declarada en `entityDefs/Contact.json`
     * (`meetings` → hasMany Meeting, foreign `contacts`). Contact no expone
     * constante para ella en 10.0.3.
     */
    private const LINK_MEETINGS = 'meetings';

    /**
     * Tope de citas reexportadas por cambio de nombre.
     *
     * Un contacto con años de historial puede tener cientos de citas, y encolar
     * un trabajo por cada una inundaría la cola y la cuota de la API de Google
     * por un cambio menor. Se priorizan las más recientes y futuras, que son
     * las que se ven en un calendario; el historial antiguo conserva el título
     * anterior, lo cual es además históricamente fiel.
     */
    private const MAX_MEETINGS = 200;

    /**
     * Trabajos ya encolados en esta petición.
     *
     * @var array<string, true>
     */
    private array $scheduled = [];

    public function __construct(
        private JobSchedulerFactory $jobSchedulerFactory,
        private EntityManager $entityManager,
        private Config $config,
        private Log $log
    ) {}

    public function afterSave(Entity $entity, SaveOptions $options): void
    {
        if ($options->get('silent') || $options->get('gcsSync')) {
            return;
        }

        if (!$this->config->get('gcsSyncStartAt')) {
            return;
        }

        if ($entity->isNew()) {
            // Un contacto recién creado aún no tiene citas.
            return;
        }

        if (!$this->hasNameChange($entity)) {
            return;
        }

        $this->scheduleRelatedMeetings($entity);
    }

    private function hasNameChange(Entity $entity): bool
    {
        foreach (self::NAME_ATTRIBUTES as $attribute) {
            if ($entity->isAttributeChanged($attribute)) {
                return true;
            }
        }

        return false;
    }

    private function scheduleRelatedMeetings(Entity $contact): void
    {
        $meetings = $this->entityManager
            ->getRDBRepository(Contact::ENTITY_TYPE)
            ->getRelation($contact, self::LINK_MEETINGS)
            ->select(['id'])
            ->order('dateStart', 'DESC')
            ->limit(0, self::MAX_MEETINGS)
            ->find();

        $count = 0;

        foreach ($meetings as $meeting) {
            $this->schedule($meeting->getId());

            $count++;
        }

        if ($count === self::MAX_MEETINGS) {
            $this->log->warning(
                'GoogleCalendarSync: contact ' . $contact->getId() . ' was renamed and has at ' .
                'least ' . self::MAX_MEETINGS . ' meetings; only the most recent ones were ' .
                'queued for re-export.'
            );
        }
    }

    private function schedule(string $meetingId): void
    {
        $key = $meetingId . ':' . SyncService::ACTION_UPSERT;

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
                'action' => SyncService::ACTION_UPSERT,
            ])
            ->schedule();
    }
}
