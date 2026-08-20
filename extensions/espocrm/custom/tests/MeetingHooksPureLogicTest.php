<?php

declare(strict_types=1);

/**
 * Fase 4B, revisión 2, punto 5 — arnés mínimo aislado para la lógica pura
 * de transición y mapeo de los RecordHooks de `Meeting`. NO requiere
 * bootstrap de EspoCRM, PHPUnit, ni ninguna dependencia de Composer: las
 * dos clases bajo prueba (`EstadoReservaStatusMap`,
 * `MeetingDecisionTransitionPolicy`) son deliberadamente puras (sin
 * `Espo\...` en sus imports) para que esto sea posible. Ejecutar:
 *
 *   php extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php
 *
 * Termina con código de salida 0 si todas las aserciones pasan, 1 en caso
 * contrario (imprime cada fallo). Nunca contacta la instancia real de
 * EspoCRM ni ninguna base de datos — cubre exactamente lo que
 * `docs/fase4b-integracion-http.md` §9 marcaba como hueco: "no existe
 * arnés de pruebas PHP para extensions/espocrm/custom".
 */

require __DIR__ . '/../Espo/Custom/Classes/RecordHooks/Meeting/EstadoReservaStatusMap.php';
require __DIR__ . '/../Espo/Custom/Classes/RecordHooks/Meeting/MeetingDecisionTransitionPolicy.php';
require __DIR__ . '/../Espo/Custom/Classes/RecordHooks/Meeting/MeetingResolutionReason.php';
require __DIR__ . '/../Espo/Custom/Classes/RecordHooks/Meeting/MeetingResolutionPolicy.php';
require __DIR__ . '/../Espo/Custom/Classes/Api/GapssaMeetingDecision/AtomicDecisionContext.php';
require __DIR__ . '/../Espo/Custom/Classes/Api/GapssaMeetingDecision/DecisionIdempotencyStore.php';
require __DIR__ . '/../Espo/Custom/Classes/Api/GapssaMeetingDecision/MeetingDecisionAuthorizationPolicy.php';
require __DIR__ . '/../Espo/Custom/Classes/Api/GapssaMeetingDecision/DecisionFeatureFlag.php';

use Espo\Custom\Classes\Api\GapssaMeetingDecision\AtomicDecisionContext;
use Espo\Custom\Classes\Api\GapssaMeetingDecision\DecisionFeatureFlag;
use Espo\Custom\Classes\Api\GapssaMeetingDecision\DecisionIdempotencyStore;
use Espo\Custom\Classes\Api\GapssaMeetingDecision\MeetingDecisionAuthorizationPolicy;
use Espo\Custom\Classes\RecordHooks\Meeting\EstadoReservaStatusMap;
use Espo\Custom\Classes\RecordHooks\Meeting\MeetingDecisionTransitionPolicy;
use Espo\Custom\Classes\RecordHooks\Meeting\MeetingResolutionPolicy;
use Espo\Custom\Classes\RecordHooks\Meeting\MeetingResolutionReason;

$failures = [];
$passCount = 0;

/**
 * @param mixed $actual
 * @param mixed $expected
 */
function check(string $label, $actual, $expected): void
{
    global $failures, $passCount;

    if ($actual === $expected) {
        $passCount++;
        return;
    }

    $failures[] = sprintf(
        '%s: expected %s, got %s',
        $label,
        var_export($expected, true),
        var_export($actual, true),
    );
}

// ---------------------------------------------------------------------------
// EstadoReservaStatusMap — copia literal de ESTADO_RESERVA_A_MEETING_STATUS
// (packages/contracts/src/estado-reserva.ts). Cubre los 12 valores del enum
// + null/desconocido.
// ---------------------------------------------------------------------------

