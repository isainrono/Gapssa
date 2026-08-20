import 'server-only'

import { decidePendingGuestIdentityPurgeTrigger, type AuditActor, type AuditChannel, type PendingGuestIdentityPurgeTrigger } from '@gapssa/contracts'

import { serverEnv } from '../env'
import type { EspoBookingAdapter } from './espoAdapter'
import {
  claimBookingReview,
  closeBookingReviewAndResolveRequestTransactionally,
  closeBookingReviewResolved,
  closeOrphanedBookingReviewAfterLinkedRequest,
  countPendingBookingReviews,
  findBookingRequestById,
  findBookingReviewById,
  listActiveBookingReviewsForLinkedRequests,
  listContactReviewPendingRequestsWithoutActiveReview,
  listDuplicateActiveBookingReviewGroups,
  listExpiredBookingReviews,
  listOrphanedActiveBookingReviews,
  listPendingBookingReviews,
  listRequestsWithOrphanedActivePii,
  listStaleProcessingBookingReviews,
  openBookingReviewAtomic,
  purgePendingAuthenticatedContactDetails,
  purgePendingGuestIdentity,
  releaseBookingReviewToPending,
  type BookingReviewRow,
} from './repository'
import {
  completeBookingToMeeting,
  decryptGuestIdentity,
  IncompatibleMeetingError,
  reconstructAuthenticatedContactDetails,
  ReviewLeaseLostError,
} from './verificationSteps'

/**
 * Ciclo de vida completo de `BookingReviewRecord` — revisión 3 de Fase 4B,
 * puntos 1/2/3/4/9. `verificationSteps.ts` solo ABRE revisiones (nunca las
 * cierra); este módulo es el ÚNICO que las reclama/resuelve/rechaza/caduca,
 * y el único que reanuda `completeBookingToMeeting` tras una resolución —
 * mismo principio de "una sola puerta" que `repository.ts` para Postgres.
 *
 * Workflow durable con lease (punto 2):
 *
 *   pending -> processing (claim) -> resolved
 *                                 -> pending (fallo transitorio, retryable)
 *                                 -> replaced (otro conflicto durante la reanudación)
 *   pending|processing -> rejected|expired (transaccional con la solicitud, punto 3)
 *
 * Nunca se mantiene una transacción de Postgres abierta mientras se llama
 * al adaptador de EspoCRM (que en producción es HTTP real, latencia
 * impredecible) — el claim es una única `UPDATE ... WHERE ... RETURNING`
 * (`repository.ts::claimBookingReview`), y el cierre final es otra
 * operación separada, corta, condicionada al mismo `claimToken`. Esto es
 * claim/lease + reconciliación, nunca una transacción distribuida ficticia.
 */

const SYSTEM_ACTOR: AuditActor = { type: 'system', name: 'bff' }

/** Cadena opaca razonable — mismo alfabeto que un id real de EspoCRM o un UUID de la simulación (`db/schema.ts`), nunca espacios/control/caracteres de inyección. Solo la primera puerta de `validateResolutionContactId`; la que de verdad importa es la existencia real contra el adaptador. */
const OPAQUE_ESPO_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

/** Listado paginado y seguro para un endpoint interno — nunca PII, nunca candidatos (ver `repository.ts::listPendingBookingReviews`, y `getBookingReviewDetailForOperators` para el detalle con candidatos). */
export async function listPendingReviewsForOperators(
  limit = 50,
  offset = 0,
): Promise<{ reviews: Awaited<ReturnType<typeof listPendingBookingReviews>>; total: number }> {
  const [reviews, total] = await Promise.all([listPendingBookingReviews(limit, offset), countPendingBookingReviews()])
  return { reviews, total }
}

/**
 * Revisión 3 de Fase 4B, punto 5: detalle COMPLETO de una revisión para el
 * endpoint interno de detalle — a diferencia del listado, sí incluye
 * `candidateContactIds`/`candidateMeetingIds` (siguen siendo IDs opacos de
 * EspoCRM, nunca PII) para que un operador autorizado los use como
 * referencia al abrir las fichas reales dentro de EspoCRM. Sigue siendo
 * `internal/**`, protegido por `X-Internal-Api-Secret` — nunca alcanzable
 * desde el navegador.
 */
