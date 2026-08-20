<?php

namespace Espo\Custom\Classes\Api\GapssaMeetingDecision;

use Espo\Core\Acl;
use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Conflict;
use Espo\Core\Exceptions\Error;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Exceptions\NotFound;
use Espo\Core\Exceptions\ServiceUnavailable;
use Espo\Core\Record\ServiceContainer;
use Espo\Core\Record\UpdateParams;
use Espo\Core\Utils\Config;
use Espo\Custom\Classes\RecordHooks\Meeting\MeetingDecisionTransitionPolicy;
use Espo\Custom\Classes\RecordHooks\Meeting\MeetingResolutionPolicy;
use Espo\Custom\Classes\RecordHooks\Meeting\MeetingResolutionReason;
use Espo\Entities\User;
use Espo\Modules\Crm\Entities\Meeting;
use Espo\ORM\EntityManager;
use JsonException;
use PDOException;
use stdClass;
use Throwable;

/**
 * Fase 4B, revisión OCC 2 — acción API interna dedicada, dueña de la
 * transacción completa de una decisión de reserva. Sustituye a
 * `GuardMeetingDecisionTransition` como frontera atómica real (ese hook
 * pasa a ser una guarda sin escritura propia, ver su cabecera).
 *
 * Ruta: `PUT /api/v1/GapssaMeetingDecision/{id}` (registrada en
 * `Resources/routes.json`), protegida por la autenticación estándar de la
 * API de EspoCRM (API Key del usuario técnico dedicado — mismo mecanismo
 * que cualquier otra ruta de `/api/v1`, sin mecanismo propio adicional:
 * reutilizar la autenticación ya auditada de EspoCRM es más seguro que
 * inventar una nueva).
 *
 * ## Orden exacto de la operación (todo dentro de UNA transacción)
 *
 * 0. Comprobar `gapssaBookingDecisionEnabled` (ver cabecera de sección más
 *    abajo) — antes de leer `meetingId` siquiera. `false`/ausente/corrupto
 *    corta aquí, `503 meeting_decision_disabled`, ningún actor la sortea.
 * 1. Validar payload (síncrono, antes de abrir cualquier transacción — un
 *    payload inválido nunca debe ni empezar a tocar la base de datos).
 *  2. Comprobar ACL de edición sobre `Meeting` (antes de abrir transacción,
 *     mismo motivo).
 * 3. Abrir la transacción (`TransactionManager::start()`).
 * 4. Bloquear la fila del Meeting (`SELECT ... FOR UPDATE`) — desde aquí,
 *    ninguna otra transacción puede leer un estado consistente de esta
 *    fila para decidir ni puede escribirla hasta que esta transacción
 *    termine (commit o rollback). Esto es lo que cierra la ventana de
 *    carrera — no un `UPDATE` condicional aislado como la versión anterior
 *    del guard.
 * 5. Comprobar idempotencia (bajo el lock — ver `DecisionIdempotencyStore`).
 * 6. Comprobar que `cEstadoReserva` sigue siendo `PendingCenterApproval`.
 * 7. Aplicar el guardado completo (`cEstadoReserva`, `status` vía el hook
 *    `SyncEstadoReservaToStatus` ya existente, `modifiedById` vía el propio
 *    mecanismo nativo de EspoCRM, `description`/motivo) mediante el
 *    `Service::update()` normal — reutiliza validación/ACL de campo/stream/
 *    hooks `afterUpdate`/Google Calendar Sync tal cual, dentro de la MISMA
 *    transacción.
 * 8. Registrar la operación idempotente.
 * 9. Confirmar (`commit`) — el ÚNICO commit de toda la operación.
 *
 * Cualquier excepción en cualquier punto de 4-8 revierte TODO (bloque
 * `catch` único) — nunca una escritura parcial.
 *
 * "Fase 4B — flujo de decisión final" añade `resultReason` (motivo cerrado
 * — `MeetingResolutionReason`) al payload, obligatorio, validado contra
 * `decision` (`MeetingResolutionPolicy::isCompatible`) y contra `note`
 * (`MeetingResolutionPolicy::isNoteAcceptable`: un rechazo manual exige
 * nota humana no vacía; una caducidad de sistema solo admite la nota
 * técnica fija o ninguna). Se escribe en `Meeting.cMotivoResolucionReserva`
 * en la MISMA llamada a `Service::update()` que `cEstadoReserva` — nunca en
 * una escritura separada — para que ambos campos queden consistentes
 * incluso ante un fallo a mitad de camino (o los dos se comprometen juntos,
 * o ninguno). Participa también en el hash de idempotencia: "misma clave +
 * payload distinto, incluido reason/note -> 409" (encargo, punto 2).
 *
 * ## Interruptor de despliegue (`gapssaBookingDecisionEnabled`)
 *
 * Puerta 4, revisión v3 — primera operación de negocio de `process()`,
 * ANTES incluso de leer `meetingId`, del ACL de scope, de la política de
 * autorización de abajo, de abrir la transacción o de tocar la tabla de
 * idempotencia. Necesario porque ninguna de las puertas siguientes puede
 * bloquear al administrador real: `MeetingDecisionAuthorizationPolicy`
 * autoriza a `isAdmin()` incondicionalmente (mismo criterio que el resto de
 * EspoCRM), y el modo mantenimiento nativo de EspoCRM también deja pasar a
 * cualquier admin (`Authentication.php`: `!$user->isAdmin() && ...`). Este
 * interruptor es la única puerta que sí alcanza al admin, porque vive dentro
 * del propio endpoint, después del enrutado/autenticación general de
 * EspoCRM pero antes de cualquier lógica o efecto de la decisión.
 *
 * Validación estricta vía `DecisionFeatureFlag::isEnabled()` (clase pura,
 * ver su cabecera): solo el booleano `true` habilita — clave ausente,
 * `false`, `null`, `0`/`1`, cadenas `"true"`/`"false"`, un array o cualquier
 * otro tipo bloquean igual. Responde `503` con el código contractual
 * `meeting_decision_disabled`, sin tocar ACL, `Meeting` ni la base de datos.
 *
 * ## Autorización — corrección de puerta 4 (política cerrada)
 *
 * El ACL genérico `edit` sobre `Meeting` (punto 2 del orden de arriba) NO
 * basta por sí solo: hoy lo tienen tanto el API User técnico
 * (`portal-gapssa-api`, rol `Portal GAPSSA API`) como cualquier profesional
 * humano con el rol `Profesional Gapssa` — pero no todo profesional (ni
 * todo API User futuro) debe poder decidir reservas ajenas solo por poder
 * editarlas. `isAuthorizedToDecide()` añade una segunda puerta, evaluada
 * DESPUÉS del ACL genérico y ANTES de abrir la transacción (mismo motivo
 * que el resto de validaciones síncronas: nunca tocar la base de datos si
 * la petición no va a autorizarse). Delegada íntegramente en
 * `MeetingDecisionAuthorizationPolicy::isAuthorized()` (clase pura, ver su
 * cabecera) — **el TIPO de usuario ya NO es autorización suficiente por sí
 * solo**, corrige la regla anterior "cualquier `type=api` autorizado
 * siempre" (demasiado amplia: autorizaba a cualquier API User futuro, no
 * solo al técnico dedicado):
 *
 * - Administrador (`User::isAdmin()`): autorizado siempre — mismo criterio
 *   que el resto de EspoCRM.
 * - Usuario de tipo `api` (`User::getType() === 'api'`): autorizado
 *   ÚNICAMENTE si su id está en la lista blanca de config
 *   `gapssaBookingDecisionAuthorizedApiUserIds` — en producción, pensado
 *   para contener solo el id de `portal-gapssa-api` (el API User técnico
 *   que ejecuta las caducidades del barrido de conciliación y las
 *   decisiones administrativas relayed desde el endpoint interno del BFF,
 *   `/internal/decisions`).
 * - Cualquier otro usuario (profesional humano regular): autorizado
 *   ÚNICAMENTE si su id está en la lista blanca de config
 *   `gapssaBookingDecisionAuthorizedUserIds`.
 *
 * Ambas listas (`Config`, `data/config.php` — administrables sin
 * desplegar código, mismo patrón que `ESPOCRM_PROFESSIONAL_USER_IDS` en
 * `httpEspoAdapter.ts`) están vacías por defecto — "denegar por defecto",
 * nunca autoriza a nadie implícitamente por tener `Meeting.edit` ni por su
 * tipo de usuario. **Ninguna de las dos claves de config se ha escrito en
 * la instancia real** — puerta de escritura pendiente de autorización
 * aparte, ver `docs/fase4b-decision-flow-final.md` §6/§10.
 */
