import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'
import { findAccountRowByEmail, setAccountStatusForTesting } from './authDb'
import { bookingApi } from './bookingClient'
import { findSimEspoMeetingByBookingRequestId } from './bookingDb'

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!'
const DOB = '1990-01-01'
const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-2'
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

function freshEmail(): string {
  return `client-${randomUUID()}@example.test`
}

/** Registra, verifica el correo e inicia sesión — devuelve un jar autenticado listo para reservar. */
async function registerAndLogIn(): Promise<{ jar: CookieJar; email: string; accountId: string }> {
  const email = freshEmail()
  const jar = new CookieJar()
  await visitPage(jar, '/es/mi-cuenta/registro')
  await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
  const code = await getLatestOtpCodeForEmail(email)
  await authApi.post(jar, '/api/auth/verify-email', { email, code })
  await authApi.post(jar, '/api/auth/login', { email, password: STRONG_PASSWORD })

  const account = await findAccountRowByEmail(email)
  const accountId = (account as { id: string }).id
  return { jar, email, accountId }
}

describe('POST /api/booking/v1/requests/authenticated', () => {
  it('rejects an unauthenticated request', async () => {
    const jar = new CookieJar()
    await visitPage(jar, '/es')
    const response = await bookingApi.post(jar, '/api/booking/v1/requests/authenticated', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt: nextBusinessDayAt10Utc(25),
      contact: { firstName: 'Ana', lastName: 'Cliente', phone: '+34 622 222 222' },
    })
    expect(response.status).toBe(401)
  })

  it('creates and synchronously completes a booking for an active account: no OTP, meeting linked immediately, reuses the shared verification steps', async () => {
    const { jar } = await registerAndLogIn()
    const idempotencyKey = randomUUID()
    const startAt = nextBusinessDayAt10Utc(26)

    const create = await bookingApi.post(jar, '/api/booking/v1/requests/authenticated', {
      idempotencyKey,
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      contact: { firstName: 'Ana', lastName: 'Cliente', phone: '+34 622 222 222' },
    })

    expect(create.status).toBe(201)
    expect(create.body).toMatchObject({ status: 'pending_approval' })
    const requestId = create.body.requestId as string
    const meetingId = create.body.meetingId as string
    expect(requestId).toBeTruthy()
    expect(meetingId).toBeTruthy()

    const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meeting).toMatchObject({ c_estado_reserva: 'PendingCenterApproval', status: 'Planned' })

    const status = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`)
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({ status: 'pending_approval' })

    // Repetir con la MISMA idempotencyKey es un no-op idempotente — nunca
    // un segundo Meeting.
    const replay = await bookingApi.post(jar, '/api/booking/v1/requests/authenticated', {
      idempotencyKey,
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      contact: { firstName: 'Ana', lastName: 'Cliente', phone: '+34 622 222 222' },
    })
    expect(replay.status).toBe(201)
    expect(replay.body.requestId).toBe(requestId)
    expect(replay.body.meetingId).toBe(meetingId)
  })

  it('rejects a request from a session whose account is no longer active (suspended between requests)', async () => {
    const { jar, accountId } = await registerAndLogIn()
    await setAccountStatusForTesting(accountId, 'suspended')

    const response = await bookingApi.post(jar, '/api/booking/v1/requests/authenticated', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt: nextBusinessDayAt10Utc(27),
      contact: { firstName: 'Ana', lastName: 'Cliente', phone: '+34 622 222 222' },
    })
    // `getActiveSessionFromCookies` (Fase 3, session.ts) ya comprueba
    // `status === 'active'` antes que cualquier otra cosa y revoca la
    // sesión de una cuenta suspendida — la petición nunca llega a
    // `createAuthenticatedBooking`, que tiene su propia comprobación
    // `account_not_active` como red de seguridad redundante para
    // cualquier llamante futuro que no pase por la capa de sesión HTTP.
    expect(response.status).toBe(401)
    expect(response.body.error).toMatchObject({ code: 'unauthenticated' })
  })
})
