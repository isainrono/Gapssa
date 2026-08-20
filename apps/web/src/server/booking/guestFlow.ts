import 'server-only'
import { randomUUID } from 'node:crypto'

import {
  computePayloadHash,
  GUEST_VERIFICATION_HOLD_MINUTES,
  MAX_PENDING_REQUESTS_PER_CLIENT,
  hmacSubjectId,
  normalizeEmail,
  type GuestContactInfo,
} from '@gapssa/contracts'

import { verifyOtp } from '../auth/otpService'
import { serverEnv } from '../env'
import { signBookingRequestAccessToken, signBookingRequestAccessTokenWithVersion } from './accessToken'
import { isSlotStillAvailable } from './availability'
import { acquireOrRenewBookingLock, releaseBookingLock } from './bookingLock'
import { encryptField } from '../crypto/fieldCrypto'
import type { EspoBookingAdapter } from './espoAdapter'
import { computeIdentityFingerprint, normalizeIdentityText, normalizePhone } from './identityFingerprint'
import { processGuestVerificationOtpJob } from './otpOutbox'
import {
  countActivePendingRequestsByEmailHmacCandidates,
  createGuestBookingRequest,
  findBookingRequestById,
  findBookingRequestByIdempotencyKey,
  purgePendingGuestIdentity,
  transitionToVerificationProcessing,
  type CanonicalPayloadFactory,
} from './repository'
import { validateSlotRequest } from './slotValidation'
import { completeBookingToMeeting, decryptGuestIdentity } from './verificationSteps'

/**
 * Orquestación de negocio del flujo de INVITADO — encargo de Fase 4A,
 * punto 4 (solicitud) y punto 5 (verificación). Las rutas API
 * (`app/api/booking/v1/**`) solo hacen HTTP: parseo/validación de entrada,
 * CSRF, rate limiting, mapeo de estos resultados a códigos de estado — cero
 * lógica de negocio ahí, mismo principio que Fase 3.
 */

export interface GuestBookingCreateInput {
  idempotencyKey: string
  treatmentId: string
  professionalId: string
  zoneId: string
  /** ISO 8601 UTC. */
  startAt: string
  guest: GuestContactInfo
}

export type GuestBookingCreateOutcome =
  | { outcome: 'accepted'; requestId: string; accessToken: string; verificationExpiresAt: string }
  | { outcome: 'idempotency_conflict' }
  | { outcome: 'treatment_not_found' }
  | { outcome: 'zone_not_found' }
  | { outcome: 'professional_not_found' }
  | { outcome: 'invalid_start_time' }
  | { outcome: 'lead_time_violation' }
  | { outcome: 'horizon_violation' }
  | { outcome: 'slot_unavailable' }
  | { outcome: 'too_many_pending_requests' }
  | { outcome: 'otp_rate_limited' }

const GUEST_IDENTITY_FINGERPRINT_DOMAIN = 'booking-guest-identity'

/**
 * El payload canónico de idempotencia NUNCA incluye la propia
 * idempotencyKey (packages/contracts/src/idempotency.ts) ni ningún dato
 * personal del invitado en claro — revisión 2 de Fase 4A, punto 2: la
 * versión anterior incluía `normalizeEmail(guest.email)` directamente, un
 * SHA-256 sin sal sobre un correo conocido/adivinable es reversible por
 * fuerza bruta/diccionario. Ahora entra solo una huella HMAC-SHA-256
 * versionada y con dominio propio (`identityFingerprint.ts`) sobre
 * nombre+apellidos+correo+teléfono normalizados — el hash sigue
 * detectando "son los mismos datos personales" sin poder invertirse sin el
 * secreto de servidor.
 */
