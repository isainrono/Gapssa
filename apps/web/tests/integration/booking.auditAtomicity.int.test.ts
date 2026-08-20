import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, inject, it } from 'vitest'

import { authApi, getLatestOtpCodeForEmail as authGetLatestOtpCodeForEmail, visitPage as authVisitPage } from './authClient'
import { findAccountRowByEmail } from './authDb'
import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import {
  countBookingOutboxJobs,
  disableBookingAuditFailureFor,
  disableBookingAuditFailureForReasonCode,
  enableBookingAuditFailureFor,
  enableBookingAuditFailureForReasonCode,
  findBookingRequestByIdempotencyKey,
  findBookingRequestRow,
  findPendingGuestIdentityRow,
  findSimEspoMeetingByBookingRequestId,
  installBookingAuditFailureInjection,
  installBookingAuditReasonCodeFailureInjection,
  withBookingDb,
} from './bookingDb'

/**
 * Revisión 2 de Fase 4A, punto 4 — atomicidad real de negocio+auditoría en
 * `gapssa_booking`. Cada prueba arma un trigger de Postgres que hace
 * fallar EXACTAMENTE el `INSERT` en `booking_audit_log` bajo prueba
 * (`bookingDb.ts`, mismo mecanismo que `authDb.ts`/Fase 3) y comprueba la
 * base real después de la petición fallida — nunca solo la respuesta
 * HTTP — y que un reintento tras desarmar el fallo completa la operación
 * exactamente una vez.
 */

const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-1'
const PROFESSIONAL_ID = 'professional-owner'

function nextBusinessDayAt10Utc(n: number): string {
  const date = new Date()
  date.setUTCHours(10, 0, 0, 0)
  let remaining = n
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    if (date.getUTCDay() !== 0) {
      remaining -= 1
    }
  }
  return date.toISOString()
}

function freshGuest() {
  const unique = randomUUID()
  return { firstName: 'Berta', lastName: 'Atómica', phone: '+34 655 555 555', email: `atomic-${unique}@example.test` }
}

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es')
  return jar
}

beforeAll(async () => {
  await installBookingAuditFailureInjection()
  await installBookingAuditReasonCodeFailureInjection()
})

describe('guest creation — BookingRequestRecord + PendingGuestIdentity + ClientRequested + outbox job, all-or-nothing', () => {
  it('an injected audit failure rolls back the entire creation; a retry with the same key completes cleanly', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const idempotencyKey = randomUUID()
    const startAt = nextBusinessDayAt10Utc(30)
    const payload = { idempotencyKey, treatmentId: TREATMENT_ID, professionalId: PROFESSIONAL_ID, zoneId: ZONE_ID, startAt, guest }

    await enableBookingAuditFailureForReasonCode('ClientRequested')
    try {
      const failed = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
      expect(failed.status).not.toBe(202)

      expect(await findBookingRequestByIdempotencyKey(idempotencyKey)).toBeNull()
      expect(await getLatestOtpCodeForEmail(guest.email)).toBeNull()
    } finally {
      await disableBookingAuditFailureForReasonCode('ClientRequested')
    }

    // Nada se persistió — esto no es un "reintento idempotente" (no hay
    // ningún registro que encontrar), es una creación limpia normal.
    const retry = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
    expect(retry.status).toBe(202)
    const requestId = retry.body.requestId as string

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'pending_verification' })
    expect(await findPendingGuestIdentityRow(requestId)).not.toBeNull()
    expect(await countBookingOutboxJobs(requestId)).toBe(1)
    expect(await getLatestOtpCodeForEmail(guest.email)).toBeTruthy()
  })
})

describe('authenticated creation — BookingRequestRecord + ClientRequested, all-or-nothing', () => {
  async function registerAndLogIn(): Promise<{ jar: CookieJar; accountId: string }> {
    const email = `client-${randomUUID()}@example.test`
    const jar = new CookieJar()
    await authVisitPage(jar, '/es/mi-cuenta/registro')
    await authApi.post(jar, '/api/auth/register', { email, password: 'Correct-Horse-Battery-42!', dateOfBirth: '1990-01-01', locale: 'es' })
    const code = await authGetLatestOtpCodeForEmail(email)
    await authApi.post(jar, '/api/auth/verify-email', { email, code })
    await authApi.post(jar, '/api/auth/login', { email, password: 'Correct-Horse-Battery-42!' })
    const account = await findAccountRowByEmail(email)
    return { jar, accountId: (account as { id: string }).id }
  }

  it('an injected audit failure rolls back the creation; a retry with the same key completes and links a Meeting', async () => {
    const { jar } = await registerAndLogIn()
    const idempotencyKey = randomUUID()
    const startAt = nextBusinessDayAt10Utc(31)
    const payload = {
      idempotencyKey,
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      contact: { firstName: 'Ana', lastName: 'Cliente', phone: '+34 622 222 222' },
    }

    await enableBookingAuditFailureForReasonCode('ClientRequested')
    try {
      const failed = await bookingApi.post(jar, '/api/booking/v1/requests/authenticated', payload)
      expect(failed.status).not.toBe(201)
      expect(await findBookingRequestByIdempotencyKey(idempotencyKey)).toBeNull()
    } finally {
      await disableBookingAuditFailureForReasonCode('ClientRequested')
    }

    const retry = await bookingApi.post(jar, '/api/booking/v1/requests/authenticated', payload)
    expect(retry.status).toBe(201)
    expect(retry.body.meetingId).toBeTruthy()
  })
})

