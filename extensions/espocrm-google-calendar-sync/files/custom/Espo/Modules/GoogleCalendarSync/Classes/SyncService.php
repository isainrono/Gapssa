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

        $meeting = $this->entityManager->getEntityById('Meeting', $meetingId);

        if ($this->isExcludedFromSync($meeting, $action)) {
            // cExcluirGoogleCalendarSync=true: cero jobs, cero llamadas a
            // Google, cero efecto en GcsEventLink ni en la cuenta. Este es el
            // único punto de aplicación real de la exclusión — todo lo demás
            // (hooks de Meeting, hook de renombrado de Contact, barrido)
            // termina llamando aquí, así que basta con comprobarlo una vez,
            // con el estado vivo de la cita, sin depender de que cada
            // llamador lo compruebe por separado. Los DELETE explícitos y
            // las citas canceladas se dejan pasar a propósito: son rutas de
            // limpieza, y bloquearlas dejaría huérfano un evento que ya
            // existiera en Google desde antes de excluir la cita.
            return;
        }

        try {
            $touchedGoogle = $this->processPush($account, $meetingId, $action);

            if (!$touchedGoogle) {
                // DELETE sin ningún GcsEventLink que borrar: processPush()
                // no ha creado ningún cliente ni tocado OAuth (ver
                // processDelete()). No hay nada que registrar como
                // sincronización exitosa — dejar la cuenta exactamente como
                // estaba.
                return;
            }

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
     * Cero jobs, cero llamadas a Google, cero efecto en GcsEventLink: una
     * cita marcada `cExcluirGoogleCalendarSync=true` se ignora por completo,
     * salvo en sus rutas de limpieza (DELETE explícito o cancelación), que
     * sí deben ejecutarse para no dejar huérfano un evento ya sincronizado
     * antes de excluir la cita.
     */
    private function isExcludedFromSync(?Entity $meeting, string $action): bool
    {
        if ($action === self::ACTION_DELETE) {
            return false;
        }

        if (!$meeting) {
            return false;
        }

        if ($this->eventMapper->isCanceled($meeting)) {
            return false;
        }

        return (bool) $meeting->get('cExcluirGoogleCalendarSync');
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
            $isExcluded = (bool) $meeting->get('cExcluirGoogleCalendarSync');

            if ($isExcluded && !$isCanceled) {
                if (!$link) {
                    // Nunca se sincronizó, o ya se limpió: nada que hacer.
                    continue;
                }

                // Vínculo heredado de antes de excluir la cita (p. ej. el
                // DELETE de limpieza del cambio false→true falló la primera
                // vez): reintentar su limpieza aquí, con la misma red de
                // seguridad idempotente que ya usa el resto del barrido, en
                // vez de dejarlo huérfano para siempre — `pushMeeting` con
                // `action=delete` nunca queda bloqueado por la exclusión.
                try {
                    $this->pushMeeting($meeting->getId(), self::ACTION_DELETE);
                } catch (Throwable $e) {
                    $this->log->error(
                        'GoogleCalendarSync sweep: failed to clean up excluded meeting ' .
                        $meeting->getId() . ': ' . $e->getMessage()
                    );
                }

                continue;
            }

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
     * @return bool Si se ha llegado a tocar Google (cliente creado). `false`
     *   en el no-op local de un DELETE sin ningún vínculo — ver
     *   processDelete().
     * @throws Throwable
     */
    private function processPush(Entity $account, string $meetingId, string $action): bool
    {
        $meeting = $this->entityManager->getEntityById('Meeting', $meetingId);

        $mustDelete = $action === self::ACTION_DELETE ||
            !$meeting ||
            $this->eventMapper->isCanceled($meeting);

        if ($mustDelete) {
            return $this->processDelete($account, $meetingId);
        }

        $service = $this->clientFactory->createCalendarService($account);

        $calendarId = $account->get('calendarId');

        // Los nombres se resuelven aquí, en la capa que ya habla con el ORM;
        // el mapper permanece puro.
        $contactNames = $this->contactNameResolver->getNames($meeting);

        $event = $this->eventMapper->toGoogleEvent($meeting, $contactNames);

        $link = $this->findLink($meetingId, $account->getId());

        if ($link) {
            $this->updateExisting($service, $account, $link, $calendarId, $event, $meetingId);

            return true;
        }

        // Sin vínculo: comprobar si el evento ya existe (red anti-duplicados
        // tras un reintento o un vínculo perdido) antes de insertar.
        $existing = $this->findEventByMeetingId($service, $calendarId, $meetingId);

        if ($existing) {
            $updated = $service->events->update($calendarId, $existing->getId(), $event);

            $this->saveLink($meetingId, $account->getId(), $calendarId, $updated);

            return true;
        }

        $created = $service->events->insert($calendarId, $event);

        $this->saveLink($meetingId, $account->getId(), $calendarId, $created);

        return true;
    }

    /**
     * Punto central de control para CUALQUIER acción DELETE (soft-delete,
     * cancelación, exclusión false→true, barrido, o un job antiguo/manual
     * que llegue aquí sin haber pasado por ningún filtro previo): consulta
     * localmente los `GcsEventLink` del Meeting ANTES de crear el cliente de
     * Google o tocar OAuth. Sin ningún vínculo, no hay nada que borrar en
     * Google — no-op local puro: cero cliente, cero renovación OAuth, cero
     * cambio en `GcsAccount`, cero llamada a Calendar. Con uno o más
     * vínculos, se conserva el comportamiento exacto de siempre
     * (`deleteByLinksCollection()`).
     *
     * Antes de este método, `processPush()` creaba el cliente de forma
     * incondicional también para el caso DELETE, lo que disparaba un
     * intento real de renovación OAuth aunque no hubiera ningún vínculo que
     * borrar — incidente documentado en
     * `docs/fase4b-puerta5a-limpieza-propuesta.md` §12 y
     * `docs/fase4b-puerta6c-correccion-oauth-delete.md`.
     *
     * @return bool `true` si se ha creado un cliente y tocado Google/OAuth
     *   (había al menos un vínculo); `false` en el no-op local.
     * @throws Throwable
     */
    private function processDelete(Entity $account, string $meetingId): bool
    {
        $links = $this->entityManager
            ->getRDBRepository('GcsEventLink')
            ->where([
                'meetingId' => $meetingId,
                'accountId' => $account->getId(),
            ])
            ->find();

        if (!count($links)) {
            return false;
        }

        $service = $this->clientFactory->createCalendarService($account);

        $this->deleteByLinksCollection($service, $account, $links);

        return true;
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
     * Recibe la colección ya consultada por `processDelete()` — nunca vuelve
     * a consultar `GcsEventLink` — para que exista una única lectura local
     * por cada DELETE, hecha siempre antes de crear el cliente de Google.
     *
     * @param iterable<Entity> $links
     * @throws Throwable
     */
    private function deleteByLinksCollection(
        CalendarService $service,
        Entity $account,
        iterable $links
    ): void {

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
