import 'server-only'
import { randomUUID } from 'node:crypto'

import { computePayloadHash, CONTACT_REVIEW_HOLD_HOURS, GUEST_VERIFICATION_HOLD_MINUTES } from '@gapssa/contracts'

import { findAccountById, type ClientAccountRow } from '../auth/repository'
import { encryptField } from '../crypto/fieldCrypto'
import { serverEnv } from '../env'
import { isSlotStillAvailable } from './availability'
import { acquireOrRenewBookingLock, releaseBookingLock } from './bookingLock'
import type { EspoBookingAdapter } from './espoAdapter'
import { computeIdentityFingerprint, normalizeIdentityText, normalizePhone } from './identityFingerprint'
import {
  createAuthenticatedBookingRequest,
  findBookingRequestByIdempotencyKey,
  type BookingRequestRow,
  type CanonicalPayloadFactory,
} from './repository'
import { validateSlotRequest } from './slotValidation'
import { completeBookingToMeeting } from './verificationSteps'

/**
 * Orquestación de negocio del flujo de CLIENTE AUTENTICADO — encargo de
 * Fase 4A, punto 7. Reutiliza `validateSlotRequest`/`isSlotStillAvailable`/
 * `acquireOrRenewBookingLock`/`completeBookingToMeeting`
 * (`verificationSteps.ts`, pasos 5-10 del flujo recuperable) — la ÚNICA
 * diferencia real con el invitado es que no hay OTP ni `PendingGuestIdentity`:
 * la sesión ya prueba identidad, así que la solicitud se crea directamente
 * en `verification_processing` y este mismo servicio completa el resto de
 * pasos en la misma llamada (recuperable igualmente: si el proceso cae a
 * mitad, un reintento con la MISMA `idempotencyKey` retoma desde
 * `completeBookingToMeeting`, que es idempotente por diseño).
 *
 * `ClientAccount` (gapssa_auth) no guarda nombre ni teléfono
 * (`docs/fase3-autenticacion.md` §1: "nunca duplica la ficha operativa
 * completa") — se piden en la propia solicitud, igual que al invitado,
 * salvo el correo (siempre el de la cuenta, nunca reintroducido: evita que
 * la reserva quede vinculada a un correo distinto del que inició sesión).
 */

export interface AuthenticatedBookingCreateInput {
  idempotencyKey: string
  treatmentId: string
  professionalId: string
  zoneId: string
  /** ISO 8601 UTC. */
  startAt: string
  contact: { firstName: string; lastName: string; phone: string }
}

export type AuthenticatedBookingCreateOutcome =
  | { outcome: 'accepted'; requestId: string; meetingId: string }
  | { outcome: 'contact_review_pending'; requestId: string }
  | { outcome: 'idempotency_conflict' }
  | { outcome: 'account_not_active' }
  | { outcome: 'treatment_not_found' }
  | { outcome: 'zone_not_found' }
  | { outcome: 'professional_not_found' }
  | { outcome: 'invalid_start_time' }
  | { outcome: 'lead_time_violation' }
  | { outcome: 'horizon_violation' }
  | { outcome: 'slot_unavailable' }

const AUTHENTICATED_CONTACT_FINGERPRINT_DOMAIN = 'booking-authenticated-contact'

/**
 * Igual que el invitado (guestFlow.ts): el hash de idempotencia nunca
 * incluye datos personales en claro. `clientAccountId` ya identifica la
 * cuenta de forma opaca, pero revisión 2 de Fase 4A, punto 2 añade además
 * una huella HMAC de `firstName`/`lastName`/`phone` — la única PII que este
 * flujo recibe directamente en el body (el correo siempre es el de la
 * cuenta, nunca reintroducido): sin ella, reutilizar la misma
 * `idempotencyKey` con datos de contacto distintos para la misma cuenta se
 * trataría como el mismo replay en vez de un conflicto.
 */
export async function toCanonicalAuthenticatedBookingPayload(
  accountId: string,
  input: AuthenticatedBookingCreateInput,
  identityFingerprintKeyVersion: string,
): Promise<unknown> {
  const normalizedContact = {
    firstName: normalizeIdentityText(input.contact.firstName),
    lastName: normalizeIdentityText(input.contact.lastName),
    phone: normalizePhone(input.contact.phone),
  }
  const fingerprint = await computeIdentityFingerprint(
    AUTHENTICATED_CONTACT_FINGERPRINT_DOMAIN,
    normalizedContact,
    identityFingerprintKeyVersion,
  )

  return {
    clientAccountId: accountId,
    treatmentId: input.treatmentId,
    professionalId: input.professionalId,
    zoneId: input.zoneId,
    startAt: input.startAt,
    contactFingerprint: { keyVersion: fingerprint.keyVersion, value: fingerprint.value },
  }
}

async function finishAuthenticatedBooking(
  adapter: EspoBookingAdapter,
  record: Pick<BookingRequestRow, 'id' | 'treatmentId' | 'professionalId' | 'zoneId' | 'startAt' | 'endAt'>,
  account: ClientAccountRow,
  contact: { firstName: string; lastName: string; phone: string },
): Promise<AuthenticatedBookingCreateOutcome> {
  const result = await completeBookingToMeeting(
    adapter,
    record,
    { gapssaAccountId: account.id, firstName: contact.firstName, lastName: contact.lastName, email: account.email, phone: contact.phone },
    { purgeGuestIdentityAfterLink: false, actor: { type: 'user', id: account.id }, channel: 'web' },
  )
  if (result.outcome === 'contact_review_pending') {
    return { outcome: 'contact_review_pending', requestId: record.id }
  }
  return { outcome: 'accepted', requestId: record.id, meetingId: result.meetingId }
}