export async function getBookingReviewDetailForOperators(reviewId: string): Promise<BookingReviewRow | null> {
  return findBookingReviewById(reviewId)
}

async function reconstructContactForResume(
  bookingRequestId: string,
  clientAccountId: string | null,
): Promise<{ gapssaAccountId?: string | null; firstName: string; lastName: string; email: string; phone: string } | null> {
  if (clientAccountId) {
    return reconstructAuthenticatedContactDetails(clientAccountId, bookingRequestId)
  }
  return decryptGuestIdentity(bookingRequestId)
}

type ValidateResolutionContactIdOutcome =
  | { outcome: 'valid'; contactId: string }
  | { outcome: 'invalid_format' }
  | { outcome: 'not_found' }
  | { outcome: 'not_a_candidate' }

/** `conflictType` cuyo conflicto es directamente "varios Contact candidatos" — ahí, y SOLO ahí, `resolutionContactId` debe pertenecer a `candidateContactIds`. Los conflictos relacionados con Meeting no tienen una lista de Contact candidatos que exigir (`evaluateContactAdoption`, en la propia reanudación, es quien valida la coherencia con el Meeting). */
const CONFLICT_TYPES_REQUIRING_CANDIDATE_MEMBERSHIP: ReadonlySet<BookingReviewRow['conflictType']> = new Set([
  'contact_multiple_matches',
  'contact_conflicting_signals',
])

/**
 * Revisión 3 de Fase 4B, punto 4: `resolutionContactId` NUNCA se acepta
 * como un valor de confianza ciega del cuerpo de la petición HTTP.
 *
 *   1. Formato — cadena opaca razonable, nunca espacios/control/inyección.
 *   2. Existencia real — `adapter.getContactById` contra el Contact real
 *      (o simulado); nunca se asume que un id con buen formato existe.
 *   3. Pertenencia — para conflictos de CANDIDATOS de Contact, el id
 *      elegido DEBE estar en `candidateContactIds`; nunca un Contact
 *      arbitrario ajeno a los candidatos que el propio sistema detectó, y
 *      nunca se relaciona automáticamente un Contact que el operador no
 *      haya seleccionado explícitamente.
 *
 * Solo se registran IDs opacos en cualquier auditoría/log derivado de este
 * módulo — nunca nombre/correo/teléfono del Contact consultado.
 */
async function validateResolutionContactId(
  adapter: EspoBookingAdapter,
  review: Pick<BookingReviewRow, 'conflictType' | 'candidateContactIds'>,
  resolutionContactId: string,
): Promise<ValidateResolutionContactIdOutcome> {
  if (!OPAQUE_ESPO_ID_PATTERN.test(resolutionContactId)) {
    return { outcome: 'invalid_format' }
  }

  const contact = await adapter.getContactById(resolutionContactId)
  if (!contact) {
    return { outcome: 'not_found' }
  }

  if (CONFLICT_TYPES_REQUIRING_CANDIDATE_MEMBERSHIP.has(review.conflictType)) {
    const candidates = review.candidateContactIds ?? []
    if (!candidates.includes(resolutionContactId)) {
      return { outcome: 'not_a_candidate' }
    }
  }

  return { outcome: 'valid', contactId: contact.id }
}