class PutDecide implements Action
{
    private const ALLOWED_DECISIONS = ['Confirmed', 'Canceled'];
    private const MAX_NOTE_LENGTH = 2000;
    private const MAX_OPERATION_KEY_LENGTH = 128;
    private const AUTHORIZED_DECISION_USER_IDS_CONFIG_KEY = 'gapssaBookingDecisionAuthorizedUserIds';
    private const AUTHORIZED_DECISION_API_USER_IDS_CONFIG_KEY = 'gapssaBookingDecisionAuthorizedApiUserIds';
    private const DECISION_ENABLED_CONFIG_KEY = 'gapssaBookingDecisionEnabled';

    public function __construct(
        private EntityManager $entityManager,
        private Acl $acl,
        private ServiceContainer $recordServiceContainer,
        private User $user,
        private Config $config,
    ) {}

    public function process(Request $request): Response
    {
        if (!DecisionFeatureFlag::isEnabled($this->config->get(self::DECISION_ENABLED_CONFIG_KEY))) {
            throw ServiceUnavailable::createWithBody(
                'La decisión de reservas está deshabilitada temporalmente.',
                'meeting_decision_disabled',
            );
        }

        $meetingId = $request->getRouteParam('id');

        if (!is_string($meetingId) || $meetingId === '') {
            throw new BadRequest('Falta el id del Meeting en la ruta.');
        }

        if (!$this->acl->check(Meeting::ENTITY_TYPE, 'edit')) {
            throw new Forbidden('Sin permiso de edición sobre Meeting.');
        }

        if (!$this->isAuthorizedToDecide()) {
            throw new Forbidden('Este usuario no está autorizado para decidir reservas.');
        }

        [$decision, $resultReason, $note, $operationKey] = $this->parseAndValidateBody($request);

        $payloadHash = DecisionIdempotencyStore::hashPayload($meetingId, $decision, $resultReason, $note);
        $idempotencyStore = new DecisionIdempotencyStore($this->entityManager->getPDO());

        $transactionManager = $this->entityManager->getTransactionManager();
        $transactionManager->start();

        try {
            $response = $this->runWithinTransaction(
                $meetingId,
                $decision,
                $resultReason,
                $note,
                $operationKey,
                $payloadHash,
                $idempotencyStore,
            );

            $transactionManager->commit();

            return $response;
        } catch (Throwable $e) {
            if ($transactionManager->isStarted()) {
                $transactionManager->rollback();
            }

            if ($e instanceof BadRequest || $e instanceof Forbidden || $e instanceof NotFound || $e instanceof Conflict) {
                throw $e;
            }

            // Cualquier fallo no anticipado (ORM, PDO, un fallo inyectado
            // durante el ensayo, etc.): 500, y — porque ya se revirtió más
            // arriba — SIN ningún cambio persistido. Nunca se envuelve como
            // Conflict (eso reservado para el desacuerdo de estado real).
            throw Error::createWithBody(
                'Fallo interno decidiendo el Meeting — ningún cambio se ha persistido.',
                'meeting_decision_internal_error',
            );
        }
    }