export async function createAuthenticatedBooking(
  adapter: EspoBookingAdapter,
  accountId: string,
  input: AuthenticatedBookingCreateInput,
  now: Date = new Date(),
): Promise<AuthenticatedBookingCreateOutcome> {
  const account = await findAccountById(accountId)
  // "Rechazar cuentas pending_verification, suspended, pending_deletion o
  // deleted" (encargo de Fase 4A, punto 7) — solo "active" puede reservar.
  if (!account || account.status !== 'active') {
    return { outcome: 'account_not_active' }
  }

  // Recalcula con la `identityFingerprintKeyVersion` del propio registro
  // existente (nunca la activa actual) — mismo motivo que guestFlow.ts:
  // rotar el secreto activo no debe romper la detección de replay de una
  // solicitud todavía viva.
  const existing = await findBookingRequestByIdempotencyKey(input.idempotencyKey)
  if (existing) {
    const recomputedHash = await computePayloadHash(await toCanonicalAuthenticatedBookingPayload(accountId, input, existing.identityFingerprintKeyVersion))
    if (existing.payloadHash !== recomputedHash) {
      return { outcome: 'idempotency_conflict' }
    }
    return finishAuthenticatedBooking(adapter, existing, account, input.contact)
  }

  const validation = await validateSlotRequest(adapter, input, now)
  if (validation.outcome !== 'ok') {
    return validation
  }
  const { zone, startAt, endAt } = validation

  const stillAvailable = await isSlotStillAvailable(adapter, {
    professionalId: input.professionalId,
    zoneId: input.zoneId,
    startAt,
    endAt,
    zoneCapacity: zone.capacidadSimultanea,
  })
  if (!stillAvailable) {
    return { outcome: 'slot_unavailable' }
  }

  const requestId = randomUUID()
  const lockOutcome = await acquireOrRenewBookingLock({
    requestId,
    phase: 'verification',
    treatmentId: input.treatmentId,
    professionalId: input.professionalId,
    zoneId: input.zoneId,
    startAt,
    endAt,
    zoneCapacity: zone.capacidadSimultanea,
    ttlSeconds: GUEST_VERIFICATION_HOLD_MINUTES * 60,
  })
  if (lockOutcome !== 'acquired') {
    return { outcome: 'slot_unavailable' }
  }

  // Revisión 2 de Fase 4A, punto 7: mismo motivo que guestFlow.ts — una
  // excepción inesperada aquí con el lock ya adquirido no debe dejarlo
  // huérfano hasta que expire su TTL.
  try {
    const identityFingerprintKeyVersion = serverEnv.BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION
    // Revisión 2 de Fase 4B, punto 3: persiste nombre/apellidos/teléfono
    // cifrados junto al propio BookingRequestRecord — sin esto, un
    // `contact_review_pending` (o cualquier caída a mitad de camino) perdía
    // estos datos en cuanto terminaba esta petición HTTP, dejando la
    // solicitud sin forma de reanudarse. Mismo TTL sugerido que una
    // revisión abierta (CONTACT_REVIEW_HOLD_HOURS) — se purga mucho antes
    // en el camino feliz (`meeting_linked`, dentro de `completeBookingToMeeting`).
    const contactDetailsExpiresAt = new Date(now.getTime() + CONTACT_REVIEW_HOLD_HOURS * 60 * 60 * 1000)
    const createOutcome = await createAuthenticatedBookingRequest({
      id: requestId,
      idempotencyKey: input.idempotencyKey,
      identityFingerprintKeyVersion,
      computeCanonicalPayload: ((keyVersion: string) =>
        toCanonicalAuthenticatedBookingPayload(accountId, input, keyVersion)) satisfies CanonicalPayloadFactory,
      clientAccountId: accountId,
      treatmentId: input.treatmentId,
      professionalId: input.professionalId,
      zoneId: input.zoneId,
      startAt,
      endAt,
      contactDetails: {
        firstName: encryptField(input.contact.firstName),
        lastName: encryptField(input.contact.lastName),
        phone: encryptField(input.contact.phone),
      },
      contactDetailsExpiresAt,
    }, now)

    if (createOutcome.outcome !== 'created') {
      await releaseBookingLock({ requestId, professionalId: input.professionalId, zoneId: input.zoneId })
      if (createOutcome.outcome === 'idempotency_conflict') {
        return { outcome: 'idempotency_conflict' }
      }
      return finishAuthenticatedBooking(adapter, createOutcome.record, account, input.contact)
    }

    // El evento ClientRequested ya se registró dentro de
    // `createAuthenticatedBookingRequest`, en la MISMA transacción que el
    // INSERT (repository.ts) — nunca aquí, fuera de ella.
    return await finishAuthenticatedBooking(adapter, createOutcome.record, account, input.contact)
  } catch (error) {
    await releaseBookingLock({ requestId, professionalId: input.professionalId, zoneId: input.zoneId }).catch(() => {})
    throw error
  }
}