check('statusFor(RequestReceived)', EstadoReservaStatusMap::statusFor('RequestReceived'), 'Planned');
check('statusFor(PendingGuardianAuthorization)', EstadoReservaStatusMap::statusFor('PendingGuardianAuthorization'), 'Planned');
check('statusFor(PendingAssessment)', EstadoReservaStatusMap::statusFor('PendingAssessment'), 'Planned');
check('statusFor(PendingCenterApproval)', EstadoReservaStatusMap::statusFor('PendingCenterApproval'), 'Planned');
check('statusFor(Confirmed)', EstadoReservaStatusMap::statusFor('Confirmed'), 'Planned');
check('statusFor(ClientArrived)', EstadoReservaStatusMap::statusFor('ClientArrived'), 'Planned');
check('statusFor(InTreatment)', EstadoReservaStatusMap::statusFor('InTreatment'), 'Planned');
check('statusFor(Completed)', EstadoReservaStatusMap::statusFor('Completed'), 'Held');
check('statusFor(Canceled)', EstadoReservaStatusMap::statusFor('Canceled'), 'Not Held');
check('statusFor(NoShow)', EstadoReservaStatusMap::statusFor('NoShow'), 'Not Held');
check('statusFor(RescheduleRequested)', EstadoReservaStatusMap::statusFor('RescheduleRequested'), 'Planned');
check('statusFor(ScheduleConflict)', EstadoReservaStatusMap::statusFor('ScheduleConflict'), 'Planned');
check('statusFor(null) — reunión fuera del flujo del portal', EstadoReservaStatusMap::statusFor(null), null);
check('statusFor("") — vacío tratado igual que null', EstadoReservaStatusMap::statusFor(''), null);
check('statusFor(valor desconocido) — nunca inventa un status', EstadoReservaStatusMap::statusFor('EstadoInventado'), null);
check('MAP tiene exactamente 12 entradas (el enum completo)', count(EstadoReservaStatusMap::MAP), 12);

// ---------------------------------------------------------------------------
// MeetingDecisionTransitionPolicy — qué transiciones necesitan el CAS
// atómico del guard (GuardMeetingDecisionTransition).
// ---------------------------------------------------------------------------

check('guardedSourceState()', MeetingDecisionTransitionPolicy::guardedSourceState(), 'PendingCenterApproval');

check('isGuardedTransitionTarget(Confirmed) — aprobación', MeetingDecisionTransitionPolicy::isGuardedTransitionTarget('Confirmed'), true);
check('isGuardedTransitionTarget(Canceled) — rechazo o expiración', MeetingDecisionTransitionPolicy::isGuardedTransitionTarget('Canceled'), true);
check('isGuardedTransitionTarget(null)', MeetingDecisionTransitionPolicy::isGuardedTransitionTarget(null), false);
check(
    'isGuardedTransitionTarget(RequestReceived) — no es una decisión, no se protege con el CAS',
    MeetingDecisionTransitionPolicy::isGuardedTransitionTarget('RequestReceived'),
    false,
);
check(
    'isGuardedTransitionTarget(PendingCenterApproval) — el propio origen nunca es un destino protegido',
    MeetingDecisionTransitionPolicy::isGuardedTransitionTarget('PendingCenterApproval'),
    false,
);
check(
    'isGuardedTransitionTarget(NoShow) — estado terminal ajeno al flujo de decisión del centro',
    MeetingDecisionTransitionPolicy::isGuardedTransitionTarget('NoShow'),
    false,
);

// ---------------------------------------------------------------------------
// AtomicDecisionContext — revisión OCC 3. Capacidad nominal cerrada entre
// PutDecide y GuardMeetingDecisionTransition, atada al Meeting/origen/
// destino exactos (ver cabecera de ambas clases para el porqué de usar
// `static` en vez de un servicio del contenedor DI, y para el hueco de la
// revisión 2 que esta revisión corrige: el `isActive()` genérico anterior
// autorizaba CUALQUIER Meeting mientras hubiera una decisión en curso).
// ---------------------------------------------------------------------------

check(
    'AtomicDecisionContext::authorizes() en reposo — sin contexto, todo rechazado',
    AtomicDecisionContext::authorizes('meeting-1', 'PendingCenterApproval', 'Confirmed'),
    false,
);

