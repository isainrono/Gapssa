import 'server-only'

import { APPROVAL_HOLD_HOURS, type AuditActor, type AuditChannel, type BookingReviewConflictType } from '@gapssa/contracts'

import { findAccountById } from '../auth/repository'
import { decryptField } from '../crypto/fieldCrypto'
import { serverEnv } from '../env'
import { acquireOrRenewBookingLock } from './bookingLock'
import { findZone } from './catalog'
import { resolveControlledTestGcsExclusion } from './controlledTestMode'
import { evaluateContactAdoption, type EspoBookingAdapter, type SimMeeting } from './espoAdapter'
import {
  findPendingAuthenticatedContactDetails,
  findPendingGuestIdentity,
  openBookingReviewAtomic,
  purgePendingAuthenticatedContactDetails,
  purgePendingGuestIdentity,
  writeMeetingIdAndPendingApproval,
  type BookingRequestRow,
} from './repository'

/**
 * Pasos 5-10 del flujo recuperable de verificación
 * (docs/contratos-portal-v1.md §3.4) — compartidos entre invitado (tras
 * verificar el OTP) y cliente autenticado (síncrono, sin OTP: la sesión ya
 * prueba identidad). Único punto que crea/vincula el Meeting — encargo de
 * Fase 4A, punto 7: "No duplicar lógica de negocio entre invitado y
 * cliente autenticado".
 *
 * Revisión 2 de Fase 4B (puntos 1/2/3): orden REESTRUCTURADO respecto a la
 * versión anterior. Antes se buscaba el Meeting (paso 5) y solo si no
 * existía se resolvía el Contact (paso 6) — eso impedía validar la
 * identidad de un Meeting YA EXISTENTE (adoptado por `cBookingRequestId`)
 * contra el Contact esperado, porque en ese camino nunca se llegaba a
 * calcular cuál era "el Contact esperado". Ahora:
 *
 *   1. Se resuelve SIEMPRE el Contact esperado primero
 *      (`findOrCreateContact`, idempotente — un reintento nunca crea un
 *      segundo Contact para la misma identidad). Ambiguo -> revisión
 *      manual, el Meeting nunca se toca.
 *   2. Se busca el Meeting por `cBookingRequestId`
 *      (`MeetingLookupResult`, nunca `rows[0]` si hay más de uno).
 *      Duplicado -> revisión manual. Ninguno -> se crea. Uno -> se valida
 *      compatibilidad de horario/tratamiento/profesional/zona (ya
 *      existente) Y AHORA TAMBIÉN la relación con el Contact esperado
 *      (`evaluateContactAdoption`): cero Contacts, varios, o uno distinto
 *      -> revisión manual: nunca se adopta un Meeting cuya identidad no
 *      está confirmada de forma inequívoca.
 *   3. `createMeeting` puede a su vez detectar una carrera que produjo dos
 *      Meetings — también termina en revisión manual, nunca elige.
 */

export interface ContactDetails {
  gapssaAccountId?: string | null
  firstName: string
  lastName: string
  email: string
  phone: string
}

export type CompleteBookingToMeetingResult = { outcome: 'meeting_created'; meetingId: string } | { outcome: 'contact_review_pending' }

/**
 * Fase 4B: un Meeting encontrado por `cBookingRequestId` cuyo
 * horario/tratamiento/profesional/zona no coincide con la solicitud es un
 * estado inconsistente distinto de una ambigüedad de Contact (más grave:
 * sugiere una edición manual o un error de datos, no una coincidencia
 * dudosa) — se detiene con un error explícito para que quede como
 * incidente operativo, nunca se adopta ni se sobrescribe en silencio.
 */
export class IncompatibleMeetingError extends Error {
  constructor(
    readonly bookingRequestId: string,
    readonly meetingId: string,
  ) {
    super(`Meeting ${meetingId} encontrado por cBookingRequestId=${bookingRequestId} no es compatible con la solicitud — no se adopta.`)
    this.name = 'IncompatibleMeetingError'
  }
}

/**
 * Revisión 4 de Fase 4B, punto 1: la reanudación pasó `options.replaces`
 * (creía seguir siendo propietaria de una revisión `processing`), pero
 * `openBookingReviewAtomic` devolvió `lease_lost` — otro worker ya reclamó
 * esa revisión, o su lease venció y fue recuperado, mientras esta
 * reanudación seguía en curso. NINGUNA fila se modificó al recibir esto
 * (`repository.ts::openBookingReviewAtomic`) — quien reanuda ya no tiene
 * nada que liberar ni que cerrar, solo debe detenerse y reportarlo tal cual
 * (`review.ts::resolveBookingReview`, outcome `review_lease_lost`).
 */
