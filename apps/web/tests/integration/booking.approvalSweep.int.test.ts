import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import { findBookingRequestRow, findPendingGuestIdentityStatus, findSimEspoMeetingByBookingRequestId, withBookingDb } from './bookingDb'

const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-1'
const PROFESSIONAL_ID = 'professional-owner'
const INTERNAL_SECRET = process.env.BOOKING_INTERNAL_API_SECRET as string

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
  return { firstName: 'Marta', lastName: 'Prueba', phone: '+34 611 111 111', email: `guest-${unique}@example.test` }
}

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es')
  return jar
}

async function createAndVerifyBooking(dayOffset: number): Promise<{ requestId: string; accessToken: string; meetingId: string }> {
  const jar = await freshJarWithCsrf()
  const guest = freshGuest()
  const startAt = nextBusinessDayAt10Utc(dayOffset)

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
  const verify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
  expect(verify.status).toBe(200)

  return { requestId, accessToken, meetingId: verify.body.meetingId as string }
}

async function internalPost(path: string, body: Record<string, unknown>, secret = INTERNAL_SECRET) {
  const baseUrl = inject('integrationBaseUrl')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-api-secret': secret },
    body: JSON.stringify(body),
  })
  const responseBody = await response.json().catch(() => ({}))
  return { status: response.status, body: responseBody as Record<string, unknown> }
}

describe('POST /api/booking/v1/internal/decisions', () => {
  it('rejects a missing/invalid internal secret', async () => {
    const { meetingId } = await createAndVerifyBooking(15)
    const response = await internalPost('/api/booking/v1/internal/decisions', { meetingId, decision: 'approved', decidedBy: 'staff-1' }, 'wrong-secret')
    expect(response.status).toBe(401)
  })

  it('approves a Meeting: cEstadoReserva -> Confirmed, BookingRequestRecord resolution -> confirmed', async () => {
    const { requestId, accessToken, meetingId } = await createAndVerifyBooking(16)

    const decision = await internalPost('/api/booking/v1/internal/decisions', { meetingId, decision: 'approved', decidedBy: 'staff-1' })
    expect(decision.status).toBe(200)
    expect(decision.body).toMatchObject({ resolution: 'confirmed', cEstadoReserva: 'Confirmed' })

    const jar = await freshJarWithCsrf()
    const status = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`, { accessToken })
    expect(status.body).toMatchObject({ status: 'resolved', resolution: 'confirmed', reasonCode: 'Approved' })

    const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meeting).toMatchObject({ c_estado_reserva: 'Confirmed', status: 'Planned' })
  })

  it('rejects a Meeting: cEstadoReserva -> Canceled, BookingRequestRecord resolution -> rejected, note stored only in the simulated EspoCRM side (never in booking_audit_log)', async () => {
    const { requestId, accessToken, meetingId } = await createAndVerifyBooking(17)

    const decision = await internalPost('/api/booking/v1/internal/decisions', {
      meetingId,
      decision: 'rejected',
      decidedBy: 'staff-1',
      note: 'Cliente con antecedente de no presentarse.',
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toMatchObject({ resolution: 'rejected', cEstadoReserva: 'Canceled' })

    const jar = await freshJarWithCsrf()
    const status = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`, { accessToken })
    expect(status.body).toMatchObject({ status: 'resolved', resolution: 'rejected', reasonCode: 'RejectedByStaff' })

    const auditRows = await withBookingDb((client) =>
      client.query('select * from booking_audit_log where entity_id = $1', [requestId]).then((r) => r.rows),
    )
    for (const row of auditRows as Record<string, unknown>[]) {
      expect(JSON.stringify(row)).not.toContain('antecedente')
    }
  })

  it('a second decision on an already-decided Meeting is rejected (not_pending)', async () => {
    const { meetingId } = await createAndVerifyBooking(18)
    const first = await internalPost('/api/booking/v1/internal/decisions', { meetingId, decision: 'approved', decidedBy: 'staff-1' })
    expect(first.status).toBe(200)

    const second = await internalPost('/api/booking/v1/internal/decisions', {
      meetingId,
      decision: 'rejected',
      decidedBy: 'staff-1',
      note: 'intento de rechazo tras aprobación',
    })
    expect(second.status).toBe(409)
  })
})

describe('POST /api/booking/v1/internal/sweep', () => {
  it('resolves an expired pending_approval request as approval_expired and cancels the Meeting', async () => {
    const { requestId, accessToken } = await createAndVerifyBooking(19)

    await withBookingDb((client) =>
      client.query("update booking_request_records set approval_expires_at = now() - interval '1 minute' where id = $1", [requestId]),
    )

    const sweep = await internalPost('/api/booking/v1/internal/sweep', {})
    expect(sweep.status).toBe(200)
    expect((sweep.body as { expiredApprovals: number }).expiredApprovals).toBeGreaterThanOrEqual(1)

    const jar = await freshJarWithCsrf()
    const status = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`, { accessToken })
    expect(status.body).toMatchObject({ status: 'resolved', resolution: 'approval_expired', reasonCode: 'ApprovalExpired' })

    const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meeting).toMatchObject({ c_estado_reserva: 'Canceled' })
  })

  it('resolves an expired pending_verification request as verification_expired and purges the guest identity', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const startAt = nextBusinessDayAt10Utc(20)

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

    expect(await findPendingGuestIdentityStatus(requestId)).toBe('active')

    await withBookingDb((client) =>
      client.query("update booking_request_records set verification_expires_at = now() - interval '1 minute' where id = $1", [requestId]),
    )

    const sweep = await internalPost('/api/booking/v1/internal/sweep', {})
    expect(sweep.status).toBe(200)
    expect((sweep.body as { expiredVerifications: number }).expiredVerifications).toBeGreaterThanOrEqual(1)
    expect((sweep.body as { purgedGuestIdentities: Record<string, number> }).purgedGuestIdentities.verification_expired).toBeGreaterThanOrEqual(1)

    const status = await bookingApi.get(jar, `/api/booking/v1/requests/${requestId}`, { accessToken })
    expect(status.body).toMatchObject({ status: 'resolved', resolution: 'verification_expired', reasonCode: 'VerificationExpired' })

    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()

    const row = await findBookingRequestRow(requestId)
    expect(row).toMatchObject({ status: 'resolved' })
  })
})