    /**
     * Segunda puerta de autorización, aparte del ACL genérico — ver
     * cabecera de la clase. Delegada en `MeetingDecisionAuthorizationPolicy`
     * (pura, probada por separado). `$config->get(..., [])`: si una clave
     * nunca se ha escrito (estado real hoy, ambas) o está corrupta (no es
     * un array), la política la trata como lista vacía — deniega, nunca
     * lanza.
     */
    private function isAuthorizedToDecide(): bool
    {
        return MeetingDecisionAuthorizationPolicy::isAuthorized(
            $this->user->isAdmin(),
            $this->user->getType(),
            $this->user->getId(),
            $this->config->get(self::AUTHORIZED_DECISION_API_USER_IDS_CONFIG_KEY, []),
            $this->config->get(self::AUTHORIZED_DECISION_USER_IDS_CONFIG_KEY, []),
        );
    }

    /**
     * @return array{0: string, 1: string, 2: ?string, 3: string}
     */
    private function parseAndValidateBody(Request $request): array
    {
        $body = $request->getParsedBody();

        $decision = $body->decision ?? null;
        $resultReason = $body->resultReason ?? null;
        $note = $body->note ?? null;
        $operationKey = $body->operationKey ?? null;

        if (!is_string($decision) || !in_array($decision, self::ALLOWED_DECISIONS, true)) {
            throw new BadRequest('decision debe ser Confirmed o Canceled.');
        }

        if (!is_string($resultReason) || !MeetingResolutionReason::isValid($resultReason)) {
            throw new BadRequest('resultReason requerido: Approved, RejectedByStaff o ApprovalExpired.');
        }

        if (!MeetingResolutionPolicy::isCompatible($decision, $resultReason)) {
            throw new BadRequest(
                'resultReason incompatible con decision: Confirmed solo admite Approved; '
                    . 'Canceled solo admite RejectedByStaff o ApprovalExpired.',
            );
        }

        if ($note !== null && (!is_string($note) || strlen($note) > self::MAX_NOTE_LENGTH)) {
            throw new BadRequest('note inválida.');
        }

        if (!MeetingResolutionPolicy::isNoteAcceptable($resultReason, $note)) {
            throw new BadRequest(
                $resultReason === MeetingResolutionReason::REJECTED_BY_STAFF
                    ? 'note obligatoria y no vacía para RejectedByStaff — el rechazo debe conservar un motivo operativo.'
                    : 'note inválida para ApprovalExpired — solo se admite la nota técnica prevista o ninguna.',
            );
        }

        if (
            !is_string($operationKey) ||
            $operationKey === '' ||
            strlen($operationKey) > self::MAX_OPERATION_KEY_LENGTH ||
            !preg_match('/^[A-Za-z0-9_-]+$/', $operationKey)
        ) {
            throw new BadRequest('operationKey requerida (alfanumérica, guiones/guion bajo, hasta 128 caracteres).');
        }

        return [$decision, $resultReason, $note, $operationKey];
    }