export class ReviewLeaseLostError extends Error {
  constructor(readonly bookingRequestId: string) {
    super(`Se perdió la propiedad de la revisión en reanudación para bookingRequestId=${bookingRequestId} — otro worker la reclamó.`)
    this.name = 'ReviewLeaseLostError'
  }
}

function isCompatibleMeeting(
  meeting: Pick<SimMeeting, 'treatmentId' | 'professionalId' | 'zoneId' | 'startAt' | 'endAt'>,
  record: Pick<BookingRequestRow, 'treatmentId' | 'professionalId' | 'zoneId' | 'startAt' | 'endAt'>,
): boolean {
  return (
    meeting.treatmentId === record.treatmentId &&
    meeting.professionalId === record.professionalId &&
    meeting.zoneId === record.zoneId &&
    meeting.startAt.getTime() === record.startAt.getTime() &&
    meeting.endAt.getTime() === record.endAt.getTime()
  )
}

/** `ContactAdoptionOutcome['outcome']` que no es `'compatible'`, mapeado al `BookingReviewConflictType` cerrado que le corresponde (booking.ts). */
const CONTACT_ADOPTION_CONFLICT: Record<'missing' | 'multiple' | 'mismatch', BookingReviewConflictType> = {
  missing: 'meeting_contact_missing',
  multiple: 'meeting_multiple_contacts',
  mismatch: 'meeting_contact_mismatch',
}

/**
 * Revisión 3 de Fase 4B, punto 1: apertura ATÓMICA en una sola puerta
 * (`repository.ts::openBookingReviewAtomic`) — ya no dos llamadas
 * separadas (`transitionToContactReviewPending` + `createBookingReview`,
 * dos transacciones distintas con una ventana real entre ambas). `opened`/
 * `idempotent_existing`/`conflict_existing_review` se tratan igual desde
 * aquí: en los tres casos la solicitud queda (o ya estaba)
 * `contact_review_pending` con una revisión activa detrás — nunca flotante
 * — que es la única garantía que `completeBookingToMeeting` necesita de
 * esta función. `not_found`/`invalid_state` son errores de llamante (la
 * solicitud debe estar en `verification_processing`, o en
 * `contact_review_pending` cuando `replacesReviewId` viene de una
 * reanudación — ver `review.ts`).
 */
async function openReview(
  bookingRequestId: string,
  conflictType: BookingReviewConflictType,
  candidateContactIds: string[] | null,
  candidateMeetingIds: string[] | null,
  actor: AuditActor,
  channel: AuditChannel,
  now: Date,
  replaces?: { reviewId: string; claimToken: string },
): Promise<void> {
  const outcome = await openBookingReviewAtomic(
    {
      bookingRequestId,
      conflictType,
      candidateContactIds,
      candidateMeetingIds,
      holdHours: serverEnv.BOOKING_CONTACT_REVIEW_HOLD_HOURS,
      replaces,
    },
    actor,
    channel,
    now,
  )

  if (outcome.outcome === 'not_found' || outcome.outcome === 'invalid_state') {
    throw new Error(`No se puede abrir una revisión de Contact/Meeting para ${bookingRequestId}: ${outcome.outcome}.`)
  }
  if (outcome.outcome === 'lease_lost') {
    throw new ReviewLeaseLostError(bookingRequestId)
  }
}

export interface CompleteBookingToMeetingOptions {
  purgeGuestIdentityAfterLink: boolean
  actor: AuditActor
  channel: AuditChannel
  /**
   * Revisión 2 de Fase 4B, punto 3: reanudación tras resolver una revisión
   * manual — un operador ya eligió, de forma inequívoca, el Contact
   * correcto (`review.ts::resolveBookingReview`). Cuando se pasa, se
   * SALTA `findOrCreateContact` por completo (nunca se repite un matching
   * automático que ya se demostró ambiguo) y se usa este Contact
   * directamente como "el esperado" para el resto del flujo — la
   * validación de compatibilidad del paso 2 (`evaluateContactAdoption`)
   * sigue aplicando igual sobre él.
   */
  resolvedContactId?: string
  /**
   * Revisión 3 de Fase 4B, punto 2 / revisión 4, punto 1: id + `claimToken`
   * exactos de la revisión que un operador tiene reclamada
   * (`review.ts::claimBookingReview`) al reanudar — si la reanudación misma
   * topa con OTRO conflicto, cualquier `openReview` disparado aquí abajo
   * intenta reemplazarla atómicamente (`replaced`) en vez de tratarla como
   * "ya existe una revisión activa". El reemplazo solo se autoriza si
   * `claimToken` sigue siendo el vigente (nunca solo el id) — si no,
   * `openReview` lanza `ReviewLeaseLostError` (nunca se deja la revisión
   * vieja cerrada sin salida NI se reemplaza sin seguir siendo su
   * propietario).
   */
  replaces?: { reviewId: string; claimToken: string }
}