// Meeting correcto + decisión correcta -> permitido.
$observedInsideCallback = null;
AtomicDecisionContext::runAuthorized(
    'meeting-1',
    'PendingCenterApproval',
    'Confirmed',
    function () use (&$observedInsideCallback) {
        $observedInsideCallback = AtomicDecisionContext::authorizes('meeting-1', 'PendingCenterApproval', 'Confirmed');

        return 'valor-de-retorno';
    },
);
check('authorizes() es true DENTRO del callback para el Meeting/transición exactos', $observedInsideCallback, true);
check(
    'authorizes() vuelve a false tras un runAuthorized() exitoso',
    AtomicDecisionContext::authorizes('meeting-1', 'PendingCenterApproval', 'Confirmed'),
    false,
);

$returnValue = AtomicDecisionContext::runAuthorized('meeting-1', 'PendingCenterApproval', 'Confirmed', fn () => 'eco');
check('runAuthorized() propaga el valor de retorno del callback', $returnValue, 'eco');

// Meeting distinto + misma decisión -> rechazado.
$observedForOtherMeeting = null;
AtomicDecisionContext::runAuthorized(
    'meeting-1',
    'PendingCenterApproval',
    'Confirmed',
    function () use (&$observedForOtherMeeting) {
        $observedForOtherMeeting = AtomicDecisionContext::authorizes('meeting-OTRO', 'PendingCenterApproval', 'Confirmed');
    },
);
check('authorizes() rechaza un Meeting distinto al autorizado (escritura anidada simulada)', $observedForOtherMeeting, false);

// Meeting correcto + decisión distinta -> rechazado.
$observedForOtherTarget = null;
AtomicDecisionContext::runAuthorized(
    'meeting-1',
    'PendingCenterApproval',
    'Confirmed',
    function () use (&$observedForOtherTarget) {
        $observedForOtherTarget = AtomicDecisionContext::authorizes('meeting-1', 'PendingCenterApproval', 'Canceled');
    },
);
check('authorizes() rechaza un destino distinto al autorizado', $observedForOtherTarget, false);

// Origen distinto -> rechazado.
$observedForOtherSource = null;
AtomicDecisionContext::runAuthorized(
    'meeting-1',
    'PendingCenterApproval',
    'Confirmed',
    function () use (&$observedForOtherSource) {
        $observedForOtherSource = AtomicDecisionContext::authorizes('meeting-1', 'Confirmed', 'Confirmed');
    },
);
check('authorizes() rechaza un estado de origen distinto al autorizado', $observedForOtherSource, false);

// operationKey es puramente informativo — no participa en authorizes().
$observedWithOperationKey = null;
AtomicDecisionContext::runAuthorized(
    'meeting-1',
    'PendingCenterApproval',
    'Confirmed',
    function () use (&$observedWithOperationKey) {
        $observedWithOperationKey = AtomicDecisionContext::authorizes('meeting-1', 'PendingCenterApproval', 'Confirmed');
    },
    'op-key-trazabilidad',
);
check('authorizes() ignora operationKey — solo Meeting/origen/destino importan', $observedWithOperationKey, true);

try {
    AtomicDecisionContext::runAuthorized('meeting-1', 'PendingCenterApproval', 'Confirmed', function () {
        throw new RuntimeException('fallo simulado dentro del callback');
    });
    check('runAuthorized() debía relanzar la excepción del callback', 'no lanzó', 'debía lanzar');
} catch (RuntimeException $e) {
    check('runAuthorized() relanza la excepción original del callback', $e->getMessage(), 'fallo simulado dentro del callback');
}
check(
    'authorizes() vuelve a false incluso si el callback lanzó (finally) — excepción dentro del callback limpia el contexto',
    AtomicDecisionContext::authorizes('meeting-1', 'PendingCenterApproval', 'Confirmed'),
    false,
);