    /**
     * @throws NotFound
     * @throws Conflict
     * @throws Error
     */
    private function runWithinTransaction(
        string $meetingId,
        string $decision,
        string $resultReason,
        ?string $note,
        string $operationKey,
        string $payloadHash,
        DecisionIdempotencyStore $idempotencyStore,
    ): Response {
        // Lock de fila real — desde aquí hasta el commit/rollback de este
        // método, ninguna otra transacción puede avanzar sobre este Meeting.
        $meeting = $this->entityManager
            ->getRDBRepository(Meeting::ENTITY_TYPE)
            ->forUpdate()
            ->where(['id' => $meetingId])
            ->findOne();

        if (!$meeting) {
            throw new NotFound("Meeting $meetingId no existe.");
        }

        $existingOperation = $this->findIdempotentOperation($idempotencyStore, $operationKey);

        if ($existingOperation !== null) {
            if ($existingOperation['payloadHash'] !== $payloadHash) {
                throw Conflict::createWithBody(
                    'operationKey ya usada con un payload distinto.',
                    'idempotency_key_reused',
                );
            }

            // Misma clave, mismo payload — se repite el resultado ya
            // confirmado anteriormente, sin volver a ejecutar nada. Cubre
            // exactamente el caso "timeout después del commit, antes de
            // responder" (encargo, punto 6/7): esta fila solo puede existir
            // si una ejecución anterior llegó a comprometerse con éxito.
            return $this->replayResponse($existingOperation);
        }

        if (!MeetingDecisionTransitionPolicy::isGuardedTransitionTarget($decision)) {
            // Defensa en profundidad — el enum del payload ya lo restringe,
            // pero nunca confiar solo en la validación de entrada.
            throw new BadRequest('decision no es una transición soportada.');
        }

        $currentEstadoReserva = $meeting->get('cEstadoReserva');

        if ($currentEstadoReserva !== MeetingDecisionTransitionPolicy::guardedSourceState()) {
            return $this->recordAndRespondConflict(
                $idempotencyStore,
                $operationKey,
                $meetingId,
                $payloadHash,
                $decision,
                $currentEstadoReserva,
            );
        }

        $data = new stdClass();
        $data->cEstadoReserva = $decision;
        // Escrito en la MISMA llamada que cEstadoReserva — nunca en un
        // segundo update separado — para que los dos campos se comprometan
        // o reviertan juntos (ver cabecera de la clase).
        $data->cMotivoResolucionReserva = $resultReason;

        if ($note !== null) {
            $data->description = $note;
        }

        $updateResult = AtomicDecisionContext::runAuthorized(
            $meetingId,
            $currentEstadoReserva,
            $decision,
            fn () => $this->recordServiceContainer
                ->get(Meeting::ENTITY_TYPE)
                ->update($meetingId, $data, UpdateParams::create()),
            $operationKey,
        );

        $updatedEntity = $updateResult->getEntity();

        $responseBody = [
            'status' => 'confirmed',
            'meetingId' => $meetingId,
            'cEstadoReserva' => $updatedEntity->get('cEstadoReserva'),
            'cMotivoResolucionReserva' => $updatedEntity->get('cMotivoResolucionReserva'),
            'meetingStatus' => $updatedEntity->get('status'),
            'modifiedById' => $updatedEntity->get('modifiedById'),
            'modifiedAt' => $updatedEntity->get('modifiedAt'),
        ];

        $this->persistIdempotentResult(
            $idempotencyStore,
            $operationKey,
            $meetingId,
            $payloadHash,
            $decision,
            'confirmed',
            (string) $updatedEntity->get('cEstadoReserva'),
            200,
            $responseBody,
        );

        return ResponseComposer::json($responseBody);
    }

