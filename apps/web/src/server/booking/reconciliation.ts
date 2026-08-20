import 'server-only'

import {
  buildApprovalExpiryOperationKey,
  decidePendingGuestIdentityPurgeTrigger,
  ESTADO_RESERVA_A_MEETING_STATUS,
  type AuditActor,
  type BookingReconciliationReport,
  type PendingGuestIdentityPurgeTrigger,
} from '@gapssa/contracts'

import { acquireOrRenewBookingLock, releaseBookingLock } from './bookingLock'
import { findZone } from './catalog'
import { deriveResolutionFromDecidedMeeting } from './decisionRecovery'
import { serverEnv } from '../env'
import type { EspoBookingAdapter } from './espoAdapter'
import { processGuestVerificationOtpJob } from './otpOutbox'
import {
  countReviewInconsistencies,
  listAndExpireOverdueReviews,
  reconcileOrphanedPendingPii,
  reconcileReviewsForLinkedBookings,
  recoverStaleProcessingReviews,
} from './review'
import {
  listActiveApprovals,
  listEligibleGuestVerificationOtpJobs,
  listExpiredApprovals,
  listUnresolvedVerifications,
  purgePendingGuestIdentity,
  resolveBookingRequest,
  type BookingRequestRow,
} from './repository'

/**
 * Barrido de conciliación — encargo de Fase 4A, punto 6 y punto 10 ("un
 * barrido recuperable basado en fechas de Postgres, nunca dependiendo
 * solamente del TTL de Redis"), y docs/contratos-portal-v1.md §8.3.
 * Idempotente y seguro de reintentar: cada sub-paso solo actúa sobre filas
 * que de verdad siguen en el estado esperado (mismo patrón CAS que el
 * resto del repositorio), así que ejecutarlo dos veces seguidas nunca
 * duplica una resolución ni una purga.
 *
 * Devuelve `BookingReconciliationReport`
 * (`packages/contracts/src/booking.ts`) tal cual lo define el contrato.
 *
 * Revisión 3, punto 4: desde esta pasada también se dispara el
 * procesamiento de `booking_outbox_jobs` elegibles (`sweepOutboxJobs`,
 * más abajo) — el disparador durable del outbox de OTP de invitado, en vez
 * de depender solo del replay del `POST /requests` original (que la UI
 * nunca repite tras el 202 inicial). Invocable manualmente vía
 * `POST /api/booking/v1/internal/sweep` (protegido por
 * `X-Internal-Api-Secret`, `internalAuth.ts`) — sin cron real del VPS
 * todavía (decisión operativa explícita pendiente antes de producción,
 * punto 9 de `docs/fase4a-reservas.md`). Frecuencia recomendada cuando se
 * programe: cada 1-2 minutos — el lease del outbox dura 2 minutos
 * (`repository.ts::LEASE_DURATION_MINUTES`) y el backoff de reintento tras
 * un fallo es de 5 minutos (`OUTBOX_RETRY_BACKOFF_MINUTES`), así que un
 * intervalo más corto que el lease no gana nada (el job seguiría sin
 * poder reclamarse hasta que venza) y uno mucho más largo retrasa
 * innecesariamente la recuperación de un job abandonado o vencido.
 */

const SYSTEM_ACTOR: AuditActor = { type: 'system', name: 'bff' }

function emptyPurgeCounters(): Record<PendingGuestIdentityPurgeTrigger, number> {
  return {
    meeting_linked: 0,
    verification_expired: 0,
    request_canceled: 0,
    recovery_window_exceeded: 0,
    review_rejected: 0,
    review_expired: 0,
  }
}

function emptyOutboxSweepReport(): BookingReconciliationReport['outboxJobs'] {
  return { sent: 0, retryable: 0, notProcessable: 0, abandonedRecovered: 0 }
}