// Contexto anidado -> rechazado (LogicException), y limpio después.
try {
    AtomicDecisionContext::runAuthorized('meeting-1', 'PendingCenterApproval', 'Confirmed', function () {
        AtomicDecisionContext::runAuthorized('meeting-2', 'PendingCenterApproval', 'Canceled', fn () => null);
    });
    check('runAuthorized() anidado debía fallar', 'no lanzó', 'debía lanzar LogicException');
} catch (LogicException $e) {
    check('runAuthorized() anidado lanza LogicException', true, true);
}
check(
    'authorizes() vuelve a false tras el intento de anidamiento (contexto exterior no sustituido)',
    AtomicDecisionContext::authorizes('meeting-1', 'PendingCenterApproval', 'Confirmed'),
    false,
);

// Una operación posterior legítima funciona después de una excepción.
$laterReturnValue = AtomicDecisionContext::runAuthorized('meeting-3', 'PendingCenterApproval', 'Canceled', fn () => 'operacion-posterior-ok');
check('runAuthorized() funciona con normalidad tras una excepción/anidamiento previos', $laterReturnValue, 'operacion-posterior-ok');

// ---------------------------------------------------------------------------
// DecisionIdempotencyStore::hashPayload — revisión OCC 2, punto 7 del
// encargo. Debe ser determinista, sensible a cada campo, y NUNCA reversible
// al texto original de `note` (solo se prueba que un `note` distinto cambia
// el hash — no se puede probar "nunca reversible" con una aserción, es una
// propiedad de SHA-256, no de este código).
// ---------------------------------------------------------------------------

$hashA = DecisionIdempotencyStore::hashPayload('meeting-1', 'Confirmed', 'Approved', 'motivo A');
$hashB = DecisionIdempotencyStore::hashPayload('meeting-1', 'Confirmed', 'Approved', 'motivo A');
check('hashPayload() es determinista para el mismo payload', $hashA === $hashB, true);
check('hashPayload() produce un hash hexadecimal de 64 caracteres (SHA-256)', strlen($hashA) === 64 && ctype_xdigit($hashA), true);

$hashDistintaDecision = DecisionIdempotencyStore::hashPayload('meeting-1', 'Canceled', 'RejectedByStaff', 'motivo A');
check('hashPayload() cambia si decision cambia', $hashA === $hashDistintaDecision, false);

$hashDistintoMeeting = DecisionIdempotencyStore::hashPayload('meeting-2', 'Confirmed', 'Approved', 'motivo A');
check('hashPayload() cambia si meetingId cambia', $hashA === $hashDistintoMeeting, false);

$hashDistintaNote = DecisionIdempotencyStore::hashPayload('meeting-1', 'Confirmed', 'Approved', 'motivo B');
check('hashPayload() cambia si note cambia', $hashA === $hashDistintaNote, false);

$hashNoteNull = DecisionIdempotencyStore::hashPayload('meeting-1', 'Confirmed', 'Approved', null);
check('hashPayload() con note=null difiere de note="" o de cualquier texto', $hashA === $hashNoteNull, false);

// "Fase 4B — flujo de decisión final": resultReason debe cambiar el hash
// por sí solo, incluso con meetingId/decision/note idénticos (aquí ambos
// son técnicamente incompatibles con MeetingDecisionTransitionPolicy en la
// práctica de PutDecide, pero hashPayload() en sí no valida compatibilidad
// — solo debe ser sensible al campo).
$hashDistintoReason = DecisionIdempotencyStore::hashPayload('meeting-1', 'Canceled', 'ApprovalExpired', 'motivo A');
$hashOtroReasonMismaDecision = DecisionIdempotencyStore::hashPayload('meeting-1', 'Canceled', 'RejectedByStaff', 'motivo A');
check('hashPayload() cambia si resultReason cambia (misma decision)', $hashDistintoReason === $hashOtroReasonMismaDecision, false);

// ---------------------------------------------------------------------------
// MeetingResolutionReason / MeetingResolutionPolicy — "Fase 4B — flujo de
// decisión final", modelo durable del resultado (hueco 3) y contrato de
// PutDecide (hueco 4: nota obligatoria en rechazo manual, nota técnica
// única en caducidad).
// ---------------------------------------------------------------------------

