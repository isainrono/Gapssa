<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use Espo\Core\Utils\Config;
use Espo\Core\Utils\Log;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Google\Service\Calendar as CalendarService;
use Google\Service\Calendar\Event;
use Google\Service\Exception as GoogleServiceException;
use Throwable;

/**
 * Lógica de sincronización Espo → Google (fase 1: solo calendario Business).
 */
class SyncService
{
    public const ACTION_UPSERT = 'upsert';
    public const ACTION_DELETE = 'delete';

    /** Códigos HTTP que significan "el evento ya no está en Google". */
    private const GONE_STATUS_LIST = [404, 410];

    public function __construct(
        private EntityManager $entityManager,
        private GoogleClientFactory $clientFactory,
        private EventMapper $eventMapper,
        private ContactNameResolver $contactNameResolver,
        private Config $config,
        private Messages $messages,
        private Log $log
    ) {}

    /**
     * Cuenta Business conectada (Active, o Error para permitir reintentos).
     */
    public function getBusinessAccount(): ?Entity
    {
        return $this->entityManager
            ->getRDBRepository('GcsAccount')
            ->where([
                'type' => 'Business',
                'status' => ['Active', 'Error'],
            ])
            ->findOne();
    }

    /**
     * Exporta (o elimina) una cita hacia el calendario Business.
     * Idempotente: puede reintentarse sin producir duplicados.
     *
     * @throws Throwable
     */
    public function pushMeeting(string $meetingId, string $action = self::ACTION_UPSERT): void
    {
        $account = $this->getBusinessAccount();

        if (!$account || !$account->get('calendarId')) {
            // Sin cuenta Business conectada o sin calendario elegido: no hay nada que hacer.
            return;
        }

        try {
            $this->processPush($account, $meetingId, $action);

            $account->set('lastSyncAt', gmdate('Y-m-d H:i:s'));
            $account->set('status', 'Active');
            $account->set('lastError', null);

            $this->entityManager->saveEntity($account, ['silent' => true]);
        } catch (Throwable $e) {
            $this->registerError($account, $meetingId, $e);

            throw $e;
        }
    }

    /**
     * Barrido periódico: reintenta exportaciones fallidas o pendientes.
     * Red de seguridad idempotente; no genera duplicados.
     */
    public function sweep(): void
    {
        $account = $this->getBusinessAccount();

        if (!$account || !$account->get('calendarId')) {
            return;
        }

        $since = $this->config->get('gcsSyncStartAt');

        if (!$since) {
            return;
        }

        $windowStart = gmdate('Y-m-d H:i:s', strtotime('-14 days'));

        if ($since > $windowStart) {
            $windowStart = $since;
        }

        $meetings = $this->entityManager
            ->getRDBRepository('Meeting')
            ->where(['modifiedAt>=' => $windowStart])
            ->order('modifiedAt')
            ->limit(0, 100)
            ->find();

        foreach ($meetings as $meeting) {
            $link = $this->findLink($meeting->getId(), $account->getId());

            $isCanceled = $this->eventMapper->isCanceled($meeting);

            if ($isCanceled && !$link) {
                continue;
            }

            if (
                $link &&
                !$isCanceled &&
                $link->get('lastPushedAt') &&
                $link->get('lastPushedAt') >= $meeting->get('modifiedAt')
            ) {
                continue;
            }

            try {
                $this->pushMeeting($meeting->getId());
            } catch (Throwable $e) {
                $this->log->error(
                    'GoogleCalendarSync sweep: failed for meeting ' . $meeting->getId() .
                    ': ' . $e->getMessage()
                );

                // Continúa con el resto; esta cita se reintentará en el siguiente barrido.
            }
        }
    }

    /**
     * @throws Throwable
     */
    private function processPush(Entity $account, string $meetingId, string $action): void
    {
        $meeting = $this->entityManager->getEntityById('Meeting', $meetingId);

        $mustDelete = $action === self::ACTION_DELETE ||
            !$meeting ||
            $this->eventMapper->isCanceled($meeting);

        $service = $this->clientFactory->createCalendarService($account);

        if ($mustDelete) {
            $this->deleteByLinks($service, $account, $meetingId);

            return;
        }

        $calendarId = $account->get('calendarId');

        // Los nombres se resuelven aquí, en la capa que ya habla con el ORM;
        // el mapper permanece puro.
        $contactNames = $this->contactNameResolver->getNames($meeting);

        $event = $this->eventMapper->toGoogleEvent($meeting, $contactNames);

        $link = $this->findLink($meetingId, $account->getId());

        if ($link) {
            $this->updateExisting($service, $account, $link, $calendarId, $event, $meetingId);

            return;
        }

        // Sin vínculo: comprobar si el evento ya existe (red anti-duplicados
        // tras un reintento o un vínculo perdido) antes de insertar.
        $existing = $this->findEventByMeetingId($service, $calendarId, $meetingId);

        if ($existing) {
            $updated = $service->events->update($calendarId, $existing->getId(), $event);

            $this->saveLink($meetingId, $account->getId(), $calendarId, $updated);

            return;
        }

        $created = $service->events->insert($calendarId, $event);

        $this->saveLink($meetingId, $account->getId(), $calendarId, $created);
    }