describe('verification_processing -> pending_approval + meetingId + approvalExpiresAt + auditoría, all-or-nothing', () => {
  it('an injected audit failure leaves the request in verification_processing without a linked meetingId; a retry (OTP already consumed) completes and adopts the already-created Meeting without duplicating it', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const startAt = nextBusinessDayAt10Utc(32)

    const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest,
    })
    expect(create.status).toBe(202)
    const requestId = create.body.requestId as string
    const accessToken = create.body.accessToken as string
    const code = await getLatestOtpCodeForEmail(guest.email)

    await enableBookingAuditFailureFor('BookingRequestRecord', requestId)
    try {
      const failedVerify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
      expect(failedVerify.status).not.toBe(200)

      const recordAfterFailure = await findBookingRequestRow(requestId)
      expect(recordAfterFailure).toMatchObject({ status: 'verification_processing', meeting_id: null })

      // El Meeting SÍ pudo llegar a crearse (paso 6, su propia escritura ya
      // comprometida) antes de que fallara el paso 7 — el diseño lo asume
      // recuperable por búsqueda idempotente, nunca lo duplica.
      const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
      if (meeting) {
        expect(meeting).toMatchObject({ c_estado_reserva: 'PendingCenterApproval' })
      }
    } finally {
      await disableBookingAuditFailureFor('BookingRequestRecord', requestId)
    }

    // Reintento: el OTP ya se consumió en Redis en el intento fallido
    // (verifyOtp corre ANTES del paso 7) — repetir con el mismo código
    // sigue el camino `already_consumed` + `codeMatchesConsumedChallenge`.
    const retry = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
    expect(retry.status).toBe(200)
    expect(retry.body.meetingId).toBeTruthy()

    const recordAfterRetry = await findBookingRequestRow(requestId)
    expect(recordAfterRetry).toMatchObject({ status: 'pending_approval' })
    expect((recordAfterRetry as { meeting_id: string }).meeting_id).toBe(retry.body.meetingId)

    // Nunca dos Meetings para la misma solicitud (bookingRequestId es
    // único en sim_espo_meetings — createMeeting adopta, nunca duplica).
    const meetingAfterRetry = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meetingAfterRetry?.id).toBe(retry.body.meetingId)
  })
})

describe('resolution transitions — resolveBookingRequest + auditoría, all-or-nothing', () => {
  it('an injected audit failure during an approval-expiry sweep leaves the request pending_approval, never resolved without its audit trail', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const startAt = nextBusinessDayAt10Utc(33)

    const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest,
    })
    const requestId = create.body.requestId as string
    const accessToken = create.body.accessToken as string
    const code = await getLatestOtpCodeForEmail(guest.email)
    const verify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
    expect(verify.status).toBe(200)

    await withBookingDb((client) =>
      client.query("update booking_request_records set approval_expires_at = now() - interval '1 minute' where id = $1", [requestId]),
    )

    await enableBookingAuditFailureFor('BookingRequestRecord', requestId)
    try {
      const internalSecret = process.env.BOOKING_INTERNAL_API_SECRET as string
      const baseUrl = inject('integrationBaseUrl')
      const sweep = await fetch(`${baseUrl}/api/booking/v1/internal/sweep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-api-secret': internalSecret },
        body: JSON.stringify({}),
      })
      expect(sweep.status).toBe(200)

      // El barrido en sí siempre responde 200 (recorre TODAS las
      // candidatas; un fallo en una no debe abortar la respuesta HTTP del
      // propio endpoint) — lo que importa es que ESTA solicitud concreta
      // nunca quedó resuelta sin su auditoría.
      const recordAfterFailure = await findBookingRequestRow(requestId)
      expect(recordAfterFailure).toMatchObject({ status: 'pending_approval', resolution: null })
    } finally {
      await disableBookingAuditFailureFor('BookingRequestRecord', requestId)
    }
  })
})

describe('PendingGuestIdentity purge (meeting_linked) + auditoría, all-or-nothing', () => {
  it('an injected audit failure during the purge leaves the identity active (never half-purged); the next verify call retries and completes the purge', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const startAt = nextBusinessDayAt10Utc(34)

    const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest,
    })
    const requestId = create.body.requestId as string
    const accessToken = create.body.accessToken as string
    const code = await getLatestOtpCodeForEmail(guest.email)

    // Solo se marca la escritura de PendingGuestIdentity — la de
    // BookingRequestRecord (paso 7, write-meeting) queda sin marcar, así
    // que esa SÍ se confirma con éxito en la misma petición.
    await enableBookingAuditFailureFor('PendingGuestIdentity', requestId)
    try {
      const failedVerify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
      expect(failedVerify.status).not.toBe(200)

      // El paso 7 SÍ se confirmó (su propia transacción, ajena a la de la
      // purga) — la solicitud ya está pending_approval con meetingId.
      const recordAfterFailure = await findBookingRequestRow(requestId)
      expect(recordAfterFailure).toMatchObject({ status: 'pending_approval' })
      expect((recordAfterFailure as { meeting_id: unknown }).meeting_id).toBeTruthy()

      // Pero la identidad sigue activa — nunca "marcada a medias".
      const identityAfterFailure = await findPendingGuestIdentityRow(requestId)
      expect(identityAfterFailure).toMatchObject({ status: 'active' })
    } finally {
      await disableBookingAuditFailureFor('PendingGuestIdentity', requestId)
    }

    // Reintento: verifyGuestBooking, al encontrar `meetingId` ya vinculado,
    // reintenta la purga (revisión 2, punto 7) en vez de devolver
    // "verified" dejándola pendiente para siempre.
    const retry = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
    expect(retry.status).toBe(200)

    const identityAfterRetry = await findPendingGuestIdentityRow(requestId)
    expect(identityAfterRetry).toBeNull()
  })
})