check('MeetingResolutionReason::isValid(Approved)', MeetingResolutionReason::isValid('Approved'), true);
check('MeetingResolutionReason::isValid(RejectedByStaff)', MeetingResolutionReason::isValid('RejectedByStaff'), true);
check('MeetingResolutionReason::isValid(ApprovalExpired)', MeetingResolutionReason::isValid('ApprovalExpired'), true);
check('MeetingResolutionReason::isValid(null)', MeetingResolutionReason::isValid(null), false);
check('MeetingResolutionReason::isValid(valor inventado)', MeetingResolutionReason::isValid('Whatever'), false);
check('MeetingResolutionReason::isValid("") — vacío no es válido', MeetingResolutionReason::isValid(''), false);
check('MeetingResolutionReason::all() tiene exactamente 3 valores', count(MeetingResolutionReason::all()), 3);

check(
    'MeetingResolutionPolicy::isCompatible(Confirmed, Approved)',
    MeetingResolutionPolicy::isCompatible('Confirmed', 'Approved'),
    true,
);
check(
    'MeetingResolutionPolicy::isCompatible(Confirmed, RejectedByStaff) — incompatible',
    MeetingResolutionPolicy::isCompatible('Confirmed', 'RejectedByStaff'),
    false,
);
check(
    'MeetingResolutionPolicy::isCompatible(Confirmed, ApprovalExpired) — incompatible',
    MeetingResolutionPolicy::isCompatible('Confirmed', 'ApprovalExpired'),
    false,
);
check(
    'MeetingResolutionPolicy::isCompatible(Canceled, RejectedByStaff)',
    MeetingResolutionPolicy::isCompatible('Canceled', 'RejectedByStaff'),
    true,
);
check(
    'MeetingResolutionPolicy::isCompatible(Canceled, ApprovalExpired)',
    MeetingResolutionPolicy::isCompatible('Canceled', 'ApprovalExpired'),
    true,
);
check(
    'MeetingResolutionPolicy::isCompatible(Canceled, Approved) — incompatible',
    MeetingResolutionPolicy::isCompatible('Canceled', 'Approved'),
    false,
);
check(
    'MeetingResolutionPolicy::isCompatible(PendingCenterApproval, Approved) — otros estados nunca admiten un motivo',
    MeetingResolutionPolicy::isCompatible('PendingCenterApproval', 'Approved'),
    false,
);
check(
    'MeetingResolutionPolicy::isCompatible(RequestReceived, cualquier motivo válido) — otros estados nunca admiten un motivo',
    MeetingResolutionPolicy::isCompatible('RequestReceived', 'RejectedByStaff'),
    false,
);
check(
    'MeetingResolutionPolicy::isCompatible con motivo inválido siempre falso, cualquiera sea el estado',
    MeetingResolutionPolicy::isCompatible('Confirmed', 'Whatever'),
    false,
);

check(
    'MeetingResolutionPolicy::isNoteAcceptable(RejectedByStaff, "motivo real")',
    MeetingResolutionPolicy::isNoteAcceptable('RejectedByStaff', 'motivo real'),
    true,
);
check(
    'MeetingResolutionPolicy::isNoteAcceptable(RejectedByStaff, null) — rechazo exige nota',
    MeetingResolutionPolicy::isNoteAcceptable('RejectedByStaff', null),
    false,
);
check(
    'MeetingResolutionPolicy::isNoteAcceptable(RejectedByStaff, "") — vacía no vale',
    MeetingResolutionPolicy::isNoteAcceptable('RejectedByStaff', ''),
    false,
);
check(
    'MeetingResolutionPolicy::isNoteAcceptable(RejectedByStaff, "   ") — solo espacios no vale',
    MeetingResolutionPolicy::isNoteAcceptable('RejectedByStaff', '   '),
    false,
);
check(
    'MeetingResolutionPolicy::isNoteAcceptable(ApprovalExpired, null) — caducidad admite ausencia de nota',
    MeetingResolutionPolicy::isNoteAcceptable('ApprovalExpired', null),
    true,
);
check(
    'MeetingResolutionPolicy::isNoteAcceptable(ApprovalExpired, nota técnica exacta)',
    MeetingResolutionPolicy::isNoteAcceptable('ApprovalExpired', MeetingResolutionReason::EXPIRY_TECHNICAL_NOTE),
    true,
);
check(
    'MeetingResolutionPolicy::isNoteAcceptable(ApprovalExpired, texto libre) — solo la nota técnica prevista o ninguna',
    MeetingResolutionPolicy::isNoteAcceptable('ApprovalExpired', 'un motivo inventado por alguien'),
    false,
);
check(
    'MeetingResolutionPolicy::isNoteAcceptable(Approved, null) — aprobación no exige nota',
    MeetingResolutionPolicy::isNoteAcceptable('Approved', null),
    true,
);
check(
    'MeetingResolutionPolicy::isNoteAcceptable(Approved, "nota informativa opcional")',
    MeetingResolutionPolicy::isNoteAcceptable('Approved', 'nota informativa opcional'),
    true,
);

