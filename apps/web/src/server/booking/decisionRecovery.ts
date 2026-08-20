import 'server-only'

import type { AuditActor, AuditChannel, BookingReasonCode, BookingRequestResolution, EstadoReserva, MeetingResolutionReason } from '@gapssa/contracts'

import { recordEventBookingAuditEvent } from './audit'
import { bookingDb } from './db/client'
import { SimulatedEspoBookingAdapter, type EspoBookingAdapter, type SimMeeting } from './espoAdapter'
import { isIdempotencyKeyReusedConflict } from './httpEspoAdapter'
import { ensureDecisionOperationKey, findBookingRequestByMeetingId, resolveBookingRequest, resolveBookingRequestWithinTx } from './repository'

/**
 * Recuperación de la decisión humana de Gapssa sobre un Meeting — revisión
 * 2 de Fase 4A, punto 5. La ruta `internal/decisions` escribía primero en
 * el Meeting (`adapter.decideMeeting`, CAS `WHERE cEstadoReserva =
 * 'PendingCenterApproval'`) y LUEGO resolvía el `BookingRequestRecord`
 * (`resolveBookingRequest`) como dos pasos independientes: si el segundo
 * fallaba (o el proceso caía entre medias), el Meeting quedaba decidido
 * pero la solicitud atascada en `pending_approval` para siempre — un
 * reintento del mismo endpoint solo veía `decideMeeting` fallar (el CAS ya
 * no encuentra `PendingCenterApproval`) y devolvía `not_pending`, sin
 * completar nunca el BFF.
 *
 * `applyOrAdoptBookingDecision` sustituye esa lógica:
 *
 * 1. Si `SimulatedEspoBookingAdapter` comparte base de datos con el
 *    repositorio (siempre en esta fase), el intento "en caliente" (decidir
 *    + resolver + auditar) corre en una ÚNICA transacción de
 *    `gapssa_booking` — reduce al mínimo la ventana de fallo parcial para
 *    el adaptador simulado.
 * 2. Si el CAS no gana (ya decidido por otra vía, o el intento anterior sí
 *    decidió el Meeting pero no llegó a resolver la solicitud), se
 *    consulta el estado ACTUAL y duradero del Meeting
 *    (`adapter.getMeetingById`) para reconciliar:
 *    - Si refleja la MISMA decisión (mismo `decision`, decidida por una
 *      persona, no por el barrido de expiración) -> se adopta de forma
 *      idempotente, completando la resolución si todavía faltaba.
 *    - Si refleja una decisión INCOMPATIBLE (la contraria, o una
 *      expiración de sistema) -> conflicto explícito, nunca se sobrescribe;
 *      se deja un evento `SystemReconciliation` en la auditoría para
 *      revisión.
 *
 * Este mismo algoritmo (pasos 2 en adelante) es válido sin ninguna
 * transacción compartida — es el diseño que seguirá funcionando cuando
 * `SimulatedEspoBookingAdapter` se sustituya por un adaptador HTTP real
 * contra EspoCRM (Fase 4+), donde nunca habrá una transacción distribuida
 * entre "EspoCRM decidió" y "Postgres resolvió".
 */

/**
 * `decidedBy` que usa el barrido de expiración
 * (`espoAdapter.ts::expireMeeting`) — dato puramente informativo/depuración
 * desde "Fase 4B — flujo de decisión final". NUNCA participa en
 * `deriveResolutionFromDecidedMeeting` (ver hueco 3 del encargo original:
 * `decidedBy`/`modifiedById` identifica al usuario/proceso TÉCNICO que
 * ejecutó la escritura, no el motivo de negocio) — la fuente de verdad del
 * motivo es `SimMeeting.resolutionReason`.
 */
export const SYSTEM_EXPIRY_DECIDED_BY = 'system:approval-sweep'

export type DerivedMeetingResolution =
  | { resolution: 'confirmed'; reasonCode: 'Approved' }
  | { resolution: 'rejected'; reasonCode: 'RejectedByStaff' }
  | { resolution: 'approval_expired'; reasonCode: 'ApprovalExpired' }

