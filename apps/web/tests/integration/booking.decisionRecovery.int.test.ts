import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import { decideSimEspoMeetingForTesting, findBookingRequestRow, findSimEspoMeetingByBookingRequestId } from './bookingDb'

/**
 * Revisión 2 de Fase 4A, punto 5 — recuperación de aprobación/rechazo
 * parcial. `internal/decisions` ya no escribe primero el Meeting y luego
 * `BookingRequestRecord` como dos pasos independientes sin red de
 * seguridad: `applyOrAdoptBookingDecision` (`decisionRecovery.ts`) hace el
 * intento inicial atómico (adaptador simulado, misma base de datos) y, si
 * el CAS no gana, reconcilia contra el estado ACTUAL y duradero del
 * Meeting antes de decidir "aplicado", "ya aplicado compatible" o
 * "conflicto".
 */

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
  return { firstName: 'Delia', lastName: 'Decisión', phone: '+34 677 777 777', email: `decision-${unique}@example.test` }
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
  if (create.status !== 202) throw new Error(`create failed: ${create.status} ${JSON.stringify(create.body)} startAt=${startAt}`)
  const requestId = create.body.requestId as string
  const accessToken = create.body.accessToken as string

  const code = await getLatestOtpCodeForEmail(guest.email)
  const verify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
  expect(verify.status).toBe(200)

  return { requestId, accessToken, meetingId: verify.body.meetingId as string }
}

async function internalPost(path: string, body: Record<string, unknown>) {
  const baseUrl = inject('integrationBaseUrl')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-api-secret': INTERNAL_SECRET },
    body: JSON.stringify(body),
  })
  const responseBody = await response.json().catch(() => ({}))
  return { status: response.status, body: responseBody as Record<string, unknown> }
}

describe('recovery: Meeting decided but BookingRequestRecord never resolved (simulates a crash between the two steps)', () => {
  it('adopts the already-decided (approved) Meeting the first time it is asked again, then reports already_applied_compatible on a further retry', async () => {
    const { requestId, meetingId } = await createAndVerifyBooking(21)

    // Reproduce exactamente lo que deja un fallo real entre `decideMeeting`
    // y `resolveBookingRequest` — sin pasar por el endpoint.
    await decideSimEspoMeetingForTesting(meetingId, 'Confirmed', 'staff-recovery', 'Approved')
    const stuckRecord = await findBookingRequestRow(requestId)
    expect(stuckRecord).toMatchObject({ status: 'pending_approval', resolution: null })

    const firstAsk = await internalPost('/api/booking/v1/internal/decisions', {
      meetingId,
      decision: 'approved',
      decidedBy: 'staff-recovery',
      idempotencyKey: randomUUID(),
    })
    expect(firstAsk.status).toBe(200)
    expect(firstAsk.body).toMatchObject({ applied: 'now', resolution: 'confirmed', cEstadoReserva: 'Confirmed' })

    const recovered = await findBookingRequestRow(requestId)
    expect(recovered).toMatchObject({ status: 'resolved', resolution: 'confirmed', reason_code: 'Approved' })

    const secondAsk = await internalPost('/api/booking/v1/internal/decisions', {
      meetingId,
      decision: 'approved',
      decidedBy: 'staff-recovery',
      idempotencyKey: randomUUID(),
    })
    expect(secondAsk.status).toBe(200)
    expect(secondAsk.body).toMatchObject({ applied: 'already', resolution: 'confirmed' })
  })

  it('adopts an already-decided (rejected) Meeting, never double-auditing the resolution transition', async () => {
    const { requestId, meetingId } = await createAndVerifyBooking(22)

    await decideSimEspoMeetingForTesting(meetingId, 'Canceled', 'staff-recovery', 'RejectedByStaff')

    const ask = await internalPost('/api/booking/v1/internal/decisions', {
      meetingId,
      decision: 'rejected',
      decidedBy: 'staff-recovery',
      note: 'motivo de recuperación',
      idempotencyKey: randomUUID(),
    })
    expect(ask.status).toBe(200)
    expect(ask.body).toMatchObject({ applied: 'now', resolution: 'rejected' })

    const recovered = await findBookingRequestRow(requestId)
    expect(recovered).toMatchObject({ status: 'resolved', resolution: 'rejected', reason_code: 'RejectedByStaff' })
  })

  it('never adopts a Canceled Meeting that was actually a system approval-expiry as if it were a staff rejection — returns conflict instead', async () => {
    const { requestId, meetingId } = await createAndVerifyBooking(23)

    // "Fase 4B — flujo de decisión final": el motivo durable
    // (resolutionReason), no decidedBy, es lo que distingue caducidad de
    // rechazo manual — decidedBy se conserva aquí solo por fidelidad
    // histórica con el sentinel real (espoAdapter.ts::SYSTEM_EXPIRY_DECIDED_BY).
    await decideSimEspoMeetingForTesting(meetingId, 'Canceled', 'system:approval-sweep', 'ApprovalExpired')

    const ask = await internalPost('/api/booking/v1/internal/decisions', {
      meetingId,
      decision: 'rejected',
      decidedBy: 'staff-late',
      note: 'intento de rechazo tardío',
      idempotencyKey: randomUUID(),
    })
    expect(ask.status).toBe(409)
    expect(ask.body.error).toMatchObject({ code: 'decision_conflict' })

    // Nunca sobrescrita: la solicitud sigue sin resolver por esta vía (el
    // barrido de conciliación, no esta ruta, es quien debe adoptar
    // "approval_expired" — cubierto en booking.approvalSweep.int.test.ts).
    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'pending_approval', resolution: null })
  })

  it('an approved Meeting never gets silently reinterpreted as a rejection: incompatible decision returns conflict, never overwrites', async () => {
    const { requestId, meetingId } = await createAndVerifyBooking(24)

    await decideSimEspoMeetingForTesting(meetingId, 'Confirmed', 'staff-recovery', 'Approved')

    const ask = await internalPost('/api/booking/v1/internal/decisions', {
      meetingId,
      decision: 'rejected',
      decidedBy: 'staff-confused',
      note: 'confusión operativa',
      idempotencyKey: randomUUID(),
    })
    expect(ask.status).toBe(409)
    expect(ask.body.error).toMatchObject({ code: 'decision_conflict', existingCEstadoReserva: 'Confirmed' })

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'pending_approval' })
  })
})