// ---------------------------------------------------------------------------
// MeetingDecisionAuthorizationPolicy — corrección de puerta 4: política
// cerrada, dos listas separadas (API/humana), "type=api" ya NO es
// autorización por sí solo. `Meeting.edit` (ACL genérico) es una puerta
// SEPARADA evaluada antes en PutDecide::process() — este arnés puro solo
// cubre la política de `isAuthorizedToDecide()` en sí; la interacción real
// con el ACL (p. ej. "API User en la allowlist pero sin Meeting.edit sigue
// dando 403") requiere la instancia EspoCRM desechable, no reproducible sin
// bootstrap del framework.
// ---------------------------------------------------------------------------

// API User permitido explícitamente.
check(
    'isAuthorized: API User cuyo id está en la allowlist de API -> true',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'api', 'api-user-1', ['api-user-1'], []),
    true,
);

// API User no incluido en la allowlist de API, aunque tuviera Meeting.edit
// (el ACL es una puerta distinta, no compensa aquí).
check(
    'isAuthorized: API User cuyo id NO está en la allowlist de API -> false',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'api', 'api-user-2', ['api-user-1'], []),
    false,
);

// API User incluido en la allowlist de API — la política lo autoriza; que
// además tenga o no Meeting.edit es responsabilidad del ACL, evaluado
// antes en PutDecide::process(), no de esta clase.
check(
    'isAuthorized: API User incluido en la allowlist de API -> true (independiente del ACL)',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'api', 'api-user-1', ['api-user-1'], []),
    true,
);

// Usuario regular permitido.
check(
    'isAuthorized: usuario regular cuyo id está en la allowlist humana -> true',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'regular', 'prof-1', [], ['prof-1']),
    true,
);

// Usuario regular no permitido.
check(
    'isAuthorized: usuario regular cuyo id NO está en la allowlist humana -> false',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'regular', 'prof-2', [], ['prof-1']),
    false,
);

// Administrador — autorizado siempre, incluso con ambas listas vacías o
// sin figurar en ninguna.
check(
    'isAuthorized: administrador -> true siempre, listas vacías',
    MeetingDecisionAuthorizationPolicy::isAuthorized(true, 'regular', 'admin-1', [], []),
    true,
);
check(
    'isAuthorized: administrador -> true incluso con type=api y sin figurar en ninguna lista',
    MeetingDecisionAuthorizationPolicy::isAuthorized(true, 'api', 'admin-2', [], []),
    true,
);

// Configuración ausente (nunca escrita) — PutDecide pasa [] como valor por
// defecto de $config->get(); ningún API User ni profesional queda
// autorizado.
check(
    'isAuthorized: configuración ausente ([] en ambas) -> API User denegado',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'api', 'portal-gapssa-api', [], []),
    false,
);
check(
    'isAuthorized: configuración ausente ([] en ambas) -> usuario regular denegado',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'regular', 'prof-1', [], []),
    false,
);