/**
 * Deriva, de forma pura, qué resolución de `BookingRequestRecord`
 * corresponde a un Meeting YA decidido (`cEstadoReserva` distinto de
 * `PendingCenterApproval`) — compartida por `applyOrAdoptBookingDecision`
 * (reconciliación de una decisión concreta) y por el barrido de expiración
 * (`reconciliation.ts::sweepExpiredApprovals`, que reconcilia sin conocer
 * de antemano qué decisión buscar).
 *
 * "Fase 4B — flujo de decisión final", hueco 3/4 del encargo: lee
 * EXCLUSIVAMENTE `resolutionReason` (el campo durable y cerrado,
 * `Meeting.cMotivoResolucionReserva` en EspoCRM real) — nunca
 * `decidedBy`/`modifiedById`. Devuelve `null` (nunca inventa una
 * resolución; el llamante lo trata como inconsistencia para revisión
 * manual) en cualquiera de estos casos, todos ellos "fallar seguro":
 *
 * - `cEstadoReserva` no es `Confirmed` ni `Canceled` (p. ej. sigue
 *   `PendingCenterApproval` por una carrera, o es un estado ajeno al
 *   flujo de decisión).
 * - `Canceled` sin motivo (`resolutionReason === null`) — dato heredado de
 *   antes de que este campo existiera, o una escritura que se saltó la
 *   guarda por algún camino no contemplado.
 * - `Confirmed` con un motivo que no sea `Approved` (motivo incompatible —
 *   nunca debería ocurrir si todo pasó por `PutDecide`/`MeetingResolutionPolicy`,
 *   pero esta función nunca asume que así fue).
 * - `Canceled` con un motivo que no sea `RejectedByStaff`/`ApprovalExpired`
 *   (p. ej. `Approved` por error, o cualquier valor no reconocido).
 *
 * Nunca reinterpreta un dato heredado ambiguo de otra forma — la única
 * salida posible ante la duda es "no lo sé" (`null`), nunca una adivinanza.
 */
export function deriveResolutionFromDecidedMeeting(
  meeting: Pick<SimMeeting, 'cEstadoReserva' | 'resolutionReason'>,
): DerivedMeetingResolution | null {
  if (meeting.cEstadoReserva === 'Confirmed') {
    return meeting.resolutionReason === 'Approved' ? { resolution: 'confirmed', reasonCode: 'Approved' } : null
  }
  if (meeting.cEstadoReserva === 'Canceled') {
    if (meeting.resolutionReason === 'RejectedByStaff') {
      return { resolution: 'rejected', reasonCode: 'RejectedByStaff' }
    }
    if (meeting.resolutionReason === 'ApprovalExpired') {
      return { resolution: 'approval_expired', reasonCode: 'ApprovalExpired' }
    }
    return null
  }
  return null
}

export type ApplyBookingDecisionOutcome =
  | { outcome: 'applied'; requestId: string; resolution: BookingRequestResolution; cEstadoReserva: EstadoReserva }
  | { outcome: 'already_applied_compatible'; requestId: string; resolution: BookingRequestResolution; cEstadoReserva: EstadoReserva }
  | { outcome: 'conflict'; requestId: string; existingResolution: BookingRequestResolution | null; existingCEstadoReserva: EstadoReserva }
  /**
   * Corrección de puerta 4, bloqueo de concurrencia: el Meeting real ni
   * refleja esta decisión ni una decisión incompatible reconocible — sigue
   * `PendingCenterApproval` (el `operationKey` reutilizado pertenecía a
   * otro Meeting/solicitud, o el CAS no ganó por una razón ajena a una
   * decisión real) o presenta una combinación `cEstadoReserva`/`resolutionReason`
   * incoherente (dato heredado o corrupto). Nunca se traduce como éxito ni
   * como el mismo `decision_conflict` que "otra decisión humana ganó" —
   * requiere revisión manual explícita.
   */
  | {
      outcome: 'inconsistent'
      requestId: string
      meetingId: string
      cEstadoReserva: EstadoReserva
      resolutionReason: MeetingResolutionReason | null
    }
  | { outcome: 'not_found' }