export type ResolveReviewOutcome =
  | { outcome: 'resolved'; meetingId: string }
  /**
   * Revisión 4, punto 3: el Meeting SÍ se creó y `BookingRequestRecord`
   * SÍ confirmó `pending_approval` (mismo requisito que `resolved`), pero el
   * cierre de `BookingReviewRecord` no pudo confirmarse con este
   * `claimToken` (`lease_lost`) y, al releerla, sigue activa bajo otro
   * propietario — nunca se afirma que la revisión está resuelta si no lo
   * está; la reserva en sí es un éxito real, queda conciliación interna
   * pendiente (barrido, punto 2).
   */
  | { outcome: 'resolved_review_reconciliation_pending'; meetingId: string }
  | { outcome: 'still_pending_review' }
  | { outcome: 'not_found' }
  | { outcome: 'already_closed' }
  /** Revisión 3, punto 2: otra reanudación tiene el claim vigente — reintentar más tarde, nunca un error del operador. */
  | { outcome: 'in_progress' }
  | { outcome: 'invalid_contact_id_format' }
  | { outcome: 'contact_not_found' }
  | { outcome: 'contact_not_a_candidate' }
  | { outcome: 'contact_details_unavailable' }
  | { outcome: 'incompatible_meeting' }
  /**
   * Revisión 4, punto 1: esta reanudación dejó de ser propietaria de la
   * revisión (otro worker la reclamó, o su lease venció y fue recuperado)
   * ANTES de completar el cierre — ninguna fila se modificó por esta
   * llamada; el Meeting NO se creó por esta llamada (si el conflicto surgió
   * al intentar reemplazar la revisión por otra nueva, nunca se llegó a
   * escribir nada). Nunca un error del operador — la revisión activa sigue
   * en manos de su propietario legítimo, reintentar contra ELLA.
   */
  | { outcome: 'review_lease_lost' }
  /** Fallo transitorio (p. ej. EspoCRM caído a mitad de la reanudación) — la revisión vuelve a `pending`, reclamable de inmediato; nunca se pierde. */
  | { outcome: 'transient_failure' }

/**
 * Un operador autorizado, tras localizar los candidatos reales DENTRO de
 * EspoCRM (nunca a partir de lo que expone esta API), elige de forma
 * inequívoca el Contact real que corresponde a esta solicitud. Reclama la
 * revisión atómicamente (`claimBookingReview`) antes de tocar nada más —
 * revisión 3, punto 2: solo el poseedor de ese claim puede cerrarla o
 * devolverla a `pending`. Reanuda `completeBookingToMeeting` saltando el
 * matching automático — si la reanudación misma encuentra OTRO conflicto,
 * `completeBookingToMeeting` reemplaza esta revisión atómicamente
 * (`replacesReviewId`) en vez de dejarla cerrada sin salida.
 */