// Configuración corrupta — no es un array (p. ej. un valor escrito a mano
// mal formado en config.php). Nunca lanza, siempre deniega.
check(
    'isAuthorized: allowlist de API corrupta (string) -> false',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'api', 'api-user-1', 'no-es-un-array', []),
    false,
);
check(
    'isAuthorized: allowlist humana corrupta (null) -> false',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'regular', 'prof-1', [], null),
    false,
);
check(
    'isAuthorized: allowlist corrupta (int) -> false',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'api', 'api-user-1', 42, []),
    false,
);

// Ids con tipo inesperado dentro de una lista por lo demás válida — se
// ignoran (nunca se comparan con coerción de tipos), nunca autorizan por
// error.
check(
    'isAuthorized: allowlist con un entero que coincidiría por coerción no autoriza (comparación estricta)',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'api', '0', [0, false, null], []),
    false,
);
check(
    'isAuthorized: allowlist con tipos mixtos sigue reconociendo el id string correcto',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'regular', 'prof-1', [], [123, null, true, 'prof-1']),
    true,
);

// Ningún permiso se hereda por tipo de usuario — estar en la allowlist de
// API no autoriza a un usuario regular con ese mismo id, ni viceversa.
check(
    'isAuthorized: id presente solo en la allowlist de API no autoriza a un usuario regular con ese id',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'regular', 'shared-id', ['shared-id'], []),
    false,
);
check(
    'isAuthorized: id presente solo en la allowlist humana no autoriza a un API User con ese id',
    MeetingDecisionAuthorizationPolicy::isAuthorized(false, 'api', 'shared-id', [], ['shared-id']),
    false,
);

// ---------------------------------------------------------------------------
// DecisionFeatureFlag — Puerta 4 v3, punto 2/3 de la autorización: única
// puerta que también bloquea al administrador (ver cabecera de la clase y
// de `PutDecide` para el porqué). Validación deliberadamente estricta
// (`===`), nunca "truthy" — cada valor de la lista exigida por el encargo,
// probado individualmente. Solo `true` (booleano literal) habilita.
// ---------------------------------------------------------------------------

check('DecisionFeatureFlag::isEnabled(true) — único valor que habilita', DecisionFeatureFlag::isEnabled(true), true);

check('DecisionFeatureFlag::isEnabled(clave ausente, Config::get() sin default -> null)', DecisionFeatureFlag::isEnabled(null), false);
check('DecisionFeatureFlag::isEnabled(false)', DecisionFeatureFlag::isEnabled(false), false);
check('DecisionFeatureFlag::isEnabled(null explícito)', DecisionFeatureFlag::isEnabled(null), false);
check('DecisionFeatureFlag::isEnabled(0)', DecisionFeatureFlag::isEnabled(0), false);
check('DecisionFeatureFlag::isEnabled(1)', DecisionFeatureFlag::isEnabled(1), false);
check('DecisionFeatureFlag::isEnabled("false") — string, no booleano', DecisionFeatureFlag::isEnabled('false'), false);
check('DecisionFeatureFlag::isEnabled("true") — string, no booleano, nunca "truthy"', DecisionFeatureFlag::isEnabled('true'), false);
check('DecisionFeatureFlag::isEnabled([]) — array vacío', DecisionFeatureFlag::isEnabled([]), false);
check('DecisionFeatureFlag::isEnabled([true]) — array no vacío, tampoco', DecisionFeatureFlag::isEnabled([true]), false);
check('DecisionFeatureFlag::isEnabled(objeto/stdClass) — tipo inesperado', DecisionFeatureFlag::isEnabled(new stdClass()), false);
check('DecisionFeatureFlag::isEnabled(1.0) — float, no booleano', DecisionFeatureFlag::isEnabled(1.0), false);
check('DecisionFeatureFlag::isEnabled("") — cadena vacía', DecisionFeatureFlag::isEnabled(''), false);