/**
 * Cuántos candidatos elegibles procesa como máximo UNA pasada del barrido —
 * revisión 3, punto 4: "procesarlos por lotes limitados". Un lote acotado
 * evita que una pasada tarde de forma imprevisible si se acumulan muchos
 * jobs elegibles a la vez (p. ej. tras una caída prolongada de SMTP); los
 * candidatos que no caben en el lote quedan igual de elegibles para la
 * siguiente pasada (no se marcan ni se tocan de ningún modo al listarlos).
 */
const OUTBOX_SWEEP_BATCH_LIMIT = 25

/**
 * Disparador durable del outbox de OTP de invitado (revisión 3, punto 4) —
 * el replay del `POST /requests` original no basta: tras recibir 202, la
 * UI pasa a pedir el código y no tiene motivo para repetir esa petición,
 * así que un job que quedó `failed_retryable`/`processing` abandonado sin
 * que nadie vuelva a invocar la creación necesita OTRO camino para
 * avanzar. Esta función lista un lote acotado de candidatos elegibles
 * (`listEligibleGuestVerificationOtpJobs`, sin bloquear filas) y reclama
 * cada uno por separado con la MISMA operación atómica que usa el camino
 * dirigido (`processGuestVerificationOtpJob` -> `claimGuestVerificationOtpJob`,
 * un `UPDATE ... WHERE ...` mono-fila) — nunca mantiene una transacción de
 * Postgres abierta mientras espera a Redis/SMTP, y un fallo al procesar UN
 * candidato (esperado o no) nunca aborta el resto del lote, mismo
 * principio que `sweepExpiredApprovals`/`sweepExpiredVerifications` más
 * abajo.
 */
async function sweepOutboxJobs(now: Date, report: BookingReconciliationReport): Promise<void> {
  const candidates = await listEligibleGuestVerificationOtpJobs(now, OUTBOX_SWEEP_BATCH_LIMIT)

  for (const candidate of candidates) {
    try {
      const outcome = await processGuestVerificationOtpJob(candidate.bookingRequestId, now)
      const recoveredAbandoned = candidate.reason === 'abandoned_processing' && outcome !== 'no_eligible_job'

      switch (outcome) {
        case 'sent':
          report.outboxJobs.sent += 1
          break
        case 'rate_limited':
        case 'failed_retryable':
          report.outboxJobs.retryable += 1
          break
        case 'expired':
        case 'no_eligible_job':
          report.outboxJobs.notProcessable += 1
          break
      }
      if (recoveredAbandoned) {
        report.outboxJobs.abandonedRecovered += 1
      }
    } catch {
      report.outboxJobs.notProcessable += 1
    }
  }
}

async function releaseLockSilently(record: Pick<BookingRequestRow, 'id' | 'professionalId' | 'zoneId'>): Promise<void> {
  try {
    await releaseBookingLock({ requestId: record.id, professionalId: record.professionalId, zoneId: record.zoneId })
  } catch {
    // Best-effort — Postgres ya es la fuente de verdad de la resolución.
  }
}

/**
 * Paso: `pending_approval` cuyo `approvalExpiresAt` venció → Meeting a
 * Canceled (motivo técnico), solicitud a `approval_expired`.
 *
 * Revisión 2 de Fase 4A, punto 6: `expireMeeting` puede no ganar su CAS
 * (`WHERE cEstadoReserva = 'PendingCenterApproval'`) por dos motivos muy
 * distintos que la versión anterior trataba como el mismo caso — "ya se
 * resolvió, nada que hacer": (a) una pasada anterior de este mismo barrido
 * SÍ canceló el Meeting pero cayó antes de resolver
 * `BookingRequestRecord` (fallo parcial real, la solicitud queda
 * `pending_approval` para siempre si nadie reconcilia), o (b) el centro
 * decidió (aprobó/rechazó) el Meeting manualmente antes de que expirara.
 * Ahora se consulta el estado ACTUAL y duradero del Meeting
 * (`adapter.getMeetingById`) y se adopta la resolución que de verdad le
 * corresponde — nunca se asume, nunca se sobrescribe una decisión ya
 * asentada con `approval_expired`. Si el estado no puede interpretarse con
 * seguridad, se cuenta en `inconsistentMeetings` para revisión manual en
 * vez de dejar la solicitud atascada en silencio.
 *
 * Un fallo inesperado en UNA candidata (p. ej. un error de Postgres ajeno
 * a las ramas previstas) nunca debe abortar el resto del barrido ni la
 * respuesta HTTP del propio endpoint — cada solicitud es independiente y
 * se reintenta en la siguiente pasada.
 */
