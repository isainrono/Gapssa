import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import { findPendingGuestIdentityStatus, findSimEspoMeetingByBookingRequestId } from './bookingDb'

/**
 * 10:00 UTC cae siempre dentro del horario de apertura en Europe/Madrid
 * (09:00-21:00 local), tanto en CET (UTC+1, UTC 08:00-20:00 local) como en
 * CEST (UTC+2, UTC 07:00-19:00 local) — evita depender de en qué mitad del
 * año se ejecuta la suite. `n` es el n-ésimo día "entre semana o sábado"
 * (domingo excluido) contando desde mañana — CONTAR días de apertura en
 * vez de "sumar n días naturales y saltar si cae en domingo" es lo que
 * garantiza que valores de `n` distintos nunca produzcan la misma fecha
 * (una simple suma + salto puede hacer que dos `n` consecutivos colapsen
 * en el mismo día cuando el salto por domingo se interpone entre ambos).
 */
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
  return {
    firstName: 'Juana',
    lastName: 'Ejemplo',
    phone: '+34 600 000 000',
    email: `guest-${unique}@example.test`,
  }
}

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es')
  return jar
}

const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-1'
const PROFESSIONAL_ID = 'professional-owner'

describe('POST /api/booking/v1/requests (guest)', () => {
  it('creates a pending_verification request, sends an OTP by email, and confirms an idempotent replay returns the same requestId', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const idempotencyKey = randomUUID()
    const startAt = nextBusinessDayAt10Utc(5)

    const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey,
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest,
    })

    expect(create.status).toBe(202)
    expect(create.body).toMatchObject({ status: 'pending_verification' })
    const requestId = create.body.requestId as string
    const accessToken = create.body.accessToken as string
    expect(requestId).toBeTruthy()
    expect(accessToken).toBeTruthy()

    const code = await getLatestOtpCodeForEmail(guest.email)
    expect(code).toBeTruthy()

    // Reintento con la MISMA clave de idempotencia y el mismo payload — se
    // trata como el mismo intento, nunca duplica la solicitud.
    const replay = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey,
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest,
    })
    expect(replay.status).toBe(202)
    expect(replay.body.requestId).toBe(requestId)
    expect(replay.body.accessToken).toBe(accessToken)
  })

  it('rejects a second request reusing the same idempotencyKey with a different payload', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const idempotencyKey = randomUUID()
    const startAt = nextBusinessDayAt10Utc(6)

    const first = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey,
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest,
    })
    expect(first.status).toBe(202)

    const conflicting = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey,
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt: nextBusinessDayAt10Utc(7),
      guest,
    })
    expect(conflicting.status).toBe(409)
    expect(conflicting.body.error).toMatchObject({ code: 'idempotency_conflict' })
  })

  it('rejects a start time earlier than the minimum lead time', async () => {
    const jar = await freshJarWithCsrf()
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString()

    const response = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt: soon,
      guest: freshGuest(),
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'lead_time_violation' })
  })

  it('rejects an unknown treatment/zone/professional', async () => {
    const jar = await freshJarWithCsrf()
    const startAt = nextBusinessDayAt10Utc(8)

    const badTreatment = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey: randomUUID(),
      treatmentId: 'treatment-does-not-exist',
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest: freshGuest(),
    })
    expect(badTreatment.status).toBe(404)
    expect(badTreatment.body.error).toMatchObject({ code: 'treatment_not_found' })
  })
})

describe('GET /api/booking/v1/requests/:id (guest, opaque status)', () => {
  it('requires a valid access token — a stranger cannot read the status', async () => {
    const jar = await freshJarWithCsrf()
    const startAt = nextBusinessDayAt10Utc(9)
    const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest: freshGuest(),
    })
    const requestId = create.body.requestId as string

    const withoutToken = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`)
    expect(withoutToken.status).toBe(404)

    const withWrongToken = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`, {
      accessToken: 'a'.repeat(64),
    })
    expect(withWrongToken.status).toBe(404)

    const withRightToken = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`, {
      accessToken: create.body.accessToken as string,
    })
    expect(withRightToken.status).toBe(200)
    expect(withRightToken.body).toMatchObject({ requestId, status: 'pending_verification' })
  })
})

describe('POST /api/booking/v1/requests/:id/verify (guest)', () => {
  it('completes the full create -> verify flow: links a Meeting, purges the identity, moves to pending_approval', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const startAt = nextBusinessDayAt10Utc(10)

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
    expect(code).toBeTruthy()

    const verify = await bookingApi.post(
      jar,
      `/api/booking/v1/requests/${requestId}/verify`,
      { code },
      { accessToken },
    )
    expect(verify.status).toBe(200)
    expect(verify.body).toMatchObject({ status: 'pending_approval' })
    expect(verify.body.meetingId).toBeTruthy()

    const status = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`, { accessToken })
    expect(status.body).toMatchObject({ status: 'pending_approval' })
    expect(status.body.approvalExpiresAt).toBeTruthy()

    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()

    const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meeting).toMatchObject({ c_estado_reserva: 'PendingCenterApproval', status: 'Planned' })

    // Repetir la verificación con el mismo código correcto es idempotente
    // (recuperación, no error) — nunca duplica el Meeting.
    const secondVerify = await bookingApi.post(
      jar,
      `/api/booking/v1/requests/${requestId}/verify`,
      { code },
      { accessToken },
    )
    expect(secondVerify.status).toBe(200)
    expect(secondVerify.body.meetingId).toBe(verify.body.meetingId)
  })

  it('rejects an incorrect code without resolving the request', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const startAt = nextBusinessDayAt10Utc(11)

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

    const wrong = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code: '000000' }, { accessToken })
    expect(wrong.status).toBe(400)
    expect(wrong.body.error).toMatchObject({ code: 'invalid_code' })

    const status = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`, { accessToken })
    expect(status.body).toMatchObject({ status: 'pending_verification' })
  })
})