export async function toCanonicalGuestBookingPayload(
  input: GuestBookingCreateInput,
  identityFingerprintKeyVersion: string,
): Promise<unknown> {
  const normalizedIdentity = {
    firstName: normalizeIdentityText(input.guest.firstName),
    lastName: normalizeIdentityText(input.guest.lastName),
    email: normalizeEmail(input.guest.email),
    phone: normalizePhone(input.guest.phone),
  }
  const fingerprint = await computeIdentityFingerprint(GUEST_IDENTITY_FINGERPRINT_DOMAIN, normalizedIdentity, identityFingerprintKeyVersion)

  return {
    treatmentId: input.treatmentId,
    professionalId: input.professionalId,
    zoneId: input.zoneId,
    startAt: input.startAt,
    identityFingerprint: { keyVersion: fingerprint.keyVersion, value: fingerprint.value },
  }
}

async function encryptGuestIdentity(guest: GuestContactInfo): Promise<{
  firstName: ReturnType<typeof encryptField>
  lastName: ReturnType<typeof encryptField>
  email: ReturnType<typeof encryptField>
  phone: ReturnType<typeof encryptField>
  emailLookupHmac: string
  emailLookupHmacKeyVersion: string
  /** HMAC del mismo correo bajo CADA versión presente en BOOKING_EMAIL_LOOKUP_HMAC_SECRETS — para buscar filas creadas con una versión anterior durante convivencia (nunca solo la activa). */
  emailLookupHmacCandidates: string[]
}> {
  const normalizedEmail = normalizeEmail(guest.email)
  const activeKeyVersion = serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION
  const emailLookupHmac = await hmacSubjectId('booking-guest-email', normalizedEmail, serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS[activeKeyVersion]!)
  const emailLookupHmacCandidates = await Promise.all(
    Object.values(serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS).map((secret) => hmacSubjectId('booking-guest-email', normalizedEmail, secret)),
  )

  return {
    firstName: encryptField(guest.firstName),
    lastName: encryptField(guest.lastName),
    email: encryptField(normalizedEmail),
    phone: encryptField(guest.phone),
    emailLookupHmac,
    emailLookupHmacKeyVersion: activeKeyVersion,
    emailLookupHmacCandidates,
  }
}