describe('concurrency — two decisions racing for the same Meeting converge on a single coherent resolution', () => {
  it('two concurrent approve calls: exactly one resolution, one audit entry, no error', async () => {
    const { requestId, meetingId } = await createAndVerifyBooking(28)

    const [first, second] = await Promise.all([
      internalPost('/api/booking/v1/internal/decisions', { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() }),
      internalPost('/api/booking/v1/internal/decisions', { meetingId, decision: 'approved', decidedBy: 'staff-b', idempotencyKey: randomUUID() }),
    ])

    expect([first.status, second.status]).toEqual([200, 200])
    expect([first.body.applied, second.body.applied].sort()).toEqual(['already', 'now'])

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'resolved', resolution: 'confirmed' })

    const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meeting).toMatchObject({ c_estado_reserva: 'Confirmed' })
  })

  it('a concurrent approve vs. reject: exactly one wins (200 applied), the other gets an explicit conflict — never a mixed/corrupted state', async () => {
    const { requestId, meetingId } = await createAndVerifyBooking(29)

    const [approve, reject] = await Promise.all([
      internalPost('/api/booking/v1/internal/decisions', { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() }),
      internalPost('/api/booking/v1/internal/decisions', {
        meetingId,
        decision: 'rejected',
        decidedBy: 'staff-b',
        note: 'no compatible con la agenda',
        idempotencyKey: randomUUID(),
      }),
    ])

    const statuses = [approve.status, reject.status].sort()
    expect(statuses).toEqual([200, 409])

    const record = await findBookingRequestRow(requestId)
    expect((record as { status: string }).status).toBe('resolved')
    // La resolución coherente es SIEMPRE la que ganó (approved o
    // rejected), nunca ambas ni ninguna.
    expect(['confirmed', 'rejected']).toContain((record as { resolution: string }).resolution)

    const winnerIsApprove = approve.status === 200
    expect((record as { resolution: string }).resolution).toBe(winnerIsApprove ? 'confirmed' : 'rejected')
  })
})