// ---------------------------------------------------------------------------
// Composición flag + política de autorización — simula, a nivel puro, el
// orden real de las dos puertas dentro de `PutDecide::process()`:
// `DecisionFeatureFlag::isEnabled(...) && MeetingDecisionAuthorizationPolicy::isAuthorized(...)`.
// Objetivo: demostrar que con el flag apagado/ausente/corrupto NINGÚN actor
// -incluido admin- pasaría, y que con el flag en `true` el resultado es
// IDÉNTICO a la matriz de autorización ya probada arriba (el flag no la
// altera, solo la antecede). La interacción real con ACL, transacción y
// base de datos (que el flag corta ANTES de que se ejecuten) solo es
// demostrable contra la instancia EspoCRM desechable — ver punto 4 del
// encargo, no reproducible sin bootstrap del framework (mismo límite ya
// documentado para la política de autorización en solitario).
// ---------------------------------------------------------------------------

function wouldDecide(mixed $flagValue, bool $isAdmin, string $userType, string $userId, mixed $apiIds, mixed $userIds): bool
{
    return DecisionFeatureFlag::isEnabled($flagValue)
        && MeetingDecisionAuthorizationPolicy::isAuthorized($isAdmin, $userType, $userId, $apiIds, $userIds);
}

// Admin — autorizado por la política en solitario, pero bloqueado por el flag.
check(
    'wouldDecide: admin bloqueado con flag ausente (null)',
    wouldDecide(null, true, 'regular', 'admin-1', [], []),
    false,
);
check(
    'wouldDecide: admin bloqueado con flag false',
    wouldDecide(false, true, 'regular', 'admin-1', [], []),
    false,
);
check(
    'wouldDecide: admin bloqueado con flag corrupto ("true" string)',
    wouldDecide('true', true, 'regular', 'admin-1', [], []),
    false,
);

// API User autorizado por la política — bloqueado igual con el flag apagado.
check(
    'wouldDecide: API User autorizado bloqueado con flag apagado (false)',
    wouldDecide(false, false, 'api', 'portal-gapssa-api', ['portal-gapssa-api'], []),
    false,
);
check(
    'wouldDecide: API User autorizado bloqueado con flag corrupto (1)',
    wouldDecide(1, false, 'api', 'portal-gapssa-api', ['portal-gapssa-api'], []),
    false,
);

// Humano autorizado por la política — bloqueado igual con el flag apagado.
check(
    'wouldDecide: humano autorizado bloqueado con flag apagado (false)',
    wouldDecide(false, false, 'regular', 'prof-1', [], ['prof-1']),
    false,
);
check(
    'wouldDecide: humano autorizado bloqueado con flag ausente (null)',
    wouldDecide(null, false, 'regular', 'prof-1', [], ['prof-1']),
    false,
);

// Flag en true — la matriz de autorización queda exactamente igual que sin
// el flag (mismos casos que la sección `MeetingDecisionAuthorizationPolicy`
// de arriba, ahora compuestos con el flag encendido).
check('wouldDecide: flag true + admin -> true (matriz sin alterar)', wouldDecide(true, true, 'regular', 'admin-1', [], []), true);
check(
    'wouldDecide: flag true + API User autorizado -> true (matriz sin alterar)',
    wouldDecide(true, false, 'api', 'portal-gapssa-api', ['portal-gapssa-api'], []),
    true,
);
check(
    'wouldDecide: flag true + API User NO autorizado -> false (matriz sin alterar)',
    wouldDecide(true, false, 'api', 'otro-api', ['portal-gapssa-api'], []),
    false,
);
check(
    'wouldDecide: flag true + humano autorizado -> true (matriz sin alterar)',
    wouldDecide(true, false, 'regular', 'prof-1', [], ['prof-1']),
    true,
);
check(
    'wouldDecide: flag true + humano NO autorizado -> false (matriz sin alterar)',
    wouldDecide(true, false, 'regular', 'prof-2', [], ['prof-1']),
    false,
);

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

if (count($failures) > 0) {
    fwrite(STDERR, sprintf("FALLARON %d de %d comprobaciones:\n", count($failures), count($failures) + $passCount));
    foreach ($failures as $failure) {
        fwrite(STDERR, "  - $failure\n");
    }
    exit(1);
}

fwrite(STDOUT, sprintf("OK — %d comprobaciones pasaron (MeetingHooksPureLogicTest).\n", $passCount));
exit(0);