async function sweepExpiredApprovals(
  adapter: EspoBookingAdapter,
  now: Date,
  report: BookingReconciliationReport,
): Promise<void> {
  const candidates = await listExpiredApprovals(now)

  for (const record of candidates) {
    if (!record.meetingId) {
      continue
    }

    try {
      // "Fase 4B — flujo de decisión final", punto 3: clave DETERMINISTA
      // derivada del bookingRequestId — nunca una UUID nueva por pasada del
      // barrido. Dos pasadas sobre la MISMA solicitud vencida (p. ej. tras
      // un timeout de la primera) reenvían la MISMA operationKey; `PutDecide`
      // la reconoce como replay.
      const expiredMeeting = await adapter.expireMeeting({
        meetingId: record.meetingId,
        operationKey: buildApprovalExpiryOperationKey(record.id),
      })
      if (expiredMeeting) {
        const outcome = await resolveBookingRequest(record.id, 'approval_expired', 'ApprovalExpired', SYSTEM_ACTOR, 'web', now)
        if (outcome === 'resolved') {
          report.expiredApprovals += 1
          await releaseLockSilently(record)
        }
        continue
      }

      // El CAS no ganó — consulta el estado actual y duradero del Meeting
      // para reconciliar en vez de asumir.
      const currentMeeting = await adapter.getMeetingById(record.meetingId)
      if (!currentMeeting) {
        report.inconsistentMeetings += 1
        continue
      }

      const derived = deriveResolutionFromDecidedMeeting(currentMeeting)
      if (!derived) {
        // Estado que no puede interpretarse con seguridad (p. ej. sigue
        // `PendingCenterApproval` por una carrera rarísima) — nunca se
        // inventa una resolución; queda para revisión manual.
        report.inconsistentMeetings += 1
        continue
      }

      // Idempotente frente a `resolveBookingRequest` (CAS interno sobre
      // `status`): tanto si esta llamada completa una resolución que se
      // quedó a medias en una pasada anterior, como si otra pasada
      // concurrente ya la completó justo ahora, el resultado converge en
      // una única resolución — el lock solo se libera cuando la
      // resolución duradera queda de verdad confirmada.
      const outcome = await resolveBookingRequest(record.id, derived.resolution, derived.reasonCode, SYSTEM_ACTOR, 'web', now)
      if (derived.resolution === 'approval_expired' && outcome === 'resolved') {
        report.expiredApprovals += 1
      }
      if (outcome === 'resolved' || outcome === 'already_resolved') {
        await releaseLockSilently(record)
      }
    } catch {
      report.inconsistentMeetings += 1
    }
  }
}

/**
 * Paso: `pending_verification`/`verification_processing` sin Meeting cuyo
 * plazo venció → `verification_expired`, purga `PendingGuestIdentity` (solo
 * invitado — el flujo autenticado nunca crea una).
 */