    /**
     * @throws Throwable
     */
    private function updateExisting(
        CalendarService $service,
        Entity $account,
        Entity $link,
        string $calendarId,
        Event $event,
        string $meetingId
    ): void {

        $linkCalendarId = $link->get('calendarId') ?: $calendarId;

        try {
            $updated = $service->events->update($linkCalendarId, $link->get('eventId'), $event);
        } catch (GoogleServiceException $e) {
            if (!in_array($e->getCode(), self::GONE_STATUS_LIST, true)) {
                throw $e;
            }

            // El evento fue borrado manualmente en Google: recrear.
            $this->entityManager->removeEntity($link);

            $created = $service->events->insert($calendarId, $event);

            $this->saveLink($meetingId, $account->getId(), $calendarId, $created);

            return;
        }

        $link->set('etag', $updated->getEtag());
        $link->set('lastPushedAt', gmdate('Y-m-d H:i:s'));

        $this->entityManager->saveEntity($link, ['silent' => true]);
    }

    /**
     * Elimina de Google los eventos vinculados a la cita (política: al cancelar
     * o borrar una cita, el evento se elimina del calendario Business).
     *
     * @throws Throwable
     */
    private function deleteByLinks(
        CalendarService $service,
        Entity $account,
        string $meetingId
    ): void {

        $links = $this->entityManager
            ->getRDBRepository('GcsEventLink')
            ->where([
                'meetingId' => $meetingId,
                'accountId' => $account->getId(),
            ])
            ->find();

        foreach ($links as $link) {
            try {
                $service->events->delete(
                    $link->get('calendarId') ?: $account->get('calendarId'),
                    $link->get('eventId')
                );
            } catch (GoogleServiceException $e) {
                if (!in_array($e->getCode(), self::GONE_STATUS_LIST, true)) {
                    throw $e;
                }

                // Ya no existe en Google: objetivo cumplido.
            }

            $this->entityManager->removeEntity($link);
        }
    }

    /**
     * Busca en Google un evento ya exportado para esta cita.
     *
     * @throws GoogleServiceException
     */
    private function findEventByMeetingId(
        CalendarService $service,
        string $calendarId,
        string $meetingId
    ): ?Event {

        $response = $service->events->listEvents($calendarId, [
            'privateExtendedProperty' => EventMapper::MEETING_ID_PROPERTY . '=' . $meetingId,
            'maxResults' => 10,
            'showDeleted' => false,
            'singleEvents' => true,
        ]);

        foreach ($response->getItems() as $item) {
            return $item;
        }

        return null;
    }

    private function findLink(string $meetingId, string $accountId): ?Entity
    {
        return $this->entityManager
            ->getRDBRepository('GcsEventLink')
            ->where([
                'meetingId' => $meetingId,
                'accountId' => $accountId,
            ])
            ->findOne();
    }

    private function saveLink(
        string $meetingId,
        string $accountId,
        string $calendarId,
        Event $event
    ): void {

        $link = $this->findLink($meetingId, $accountId)
            ?? $this->entityManager->getNewEntity('GcsEventLink');

        $link->set([
            'name' => $event->getSummary() ?: $meetingId,
            'meetingId' => $meetingId,
            'accountId' => $accountId,
            'calendarId' => $calendarId,
            'eventId' => $event->getId(),
            'etag' => $event->getEtag(),
            'lastPushedAt' => gmdate('Y-m-d H:i:s'),
        ]);

        $this->entityManager->saveEntity($link, ['silent' => true]);
    }

    private function registerError(Entity $account, string $meetingId, Throwable $e): void
    {
        $message = mb_substr($e->getMessage(), 0, 1000);

        $this->log->error(
            'GoogleCalendarSync: failed to push meeting ' . $meetingId . ': ' . $message
        );

        $account->set('status', 'Error');
        $account->set('lastError', $this->messages->get(
            'pushFailed',
            '[{time} UTC] Meeting {meetingId}: {message}',
            [
                'time' => gmdate('Y-m-d H:i:s'),
                'meetingId' => $meetingId,
                'message' => $message,
            ]
        ));

        $this->entityManager->saveEntity($account, ['silent' => true]);
    }
}