/**
 * `idempotencyKey`: candidata aportada por el cliente operativo del
 * endpoint interno (o generada allí si no la trae) — nunca se usa
 * directamente como `operationKey` del adaptador; `ensureDecisionOperationKey`
 * decide cuál gana de verdad (ver su docstring, `repository.ts`). `note` es
 * obligatoria y no vacía cuando `decision === 'rejected'` (a nivel de
 * tipo).
 */
export type ApplyBookingDecisionInput =
  | { meetingId: string; decision: 'approved'; decidedBy: string; note?: string; idempotencyKey: string }
  | { meetingId: string; decision: 'rejected'; decidedBy: string; note: string; idempotencyKey: string }

/** Narrowing explícito de `input.decision` — `adapter.decideMeeting` exige el par decision/note exacto a nivel de tipo, un simple spread no lo preserva. */
function callDecideMeeting(adapter: EspoBookingAdapter, input: ApplyBookingDecisionInput, operationKey: string) {
  if (input.decision === 'approved') {
    return adapter.decideMeeting({ meetingId: input.meetingId, decision: 'approved', decidedBy: input.decidedBy, note: input.note, operationKey })
  }
  return adapter.decideMeeting({ meetingId: input.meetingId, decision: 'rejected', decidedBy: input.decidedBy, note: input.note, operationKey })
}