export async function resolveBookingReview(
  adapter: EspoBookingAdapter,
  reviewId: string,
  resolutionContactId: string,
  resolvedBy: string,
  now: Date = new Date(),
): Promise<ResolveReviewOutcome> {
  const claim = await claimBookingReview(reviewId, now)
  if (claim.outcome === 'not_found') {
    return { outcome: 'not_found' }
  }
  if (claim.outcome === 'already_closed') {
    return { outcome: 'already_closed' }
  }
  if (claim.outcome === 'in_progress') {
    return { outcome: 'in_progress' }
  }

  const review = claim.review
  const actor: AuditActor = { type: 'user', id: resolvedBy }
  const channel: AuditChannel = 'admin_espocrm'

  const record = await findBookingRequestById(review.bookingRequestId)
  if (!record || record.status !== 'contact_review_pending') {
    await releaseBookingReviewToPending(review.id, review.claimToken)
    return { outcome: 'not_found' }
  }

  const validation = await validateResolutionContactId(adapter, review, resolutionContactId)
  if (validation.outcome !== 'valid') {
    await releaseBookingReviewToPending(review.id, review.claimToken)
    if (validation.outcome === 'invalid_format') {
      return { outcome: 'invalid_contact_id_format' }
    }
    if (validation.outcome === 'not_found') {
      return { outcome: 'contact_not_found' }
    }
    return { outcome: 'contact_not_a_candidate' }
  }

  const contact = await reconstructContactForResume(record.id, record.clientAccountId)
  if (!contact) {
    await releaseBookingReviewToPending(review.id, review.claimToken)
    return { outcome: 'contact_details_unavailable' }
  }

  let result: Awaited<ReturnType<typeof completeBookingToMeeting>>
  try {
    result = await completeBookingToMeeting(adapter, record, contact, {
      purgeGuestIdentityAfterLink: record.clientAccountId === null,
      actor,
      channel,
      resolvedContactId: validation.contactId,
      replaces: { reviewId: review.id, claimToken: review.claimToken },
    })
  } catch (error) {
    if (error instanceof IncompatibleMeetingError) {
      // El propio Meeting ya no coincide en horario/tratamiento/profesional/
      // zona (edición manual en EspoCRM mientras la revisión estaba
      // abierta) — nunca se deja esta revisión cerrada sin salida: se
      // reemplaza por una revisión de inconsistencia (`meeting_incompatible`),
      // trazable y accionable, en vez de un error que un operador no puede
      // resolver desde aquí. El reemplazo solo se autoriza si `review.claimToken`
      // sigue siendo el vigente — revisión 4, punto 1.
      const openOutcome = await openBookingReviewAtomic(
        {
          bookingRequestId: record.id,
          conflictType: 'meeting_incompatible',
          candidateContactIds: null,
          candidateMeetingIds: [error.meetingId],
          holdHours: serverEnv.BOOKING_CONTACT_REVIEW_HOLD_HOURS,
          replaces: { reviewId: review.id, claimToken: review.claimToken },
        },
        actor,
        channel,
        now,
      )
      if (openOutcome.outcome === 'lease_lost') {
        return { outcome: 'review_lease_lost' }
      }
      return { outcome: 'incompatible_meeting' }
    }

    if (error instanceof ReviewLeaseLostError) {
      // Revisión 4, punto 1: la propia reanudación (dentro de
      // `completeBookingToMeeting`, al intentar abrir/reemplazar una
      // revisión por OTRO conflicto encontrado durante la reanudación)
      // perdió la propiedad de esta revisión — ninguna fila se modificó al
      // recibir esto. Nunca se llama a `releaseBookingReviewToPending`: ya
      // no hay nada que liberar (sería un no-op seguro contra el CAS, pero
      // además inútil), y hacerlo podría malinterpretarse como que esta
      // llamada seguía siendo dueña de algo.
      return { outcome: 'review_lease_lost' }
    }

    // Fallo transitorio inesperado (red, EspoCRM caído, timeout) — nunca se
    // pierde la revisión: vuelve de inmediato a `pending`, reclamable por
    // el siguiente intento (dirigido o de barrido). Nunca se mantiene una
    // transacción de Postgres abierta durante esta llamada (ver cabecera
    // del módulo), así que no hay nada que revertir aquí salvo el propio
    // claim.
    await releaseBookingReviewToPending(review.id, review.claimToken)
    return { outcome: 'transient_failure' }
  }

  if (result.outcome === 'contact_review_pending') {
    // La reanudación misma volvió a topar con un conflicto (nuevo, distinto
    // del ya cerrado) — `completeBookingToMeeting` ya abrió/reemplazó la
    // revisión correspondiente (`replaces` arriba); nunca se trata como
    // éxito.
    return { outcome: 'still_pending_review' }
  }

  // meeting_created — NUNCA se cierra la revisión "a ciegas": se confirma
  // que BookingRequestRecord alcanzó de verdad `pending_approval` en
  // Postgres antes de cerrarla (revisión 3, punto 2, requisito explícito).
  const confirmed = await findBookingRequestById(record.id)
  if (!confirmed || confirmed.status !== 'pending_approval') {
    await releaseBookingReviewToPending(review.id, review.claimToken)
    return { outcome: 'transient_failure' }
  }

  const closeOutcome = await closeBookingReviewResolved(review.id, review.claimToken, resolutionContactId, resolvedBy, actor, channel, now)
  if (closeOutcome === 'closed' || closeOutcome === 'not_found') {
    // 'not_found' es inalcanzable en la práctica (la fila existía hace
    // instantes) — tratado como éxito igualmente: el Meeting/la solicitud
    // ya están correctos.
    return { outcome: 'resolved', meetingId: result.meetingId }
  }

  // Revisión 4, punto 3: 'lease_lost' NUNCA se asume ciegamente como "otro
  // worker ya lo cerró" — otro propietario PUDO haber cerrado/reemplazado
  // legítimamente la revisión mientras esta llamada terminaba (éxito real
  // igualmente), pero también pudo seguir activa bajo otro dueño (ningún
  // cierre real ocurrió todavía). Se relee antes de decidir.
  const currentReview = await findBookingReviewById(review.id)
  if (!currentReview || currentReview.status === 'resolved' || currentReview.status === 'replaced') {
    return { outcome: 'resolved', meetingId: result.meetingId }
  }
  // Sigue pending/processing/rejected/expired bajo otro propietario o por
  // otra vía — el Meeting y la solicitud YA están correctos (confirmado
  // arriba), así que la reserva en sí es un éxito real, pero NUNCA se
  // afirma que esta revisión está resuelta si no lo está: queda para el
  // barrido de conciliación (punto 2, `reconcileReviewsForLinkedBookings`).
  return { outcome: 'resolved_review_reconciliation_pending', meetingId: result.meetingId }
}