export async function createGuestBooking(
  adapter: EspoBookingAdapter,
  input: GuestBookingCreateInput,
  now: Date = new Date(),
): Promise<GuestBookingCreateOutcome> {
  // Comprobación de idempotencia TEMPRANA — antes de repetir ningún efecto
  // secundario (disponibilidad, lock de Redis, envío de OTP). Sin esto, un
  // reintento legítimo (misma idempotencyKey + mismo payload) volvería a
  // comprobar disponibilidad y encontraría SU PROPIA solicitud original
  // (ya en Postgres, `pending_verification`) ocupando el hueco — un falso
  // "slot_unavailable" contra sí mismo. `createGuestBookingRequest`
  // (repository.ts) también comprueba esto antes del INSERT, pero eso solo
  // protege la escritura, no evita repetir todo el trabajo previo.
  //
  // El hash se recalcula con la `identityFingerprintKeyVersion` del propio
  // registro existente (nunca con la versión activa actual) — así rotar
  // `BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION` no rompe la
  // detección de replay de una solicitud todavía viva.
  const existing = await findBookingRequestByIdempotencyKey(input.idempotencyKey)
  if (existing) {
    const recomputedHash = await computePayloadHash(await toCanonicalGuestBookingPayload(input, existing.identityFingerprintKeyVersion))
    if (existing.payloadHash !== recomputedHash) {
      return { outcome: 'idempotency_conflict' }
    }
    // Replay idempotente: reintenta el envío del OTP directamente en vez de
    // responder "accepted" en silencio como si el correo ya se hubiera
    // entregado — revisión 2 de Fase 4A, punto 3. Revisión 3, punto 3: SIN
    // una comprobación previa (`hasPendingGuestVerificationOtpJob`) que
    // tuviera una definición más estrecha que el propio reclamo — esa
    // comprobación nunca sabía de un job `processing` abandonado (lease
    // vencido), así que un reintento después de que el worker original
    // cayera a medias nunca lo recuperaba. El reclamo atómico
    // (`claimGuestVerificationOtpJob`, dentro de `processGuestVerificationOtpJob`)
    // decide por sí solo, de forma atómica, si hay trabajo elegible — si no
    // lo hay, la llamada es barata y no-op (`'no_eligible_job'`).
    // Best-effort: un fallo aquí tampoco cambia la respuesta, el job sigue
    // vivo para el siguiente reintento o para el barrido (reconciliation.ts).
    await processGuestVerificationOtpJob(existing.id, now).catch(() => 'failed_retryable' as const)
    return {
      outcome: 'accepted',
      requestId: existing.id,
      // Replay: firma con la versión que la fila YA tiene guardada
      // (nunca la activa actual, que pudo cambiar desde que se creó).
      accessToken: signBookingRequestAccessTokenWithVersion(existing.id, existing.accessTokenKeyVersion),
      verificationExpiresAt: existing.verificationExpiresAt.toISOString(),
    }
  }

  const validation = await validateSlotRequest(adapter, input, now)
  if (validation.outcome !== 'ok') {
    return validation
  }
  const { zone, startAt, endAt } = validation

  const identity = await encryptGuestIdentity(input.guest)

  // Búsqueda bajo TODAS las versiones presentes en el mapa (no solo la
  // activa) — durante convivencia tras una rotación, una identidad
  // pendiente creada con una versión anterior debe seguir contando contra
  // MAX_PENDING_REQUESTS_PER_CLIENT.
  const pendingCount = await countActivePendingRequestsByEmailHmacCandidates(identity.emailLookupHmacCandidates)
  if (pendingCount >= MAX_PENDING_REQUESTS_PER_CLIENT) {
    return { outcome: 'too_many_pending_requests' }
  }

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

  // Ancla real de la ventana de verificación — GUEST_VERIFICATION_HOLD_MINUTES
  // (fijado por PLAN_DESARROLLO_WEB_PORTAL.md §7), independiente del TTL
  // interno del propio reto OTP (OTP_TTL_MINUTES, configuración técnica
  // compartida por todos los propósitos de OTP — ver repository.ts,
  // comentario de cabecera, y verifyGuestBooking más abajo, que comprueba
  // este plazo explícitamente además de la validez del propio OTP).
  const verificationExpiresAt = new Date(now.getTime() + GUEST_VERIFICATION_HOLD_MINUTES * 60 * 1000)

  // Revisión 2 de Fase 4A, punto 7: TODO lo que sigue puede lanzar una
  // excepción inesperada (p. ej. un fallo de Postgres ajeno a las ramas de
  // control ya previstas) con el lock de Redis ya adquirido — sin este
  // `try/catch`, ese lock quedaba huérfano hasta que expirara su TTL
  // (GUEST_VERIFICATION_HOLD_MINUTES), bloqueando el hueco para cualquier
  // otro intento (incluido un reintento inmediato del mismo cliente) sin
  // que exista ningún BookingRequestRecord real que lo justifique. Libera
  // el lock y relanza — nunca convierte el error en un resultado silencioso.
  try {
    const identityFingerprintKeyVersion = serverEnv.BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION
    // Se firma con la versión ACTIVA antes de intentar el INSERT — esa
    // misma versión es la que se persiste en accessTokenKeyVersion (única
    // versión con la que ESTA fila, si de verdad se crea, aceptará
    // verificar su token más adelante).
    const { token: signedAccessToken, keyVersion: accessTokenKeyVersion } = signBookingRequestAccessToken(requestId)
    const createOutcome = await createGuestBookingRequest({
      id: requestId,
      idempotencyKey: input.idempotencyKey,
      identityFingerprintKeyVersion,
      accessTokenKeyVersion,
      computeCanonicalPayload: ((keyVersion: string) => toCanonicalGuestBookingPayload(input, keyVersion)) satisfies CanonicalPayloadFactory,
      treatmentId: input.treatmentId,
      professionalId: input.professionalId,
      zoneId: input.zoneId,
      startAt,
      endAt,
      verificationExpiresAt,
      identity,
    }, now)

    if (createOutcome.outcome !== 'created') {
      // Perdimos una carrera de idempotencia: otra petición con la MISMA
      // idempotencyKey ganó el INSERT — nuestro lock recién adquirido
      // (atado a un `requestId` que nunca llegó a persistirse) queda
      // huérfano, se libera explícitamente en vez de esperar al TTL. El
      // ganador de la carrera ya encoló su propio job de outbox dentro de
      // su transacción; si además perdió el envío, el camino de replay de
      // más arriba (misma idempotencyKey, próxima petición) lo reintentará.
      await releaseBookingLock({ requestId, professionalId: input.professionalId, zoneId: input.zoneId })

      if (createOutcome.outcome === 'idempotency_conflict') {
        return { outcome: 'idempotency_conflict' }
      }
      // Mismo razonamiento que la rama de replay de arriba (revisión 3,
      // punto 3): el reclamo atómico decide por sí solo si hay trabajo.
      await processGuestVerificationOtpJob(createOutcome.record.id, now).catch(() => 'failed_retryable' as const)
      return {
        outcome: 'accepted',
        requestId: createOutcome.record.id,
        // Perdimos la carrera: la fila real es la del ganador, firma con
        // SU versión guardada (pudo diferir de la que habíamos elegido).
        accessToken: signBookingRequestAccessTokenWithVersion(createOutcome.record.id, createOutcome.record.accessTokenKeyVersion),
        verificationExpiresAt: createOutcome.record.verificationExpiresAt.toISOString(),
      }
    }

    // Procesamiento del outbox EN MODO BEST-EFFORT, después del commit de
    // la transacción anterior (BookingRequestRecord + PendingGuestIdentity
    // + evento ClientRequested + el propio job, `repository.ts`) —
    // revisión 2 de Fase 4A, punto 3. Un fallo aquí (SMTP caído, Redis
    // caído) NUNCA hace fallar esta respuesta: el job queda
    // `failed_retryable` y se reintenta en el siguiente replay idempotente
    // (rama de arriba) o en un futuro runner programado (mismo pendiente
    // operativo que el outbox de Fase 3).
    const processOutcome = await processGuestVerificationOtpJob(requestId, now).catch(() => 'failed_retryable' as const)
    if (processOutcome === 'rate_limited') {
      return { outcome: 'otp_rate_limited' }
    }

    return {
      outcome: 'accepted',
      requestId,
      accessToken: signedAccessToken,
      verificationExpiresAt: verificationExpiresAt.toISOString(),
    }
  } catch (error) {
    await releaseBookingLock({ requestId, professionalId: input.professionalId, zoneId: input.zoneId }).catch(() => {})
    throw error
  }
}