export async function applyOrAdoptBookingDecision(
  adapter: EspoBookingAdapter,
  input: ApplyBookingDecisionInput,
  now: Date = new Date(),
): Promise<ApplyBookingDecisionOutcome> {
  const bookingRequest = await findBookingRequestByMeetingId(input.meetingId)
  if (!bookingRequest) {
    return { outcome: 'not_found' }
  }

  const targetResolution: BookingRequestResolution = input.decision === 'approved' ? 'confirmed' : 'rejected'
  const targetReasonCode: BookingReasonCode = input.decision === 'approved' ? 'Approved' : 'RejectedByStaff'
  const actor: AuditActor = { type: 'system', name: 'espocrm' }
  const channel: AuditChannel = 'admin_espocrm'

  // "Fase 4B — flujo de decisión final", punto 3 del encargo: la clave de
  // idempotencia se asegura y persiste ANTES de tocar el adaptador (el
  // primer efecto externo) — cualquier reintento de esta MISMA solicitud,
  // con cualquier `idempotencyKey` candidata, converge en la clave que
  // ganó la primera vez.
  const operationKey = await ensureDecisionOperationKey(bookingRequest.id, input.idempotencyKey)

  if (bookingRequest.status !== 'resolved') {
    if (adapter instanceof SimulatedEspoBookingAdapter) {
      // Camino feliz atómico — decisión + resolución + auditoría en una
      // única transacción de gapssa_booking (ambas tablas viven ahí).
      const decided = await bookingDb.transaction(async (tx) => {
        const txAdapter = new SimulatedEspoBookingAdapter(tx)
        const result = await callDecideMeeting(txAdapter, input, operationKey)
        if (!result) {
          return null
        }
        await resolveBookingRequestWithinTx(tx, bookingRequest.id, targetResolution, targetReasonCode, actor, channel, now)
        return result
      })

      if (decided) {
        return { outcome: 'applied', requestId: bookingRequest.id, resolution: targetResolution, cEstadoReserva: decided.cEstadoReserva }
      }
    } else {
      // Adaptador real futuro — sin transacción distribuida: dos pasos
      // secuenciales, cada uno recuperable por su cuenta (ver reconciliación
      // más abajo si el segundo no llega a ejecutarse).
      let decided: SimMeeting | null
      try {
        decided = await callDecideMeeting(adapter, input, operationKey)
      } catch (error) {
        // Corrección de puerta 4, bloqueo de concurrencia: única excepción
        // que se captura aquí — el código contractual EXACTO "operationKey
        // ya usada con un payload distinto" (`isIdempotencyKeyReusedConflict`,
        // `httpEspoAdapter.ts`). Ocurre cuando dos decisiones HUMANAS
        // distintas compiten por el mismo `bookingRequestId`:
        // `ensureDecisionOperationKey` ya fijó la MISMA `operationKey` para
        // ambas (arriba), así que la segunda en llegar a `PutDecide` la ve
        // reutilizada con un payload distinto y responde 409. Nunca se
        // genera aquí una `operationKey` nueva para reintentar — se cae al
        // mismo camino de reconciliación de abajo que un CAS no ganado,
        // releyendo el Meeting real. Cualquier otro error (401/403/404/5xx,
        // red, parseo, cualquier 409 no reconocido) se relanza tal cual —
        // nunca se convierte en un 409 propio ni en un éxito inventado.
        if (!isIdempotencyKeyReusedConflict(error)) {
          throw error
        }
        decided = null
      }
      if (decided) {
        await resolveBookingRequest(bookingRequest.id, targetResolution, targetReasonCode, actor, channel, now)
        return { outcome: 'applied', requestId: bookingRequest.id, resolution: targetResolution, cEstadoReserva: decided.cEstadoReserva }
      }
    }
  }

  // El CAS no ganó (o la solicitud ya estaba resuelta) — reconcilia contra
  // el estado ACTUAL y duradero del Meeting, nunca contra lo que
  // `decideMeeting` acaba de intentar escribir.
  const currentMeeting = await adapter.getMeetingById(input.meetingId)
  if (!currentMeeting) {
    return { outcome: 'not_found' }
  }

  const derived = deriveResolutionFromDecidedMeeting(currentMeeting)

  if (derived === null) {
    // Corrección de puerta 4, bloqueo de concurrencia: el Meeting no
    // refleja NINGUNA decisión reconocible — sigue `PendingCenterApproval`
    // (típicamente: el `operationKey` reutilizado pertenecía a otro
    // Meeting/solicitud, no a una decisión real sobre ESTE) o presenta una
    // combinación `cEstadoReserva`/`resolutionReason` incoherente. Esto NO
    // es "otra decisión humana ganó" (`conflict`, más abajo) — es un
    // estado que ni confirma ni descarta esta decisión, así que nunca se
    // inventa un resultado; se deja constancia para revisión manual.
    await recordEventBookingAuditEvent({
      entity: 'BookingRequestRecord',
      entityId: bookingRequest.id,
      actor,
      channel,
      occurredAt: now.toISOString(),
      reasonCode: 'SystemReconciliation',
    }).catch(() => {})
    return {
      outcome: 'inconsistent',
      requestId: bookingRequest.id,
      meetingId: input.meetingId,
      cEstadoReserva: currentMeeting.cEstadoReserva,
      resolutionReason: currentMeeting.resolutionReason,
    }
  }

  const matchesThisDecision = derived.resolution === targetResolution && derived.reasonCode === targetReasonCode

  if (!matchesThisDecision) {
    // Conflicto explícito — el Meeting SÍ tiene una decisión final
    // reconocible, pero es la incompatible (ganó la otra). Nunca se
    // sobrescribe una decisión ya asentada. Se deja constancia en la
    // auditoría para revisión humana (nunca copia la nota operativa de
    // EspoCRM, solo el hecho de la discrepancia).
    await recordEventBookingAuditEvent({
      entity: 'BookingRequestRecord',
      entityId: bookingRequest.id,
      actor,
      channel,
      occurredAt: now.toISOString(),
      reasonCode: 'SystemReconciliation',
    }).catch(() => {})
    return {
      outcome: 'conflict',
      requestId: bookingRequest.id,
      existingResolution: bookingRequest.status === 'resolved' ? bookingRequest.resolution : null,
      existingCEstadoReserva: currentMeeting.cEstadoReserva,
    }
  }

  // Compatible: el Meeting SÍ refleja esta misma decisión humana. Si la
  // solicitud todavía no se había resuelto (fallo parcial anterior:
  // Meeting decidido, resolución nunca completada), esta llamada la
  // completa AHORA — recuperación real, no solo una respuesta idempotente
  // de fachada.
  const repoOutcome = await resolveBookingRequest(bookingRequest.id, targetResolution, targetReasonCode, actor, channel, now)
  if (repoOutcome === 'not_found') {
    return { outcome: 'not_found' }
  }
  return {
    outcome: repoOutcome === 'resolved' ? 'applied' : 'already_applied_compatible',
    requestId: bookingRequest.id,
    resolution: targetResolution,
    cEstadoReserva: currentMeeting.cEstadoReserva,
  }
}