export type RejectOrExpireReviewOutcome = 'closed' | 'not_found' | 'already_closed' | 'in_progress'

/**
 * Rechazo manual (Gapssa determina que los candidatos NO corresponden a la
 * misma persona, o que el conflicto no es resoluble) — revisión 3, punto 3:
 * cierre de la revisión + resolución de la solicitud + purga de la
 * identidad pendiente, TODO en una única transacción de `gapssa_booking`
 * (`repository.ts::closeBookingReviewAndResolveRequestTransactionally`).
 * Terminal: nunca se reabre. `in_progress` si hay una reanudación en curso
 * (`processing`) — nunca se rechaza una revisión que otra llamada tiene
 * reclamada.
 */
export async function rejectBookingReview(reviewId: string, rejectedBy: string, now: Date = new Date()): Promise<RejectOrExpireReviewOutcome> {
  const actor: AuditActor = { type: 'user', id: rejectedBy }
  const channel: AuditChannel = 'admin_espocrm'

  const outcome = await closeBookingReviewAndResolveRequestTransactionally(
    reviewId,
    'rejected',
    null,
    'contact_review_rejected',
    'ContactReviewRejectedByStaff',
    'review_rejected',
    rejectedBy,
    actor,
    channel,
    now,
  )

  return outcome === 'lease_lost' ? 'in_progress' : outcome
}

/** Caducidad por barrido (`reconciliation.ts`) — mismo cierre transaccional que el rechazo manual, pero con actor `system`. */
export async function expireBookingReview(review: Pick<BookingReviewRow, 'id' | 'bookingRequestId'>, now: Date = new Date()): Promise<RejectOrExpireReviewOutcome> {
  const channel: AuditChannel = 'web'

  const outcome = await closeBookingReviewAndResolveRequestTransactionally(
    review.id,
    'expired',
    null,
    'contact_review_expired',
    'ContactReviewExpired',
    'review_expired',
    null,
    SYSTEM_ACTOR,
    channel,
    now,
  )

  return outcome === 'lease_lost' ? 'in_progress' : outcome
}

/** Revisiones `pending` cuyo plazo venció — usado por el barrido de conciliación (`reconciliation.ts`). */
export async function listAndExpireOverdueReviews(now: Date): Promise<number> {
  const expired = await listExpiredBookingReviews(now)
  let count = 0
  for (const review of expired) {
    const outcome = await expireBookingReview(review, now).catch(() => 'already_closed' as const)
    if (outcome === 'closed') {
      count += 1
    }
  }
  return count
}

/**
 * Revisión 3 de Fase 4B, punto 9: revisiones `processing` cuyo lease venció
 * (reanudación abandonada — el proceso que la reclamó cayó a mitad de
 * `completeBookingToMeeting`) — se devuelven a `pending`, vuelven a ser
 * reclamables por el siguiente intento (dirigido o de barrido). Nunca se
 * inventa una decisión de Contact aquí: solo libera el claim.
 */
export async function recoverStaleProcessingReviews(now: Date): Promise<number> {
  const stale = await listStaleProcessingBookingReviews(now)
  let recovered = 0
  for (const review of stale) {
    if (!review.claimToken) {
      continue
    }
    const outcome = await releaseBookingReviewToPending(review.id, review.claimToken).catch(() => 'lease_lost' as const)
    if (outcome === 'released') {
      recovered += 1
    }
  }
  return recovered
}