export async function completeBookingToMeeting(
  adapter: EspoBookingAdapter,
  record: Pick<BookingRequestRow, 'id' | 'treatmentId' | 'professionalId' | 'zoneId' | 'startAt' | 'endAt'>,
  contact: ContactDetails,
  options: CompleteBookingToMeetingOptions,
): Promise<CompleteBookingToMeetingResult> {
  const now = new Date()

  // Paso 1 (reestructurado): resuelve SIEMPRE el Contact esperado primero
  // — idempotente, nunca crea un segundo Contact para la misma identidad
  // en un reintento.
  let expectedContactId: string
  if (options.resolvedContactId) {
    expectedContactId = options.resolvedContactId
  } else {
    const match = await adapter.findOrCreateContact({
      gapssaAccountId: contact.gapssaAccountId ?? null,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
    })

    if (match.outcome === 'manual_review') {
      const conflictType: BookingReviewConflictType = match.reason === 'conflicting_signals' ? 'contact_conflicting_signals' : 'contact_multiple_matches'
      await openReview(record.id, conflictType, match.candidateContactIds, null, options.actor, options.channel, now, options.replaces)
      return { outcome: 'contact_review_pending' }
    }
    expectedContactId = match.contact.id
  }

  // Paso 2: búsqueda idempotente por cBookingRequestId — nunca `rows[0]`
  // si hay más de un Meeting.
  const lookup = await adapter.findMeetingByBookingRequestId(record.id)

  if (lookup.outcome === 'duplicate') {
    await openReview(record.id, 'meeting_duplicate', null, lookup.meetingIds, options.actor, options.channel, now, options.replaces)
    return { outcome: 'contact_review_pending' }
  }

  // Puerta 5B-2A: decisión ÚNICA y central, compartida por el camino de
  // adopción (abajo) y el de creación — `undefined` en operación normal
  // (todos los entornos reales hoy), nunca leída de ningún dato que el
  // navegador pueda influir (`controlledTestMode.ts`).
  const expectedGcsExclusion = resolveControlledTestGcsExclusion()

  let meeting: SimMeeting
  if (lookup.outcome === 'found') {
    if (!isCompatibleMeeting(lookup.meeting, record)) {
      throw new IncompatibleMeetingError(record.id, lookup.meeting.id)
    }

    // Puerta 5B-2A: solo se evalúa dentro de una ejecución de prueba
    // controlada (`expectedGcsExclusion !== undefined`) — en operación
    // normal el campo ni se lee ni influye en nada, cero cambio de
    // comportamiento respecto a antes de esta puerta. Nunca se muta el
    // Meeting encontrado para "corregir" el campo — se abre revisión
    // manual, igual que cualquier otra incompatibilidad de adopción, nunca
    // se asume qué pasó.
    if (expectedGcsExclusion !== undefined && lookup.meeting.cExcluirGoogleCalendarSync !== expectedGcsExclusion) {
      await openReview(record.id, 'meeting_gcs_exclusion_mismatch', null, [lookup.meeting.id], options.actor, options.channel, now, options.replaces)
      return { outcome: 'contact_review_pending' }
    }

    const adoption = evaluateContactAdoption({ contactIds: lookup.meeting.contactIds, expectedContactId })
    if (adoption.outcome !== 'compatible') {
      const conflictType = CONTACT_ADOPTION_CONFLICT[adoption.outcome]
      const candidateContactIds = adoption.outcome === 'mismatch' ? [adoption.actualContactId] : adoption.outcome === 'multiple' ? lookup.meeting.contactIds : null
      await openReview(record.id, conflictType, candidateContactIds, [lookup.meeting.id], options.actor, options.channel, now, options.replaces)
      return { outcome: 'contact_review_pending' }
    }

    meeting = lookup.meeting
  } else {
    const createOutcome = await adapter.createMeeting({
      bookingRequestId: record.id,
      contactId: expectedContactId,
      treatmentId: record.treatmentId,
      professionalId: record.professionalId,
      zoneId: record.zoneId,
      startAt: record.startAt,
      endAt: record.endAt,
      controlledTestExcludeGcs: expectedGcsExclusion,
    })

    if (createOutcome.outcome === 'duplicate') {
      await openReview(record.id, 'meeting_duplicate', null, createOutcome.meetingIds, options.actor, options.channel, now, options.replaces)
      return { outcome: 'contact_review_pending' }
    }
    meeting = createOutcome.meeting
  }

  // Paso 3 — idempotente: si meetingId ya estaba escrito, no-op. El
  // `UPDATE` y su evento de auditoría (solo cuando ESTA llamada gana la
  // transición real, nunca en una repetición idempotente que encontró el
  // trabajo ya hecho — mismo principio que `completeEmailVerification`,
  // Fase 3) se confirman/revierten juntos dentro de
  // `writeMeetingIdAndPendingApproval` (repository.ts). No exige un
  // `status` de partida concreto (funciona igual reanudando desde
  // `contact_review_pending` que desde `verification_processing`).
  const approvalExpiresAt = new Date(now.getTime() + APPROVAL_HOLD_HOURS * 60 * 60 * 1000)
  await writeMeetingIdAndPendingApproval(record.id, meeting.id, approvalExpiresAt, options.actor, options.channel, now)

  // Paso 4 — SOLO tras confirmar que meetingId quedó persistido (la
  // llamada anterior ya lo garantiza: o escribió, o ya estaba escrito de un
  // intento previo — nunca se llega aquí sin esa confirmación). Purga tanto
  // la identidad de invitado como la de cliente autenticado — cada una
  // no-op si no aplica a este flujo/ya se purgó.
  if (options.purgeGuestIdentityAfterLink) {
    await purgePendingGuestIdentity(record.id, 'meeting_linked', now)
  } else {
    await purgePendingAuthenticatedContactDetails(record.id, 'meeting_linked', now)
  }

  // Paso 5 — no crítico: approvalExpiresAt ya quedó en Postgres (fuente de
  // verdad del barrido); un fallo de Redis aquí se reconstruye en la
  // siguiente pasada de conciliación (reconciliation.ts).
  try {
    const zone = findZone(record.zoneId)
    await acquireOrRenewBookingLock({
      requestId: record.id,
      phase: 'approval',
      treatmentId: record.treatmentId,
      professionalId: record.professionalId,
      zoneId: record.zoneId,
      startAt: record.startAt,
      endAt: record.endAt,
      zoneCapacity: zone?.capacidadSimultanea ?? 1,
      ttlSeconds: APPROVAL_HOLD_HOURS * 60 * 60,
    })
  } catch {
    // Silenciado a propósito — ver comentario del paso 5 arriba.
  }

  return { outcome: 'meeting_created', meetingId: meeting.id }
}