async function sweepExpiredVerifications(now: Date, report: BookingReconciliationReport): Promise<void> {
  const recoveryWindowMs = serverEnv.BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES * 60 * 1000
  const candidates = await listUnresolvedVerifications()

  for (const record of candidates) {
    // Un fallo inesperado en UNA candidata nunca debe abortar el resto del
    // barrido ni la respuesta HTTP del propio endpoint (mismo principio
    // que `sweepExpiredApprovals`) — el registro sigue sin resolver, así
    // que la siguiente pasada vuelve a intentarlo, nunca se pierde.
    try {
      const recoveryDeadline = new Date(record.verificationExpiresAt.getTime() + recoveryWindowMs)

      if (record.status === 'verification_processing') {
        const trigger = decidePendingGuestIdentityPurgeTrigger(record, now, recoveryDeadline)
        if (trigger !== 'recovery_window_exceeded') {
          continue
        }

        const outcome = await resolveBookingRequest(record.id, 'verification_expired', 'RecoveryWindowExceeded', SYSTEM_ACTOR, 'web', now)
        if (outcome !== 'resolved') {
          continue
        }
        report.expiredVerifications += 1
        if (!record.clientAccountId) {
          await purgePendingGuestIdentity(record.id, 'recovery_window_exceeded', now)
          report.purgedGuestIdentities.recovery_window_exceeded += 1
        }
        await releaseLockSilently(record)
        continue
      }

      // status === 'pending_verification'
      if (now.getTime() <= record.verificationExpiresAt.getTime()) {
        continue
      }

      const outcome = await resolveBookingRequest(record.id, 'verification_expired', 'VerificationExpired', SYSTEM_ACTOR, 'web', now)
      if (outcome !== 'resolved') {
        continue
      }
      report.expiredVerifications += 1

      if (!record.clientAccountId) {
        // Confirma el disparador con la función pura del contrato, ya sobre
        // el estado resuelto — nunca se asume "verification_expired" a mano.
        const trigger = decidePendingGuestIdentityPurgeTrigger(
          { status: 'resolved', resolution: 'verification_expired', meetingId: null },
          now,
          recoveryDeadline,
        )
        if (trigger) {
          await purgePendingGuestIdentity(record.id, trigger, now)
          report.purgedGuestIdentities[trigger] += 1
        }
      }
      await releaseLockSilently(record)
    } catch {
      continue
    }
  }
}

/** Paso: reconstruye en Redis el BookingLock de toda solicitud activa que todavía no se resolvió en esta misma pasada. */
async function reconstructActiveLocks(now: Date, report: BookingReconciliationReport): Promise<void> {
  const unresolvedVerifications = await listUnresolvedVerifications()
  for (const record of unresolvedVerifications) {
    if (now.getTime() > record.verificationExpiresAt.getTime()) {
      continue // ya cubierto (o lo será) por sweepExpiredVerifications
    }
    const zone = findZone(record.zoneId)
    const ttlSeconds = Math.max(1, Math.floor((record.verificationExpiresAt.getTime() - now.getTime()) / 1000))
    const result = await acquireOrRenewBookingLock({
      requestId: record.id,
      phase: 'verification',
      treatmentId: record.treatmentId,
      professionalId: record.professionalId,
      zoneId: record.zoneId,
      startAt: record.startAt,
      endAt: record.endAt,
      zoneCapacity: zone?.capacidadSimultanea ?? 1,
      ttlSeconds,
    }).catch(() => null)
    if (result === 'acquired') {
      report.reconstructedLocks += 1
    }
  }

  const activeApprovals = await listActiveApprovals(now)
  for (const record of activeApprovals) {
    const zone = findZone(record.zoneId)
    const approvalExpiresAt = record.approvalExpiresAt
    if (!approvalExpiresAt) {
      continue
    }
    const ttlSeconds = Math.max(1, Math.floor((approvalExpiresAt.getTime() - now.getTime()) / 1000))
    const result = await acquireOrRenewBookingLock({
      requestId: record.id,
      phase: 'approval',
      treatmentId: record.treatmentId,
      professionalId: record.professionalId,
      zoneId: record.zoneId,
      startAt: record.startAt,
      endAt: record.endAt,
      zoneCapacity: zone?.capacidadSimultanea ?? 1,
      ttlSeconds,
    }).catch(() => null)
    if (result === 'acquired') {
      report.reconstructedLocks += 1
    }
  }
}