/**
 * Revisión 3 de Fase 4B, punto 9: cuenta (nunca resuelve) los estados
 * parciales/heredados de conciliación de revisiones — `contact_review_pending`
 * sin revisión activa, revisión activa con la solicitud ya fuera de
 * `contact_review_pending`, y grupos de más de una revisión activa
 * heredada. Ningún caso se decide automáticamente: quedan para revisión
 * manual (mismo principio que `inconsistentMeetings`).
 */
export async function countReviewInconsistencies(): Promise<number> {
  const [withoutReview, orphaned, duplicateGroups] = await Promise.all([
    listContactReviewPendingRequestsWithoutActiveReview(),
    listOrphanedActiveBookingReviews(),
    listDuplicateActiveBookingReviewGroups(),
  ])
  return withoutReview.length + orphaned.length + duplicateGroups.length
}

/**
 * Revisión 4 de Fase 4B, punto 2: cierra revisiones activas cuya solicitud
 * ya demuestra un resultado durable de éxito (`meetingId` escrito +
 * `pending_approval`/`resolved`) — cubre la ventana entre ese resultado
 * durable y el cierre normal de `resolveBookingReview` (proceso caído o
 * lease perdido justo en medio). Nunca vuelve a elegir Contact, nunca llama
 * a `findOrCreateContact`, nunca crea otro Meeting: el resultado durable YA
 * demuestra que el flujo terminó. Una revisión `processing` con lease
 * vigente de un worker activo se salta sin contar como error — queda para
 * una pasada posterior.
 */
export async function reconcileReviewsForLinkedBookings(now: Date): Promise<number> {
  const candidates = await listActiveBookingReviewsForLinkedRequests()
  let reconciled = 0
  for (const review of candidates) {
    const outcome = await closeOrphanedBookingReviewAfterLinkedRequest(review.id, SYSTEM_ACTOR, 'web', now).catch(() => 'already_closed' as const)
    if (outcome === 'reconciled') {
      reconciled += 1
    }
  }
  return reconciled
}

export interface OrphanedPiiReconciliationResult {
  purgedByTrigger: Partial<Record<PendingGuestIdentityPurgeTrigger, number>>
  inconsistencies: number
}

/**
 * Revisión 4 de Fase 4B, punto 4: purga de forma segura la identidad
 * pendiente (invitado o cliente autenticado) de solicitudes que ya
 * demuestran un resultado durable (`meetingId` escrito, o `resolved`) pero
 * cuya PII sigue `active` — cubre la ventana real entre ese resultado
 * durable y su propia purga (p. ej. una caída del proceso entre
 * `writeMeetingIdAndPendingApproval` y `purgePendingGuestIdentity`, dos
 * escrituras separadas y no transaccionales entre sí,
 * `verificationSteps.ts::completeBookingToMeeting`). El disparador se
 * decide con la misma función pura que el resto del módulo
 * (`decidePendingGuestIdentityPurgeTrigger`) — si el estado real no permite
 * determinar uno seguro, se cuenta como inconsistencia, nunca se purga a
 * ciegas.
 */
export async function reconcileOrphanedPendingPii(now: Date): Promise<OrphanedPiiReconciliationResult> {
  const candidates = await listRequestsWithOrphanedActivePii()
  const purgedByTrigger: Partial<Record<PendingGuestIdentityPurgeTrigger, number>> = {}
  let inconsistencies = 0

  for (const candidate of candidates) {
    const trigger = decidePendingGuestIdentityPurgeTrigger(candidate, now, now)
    if (!trigger) {
      inconsistencies += 1
      continue
    }
    try {
      if (candidate.clientAccountId) {
        await purgePendingAuthenticatedContactDetails(candidate.id, trigger, now)
      } else {
        await purgePendingGuestIdentity(candidate.id, trigger, now)
      }
      purgedByTrigger[trigger] = (purgedByTrigger[trigger] ?? 0) + 1
    } catch {
      inconsistencies += 1
    }
  }

  return { purgedByTrigger, inconsistencies }
}