// ---------------------------------------------------------------------------
// Verificación
// ---------------------------------------------------------------------------

export type GuestBookingVerifyOutcome =
  | { outcome: 'verified'; meetingId: string }
  | { outcome: 'contact_review_pending' }
  | { outcome: 'invalid_code'; attemptsRemaining: number }
  | { outcome: 'expired' }
  | { outcome: 'locked' }
  | { outcome: 'request_not_found' }

/**
 * Pasos 1-4 (docs/contratos-portal-v1.md §3.4) + delegación de los pasos
 * 5-10 en `completeBookingToMeeting` (verificationSteps.ts, compartida con
 * el flujo autenticado).
 */
export async function verifyGuestBooking(
  adapter: EspoBookingAdapter,
  requestId: string,
  code: string,
  now: Date = new Date(),
): Promise<GuestBookingVerifyOutcome> {
  const record = await findBookingRequestById(requestId)
  if (!record) {
    return { outcome: 'request_not_found' }
  }

  // Ya vinculada (reintento tras un paso 5-10 anterior que no llegó a
  // confirmarse al cliente) — resultado idempotente, sin volver a tocar el
  // OTP. Revisión 2 de Fase 4A, punto 7: reintenta aquí también la purga
  // de PendingGuestIdentity (paso 8) — si un intento anterior vinculó el
  // Meeting (paso 7, ya confirmado y durable) pero falló ANTES de purgar
  // la identidad, este atajo NUNCA debe devolver "verified" dejando la
  // purga pendiente para siempre: sin este reintento, ningún otro camino
  // (ni la propia verificación, que corta aquí, ni el barrido de
  // conciliación, que solo purga por expiración) volvería a intentarlo.
  // `purgePendingGuestIdentity` es idempotente (no-op si la fila ya no
  // está `active`) — mejor esfuerzo: un fallo aquí no debe convertir una
  // verificación ya lograda en un error para el cliente.
  if (record.meetingId) {
    await purgePendingGuestIdentity(record.id, 'meeting_linked', now).catch(() => {})
    return { outcome: 'verified', meetingId: record.meetingId }
  }

  if (record.status !== 'pending_verification' && record.status !== 'verification_processing') {
    return { outcome: 'expired' }
  }

  // Comprobación explícita del plazo de negocio fijo
  // (GUEST_VERIFICATION_HOLD_MINUTES), independiente de si el propio OTP
  // (OTP_TTL_MINUTES, configuración técnica compartida) sigue vivo en Redis
  // — ver guestFlow.ts, comentario junto a `verificationExpiresAt` en
  // createGuestBooking.
  if (record.status === 'pending_verification' && now.getTime() > record.verificationExpiresAt.getTime()) {
    return { outcome: 'expired' }
  }

  // Paso 1-2.
  const otpResult = await verifyOtp('guest_email_verification', requestId, code)

  let verifiedChallengeId: string | null = null
  if (otpResult.outcome === 'verified') {
    verifiedChallengeId = otpResult.challengeId
  } else if (otpResult.outcome === 'already_consumed' && otpResult.codeMatchesConsumedChallenge) {
    // Recuperación: el código correcto ya se consumió en un intento
    // anterior que pudo no completar el resto del flujo — repetir es
    // seguro (mismo razonamiento que password/reset, Fase 3).
    verifiedChallengeId = otpResult.challengeId
  } else if (otpResult.outcome === 'invalid_code') {
    return { outcome: 'invalid_code', attemptsRemaining: otpResult.attemptsRemaining }
  } else if (otpResult.outcome === 'locked') {
    return { outcome: 'locked' }
  } else {
    return { outcome: 'expired' }
  }

  if (verifiedChallengeId !== record.otpChallengeId) {
    // El reto verificado no es el atado a esta solicitud exacta — nunca
    // debería ocurrir en el camino normal (subjectRef = requestId, un solo
    // reto activo a la vez), pero se comprueba de forma explícita en vez de
    // asumirlo, mismo principio que password_reset_requests (Fase 3).
    return { outcome: 'expired' }
  }

  // Paso 3.
  const transition = await transitionToVerificationProcessing(requestId, verifiedChallengeId)
  if (transition.outcome === 'request_not_found') {
    return { outcome: 'request_not_found' }
  }
  if (transition.outcome === 'challenge_mismatch' || transition.outcome === 'not_pending') {
    // Estado ya avanzado por otro intento concurrente/anterior — recarga y
    // sigue el camino idempotente de más abajo si ya tiene Meeting.
  }

  // Paso 4.
  const contact = await decryptGuestIdentity(requestId)
  if (!contact) {
    // PendingGuestIdentity ya no existe y el registro tampoco tiene
    // meetingId todavía — estado inconsistente (solo puede venir de una
    // purga prematura), lo resuelve la conciliación (reconciliation.ts),
    // nunca se inventa un Contact con datos vacíos.
    const fresh = await findBookingRequestById(requestId)
    if (fresh?.meetingId) {
      return { outcome: 'verified', meetingId: fresh.meetingId }
    }
    return { outcome: 'expired' }
  }

  // Pasos 5-10.
  const result = await completeBookingToMeeting(
    adapter,
    { id: record.id, treatmentId: record.treatmentId, professionalId: record.professionalId, zoneId: record.zoneId, startAt: record.startAt, endAt: record.endAt },
    contact,
    {
      purgeGuestIdentityAfterLink: true,
      actor: { type: 'guest', guestId: record.id },
      channel: 'email',
    },
  )

  if (result.outcome === 'contact_review_pending') {
    return { outcome: 'contact_review_pending' }
  }
  return { outcome: 'verified', meetingId: result.meetingId }
}