/** Descifra los cuatro campos de PendingGuestIdentity — null si ya fue purgada (estado inconsistente, ver paso 4 del flujo, tratado por reconciliation.ts). */
export async function decryptGuestIdentity(bookingRequestId: string): Promise<ContactDetails | null> {
  const identity = await findPendingGuestIdentity(bookingRequestId)
  if (!identity) {
    return null
  }

  return {
    firstName: decryptField({
      ciphertext: identity.firstNameCiphertext,
      nonce: identity.firstNameNonce,
      keyVersion: identity.firstNameKeyVersion,
    }),
    lastName: decryptField({
      ciphertext: identity.lastNameCiphertext,
      nonce: identity.lastNameNonce,
      keyVersion: identity.lastNameKeyVersion,
    }),
    email: decryptField({
      ciphertext: identity.emailCiphertext,
      nonce: identity.emailNonce,
      keyVersion: identity.emailKeyVersion,
    }),
    phone: decryptField({
      ciphertext: identity.phoneCiphertext,
      nonce: identity.phoneNonce,
      keyVersion: identity.phoneKeyVersion,
    }),
  }
}

/**
 * Revisión 2 de Fase 4B, punto 3: reconstruye `ContactDetails` de un
 * cliente AUTENTICADO a partir de `clientAccountId` (correo/`gapssaAccountId`
 * — siempre de la cuenta, nunca guardados aparte) +
 * `PendingAuthenticatedContactDetails` (nombre/apellidos/teléfono,
 * cifrados). Null si la cuenta ya no existe/activa, o si la identidad
 * pendiente ya no existe (purgada o nunca creada) — misma semántica que
 * `decryptGuestIdentity` para el invitado.
 */
export async function reconstructAuthenticatedContactDetails(clientAccountId: string, bookingRequestId: string): Promise<ContactDetails | null> {
  const account = await findAccountById(clientAccountId)
  if (!account) {
    return null
  }
  const identity = await findPendingAuthenticatedContactDetails(bookingRequestId)
  if (!identity) {
    return null
  }

  return {
    gapssaAccountId: account.id,
    firstName: decryptField({ ciphertext: identity.firstNameCiphertext, nonce: identity.firstNameNonce, keyVersion: identity.firstNameKeyVersion }),
    lastName: decryptField({ ciphertext: identity.lastNameCiphertext, nonce: identity.lastNameNonce, keyVersion: identity.lastNameKeyVersion }),
    email: account.email,
    phone: decryptField({ ciphertext: identity.phoneCiphertext, nonce: identity.phoneNonce, keyVersion: identity.phoneKeyVersion }),
  }
}