    /**
     * @return array{payloadHash: string, resultStatus: string, resultHttpStatus: int, resultBody: string}|null
     */
    private function findIdempotentOperation(DecisionIdempotencyStore $store, string $operationKey): ?array
    {
        try {
            return $store->findByKey($operationKey);
        } catch (PDOException $e) {
            throw Error::createWithBody('No se pudo comprobar idempotencia.', 'idempotency_lookup_failed');
        }
    }

    /**
     * @param array{resultHttpStatus: int, resultBody: string} $existingOperation
     */
    private function replayResponse(array $existingOperation): Response
    {
        try {
            /** @var array<string, mixed> $decoded */
            $decoded = json_decode($existingOperation['resultBody'], true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw Error::createWithBody('Registro de idempotencia corrupto.', 'idempotency_record_corrupt');
        }

        $response = ResponseComposer::json($decoded);
        $response->setStatus($existingOperation['resultHttpStatus']);

        return $response;
    }

    private function recordAndRespondConflict(
        DecisionIdempotencyStore $store,
        string $operationKey,
        string $meetingId,
        string $payloadHash,
        string $decision,
        ?string $currentEstadoReserva,
    ): Response {
        $responseBody = [
            'status' => 'conflict',
            'reason' => 'meeting_decision_conflict',
            'meetingId' => $meetingId,
            'existingCEstadoReserva' => $currentEstadoReserva,
        ];

        $this->persistIdempotentResult(
            $store,
            $operationKey,
            $meetingId,
            $payloadHash,
            $decision,
            'conflict',
            $currentEstadoReserva,
            409,
            $responseBody,
        );

        $response = ResponseComposer::json($responseBody);
        $response->setStatus(409);

        return $response;
    }

    /**
     * @param array<string, mixed> $responseBody
     */
    private function persistIdempotentResult(
        DecisionIdempotencyStore $store,
        string $operationKey,
        string $meetingId,
        string $payloadHash,
        string $decision,
        string $resultStatus,
        ?string $resultCEstadoReserva,
        int $resultHttpStatus,
        array $responseBody,
    ): void {
        try {
            $store->record(
                $operationKey,
                $meetingId,
                $payloadHash,
                $decision,
                $resultStatus,
                $resultCEstadoReserva,
                $resultHttpStatus,
                json_encode($responseBody, JSON_THROW_ON_ERROR),
            );
        } catch (PDOException $e) {
            // Violación de UNIQUE(operation_key) por una carrera genuina
            // entre dos Meetings DISTINTOS reusando la misma clave por
            // error del llamante (el lock de fila del Meeting ya serializa
            // las llamadas para el MISMO Meeting, así que esto solo puede
            // venir de un id ajeno) — se revierte todo, nunca se deja una
            // decisión aplicada sin su registro de idempotencia.
            throw Conflict::createWithBody(
                'operationKey ya usada para otro Meeting.',
                'idempotency_key_reused',
            );
        } catch (JsonException $e) {
            throw Error::createWithBody('No se pudo serializar el resultado.', 'idempotency_encode_failed');
        }
    }
}
