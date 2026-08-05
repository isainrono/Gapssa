<?php

namespace Espo\Modules\GoogleCalendarSync\Hooks\GcsAccount;

use Espo\Core\Exceptions\ConflictSilent;
use Espo\Core\Hook\Hook\BeforeSave;
use Espo\Modules\GoogleCalendarSync\Classes\Messages;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Espo\ORM\Repository\Option\SaveOptions;

/**
 * Validaciones de GcsAccount: solo puede existir una cuenta Business.
 */
class GcsValidate implements BeforeSave
{
    public function __construct(
        private EntityManager $entityManager,
        private Messages $messages
    ) {}

    public function beforeSave(Entity $entity, SaveOptions $options): void
    {
        $this->updateCalendarSummary($entity);

        if ($entity->get('type') !== 'Business') {
            return;
        }

        $where = ['type' => 'Business'];

        if (!$entity->isNew()) {
            $where['id!='] = $entity->getId();
        }

        $existing = $this->entityManager
            ->getRDBRepository('GcsAccount')
            ->where($where)
            ->findOne();

        if ($existing) {
            throw new ConflictSilent($this->messages->get(
                'businessAccountExists',
                'A Business account already exists. Only one is allowed.'
            ));
        }
    }

    /**
     * Mantiene calendarSummary coherente cuando cambia calendarId.
     */
    private function updateCalendarSummary(Entity $entity): void
    {
        if (!$entity->isAttributeChanged('calendarId')) {
            return;
        }

        $calendarId = $entity->get('calendarId');

        if (!$calendarId) {
            $entity->set('calendarSummary', null);

            return;
        }

        $cache = $entity->get('calendarListCache');

        $list = $cache ? (json_decode($cache, true) ?: []) : [];

        foreach ($list as $item) {
            if (($item['id'] ?? null) === $calendarId) {
                $entity->set('calendarSummary', $item['summary'] ?? $calendarId);

                return;
            }
        }

        $entity->set('calendarSummary', $calendarId);
    }
}