export async function runBookingReconciliationSweep(
  adapter: EspoBookingAdapter,
  now: Date = new Date(),
): Promise<BookingReconciliationReport> {
  const report: BookingReconciliationReport = {
    ranAt: now.toISOString(),
    reconstructedLocks: 0,
    expiredApprovals: 0,
    expiredVerifications: 0,
    purgedGuestIdentities: emptyPurgeCounters(),
    inconsistentMeetings: 0,
    outboxJobs: emptyOutboxSweepReport(),
    expiredReviews: 0,
    recoveredStaleReviewClaims: 0,
    reviewInconsistencies: 0,
    reconciledCompletedReviews: 0,
    orphanedPiiInconsistencies: 0,
  }

  // Antes de expirar nada: da a cada job elegible su oportunidad de
  // entregarse (o de cerrarse limpiamente si ya no procede — punto 5) con
  // el estado más fresco posible, en vez de dejarlo para una pasada
  // posterior sin necesidad.
  await sweepOutboxJobs(now, report)
  await sweepExpiredApprovals(adapter, now, report)
  await sweepExpiredVerifications(now, report)
  // Revisión 2 de Fase 4B, punto 3/6: sin esto, `contact_review_pending`
  // volvía a ser un estado sin caducidad propia si ningún operador actuaba
  // nunca — mismo espíritu que sweepExpiredApprovals/sweepExpiredVerifications.
  report.expiredReviews = await listAndExpireOverdueReviews(now).catch(() => 0)
  // Revisión 3 de Fase 4B, punto 9: revisiones `processing` cuyo lease
  // venció (reanudación abandonada) — se devuelven a `pending`, vuelven a
  // ser reclamables. Nunca decide qué Contact es correcto, solo libera el
  // claim.
  report.recoveredStaleReviewClaims = await recoverStaleProcessingReviews(now).catch(() => 0)
  // Revisión 4 de Fase 4B, punto 2: revisiones activas cuya solicitud ya
  // demuestra un resultado durable de éxito (Meeting vinculado) — cerradas
  // como `resolved` en esta pasada; nunca se arrebata una con lease vigente
  // de un worker activo. Se ejecuta ANTES de contar `reviewInconsistencies`
  // para que lo que se reconcilia aquí no se cuente también como huérfano.
  report.reconciledCompletedReviews = await reconcileReviewsForLinkedBookings(now).catch(() => 0)
  // Revisión 4 de Fase 4B, punto 4: identidad pendiente (invitado/cliente
  // autenticado) todavía `active` pese a que la solicitud ya demuestra un
  // resultado durable — purgada con el disparador seguro que corresponda;
  // si el estado real no permite decidirlo, cuenta como inconsistencia.
  const piiReconciliation = await reconcileOrphanedPendingPii(now).catch(
    () => ({ purgedByTrigger: {}, inconsistencies: 0 }) satisfies Awaited<ReturnType<typeof reconcileOrphanedPendingPii>>,
  )
  for (const [trigger, purgedCount] of Object.entries(piiReconciliation.purgedByTrigger) as [PendingGuestIdentityPurgeTrigger, number][]) {
    report.purgedGuestIdentities[trigger] += purgedCount
  }
  report.orphanedPiiInconsistencies = piiReconciliation.inconsistencies
  // Estados parciales/heredados que el barrido detecta pero NUNCA decide
  // por su cuenta (`contact_review_pending` sin revisión activa, revisión
  // activa con la solicitud ya resuelta/aprobada, revisiones activas
  // duplicadas heredadas) — quedan contados para revisión manual.
  report.reviewInconsistencies = await countReviewInconsistencies().catch(() => 0)
  await reconstructActiveLocks(now, report)

  // Suma (nunca sobrescribe) sobre lo que `sweepExpiredApprovals` ya contó
  // — son dos señales de inconsistencia distintas bajo el mismo contador
  // (`BookingReconciliationReport.inconsistentMeetings`): estados de
  // Meeting decididos que no se pueden traducir a una resolución de
  // negocio segura (arriba), y Meetings cuyo `cEstadoReserva`/`status`
  // nativo están mutuamente desalineados (aquí). Sobrescribir borraba
  // silenciosamente la primera señal.
  const meetings = await adapter.listAllMeetings()
  report.inconsistentMeetings += meetings.filter(
    (meeting) => ESTADO_RESERVA_A_MEETING_STATUS[meeting.cEstadoReserva] !== meeting.status,
  ).length

  return report
}
