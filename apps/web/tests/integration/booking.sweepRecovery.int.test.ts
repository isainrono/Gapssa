import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import { decideSimEspoMeetingForTesting, findBookingRequestRow, withBookingDb } from './bookingDb'

/**
 * Revisión 2 de Fase 4A, punto 6 — recuperación de caducidad parcial. El
 * barrido (`reconciliation.ts::sweepExpiredApprovals`) ya no trata "el CAS
 * de `expireMeeting` no ganó" como sinónimo de "ya se resolvió, nada que
 * hacer": consulta el estado actual y duradero del Meeting y adopta la
 * resolución que de verdad le corresponde (approval_expired si lo canceló
 * una pasada anterior de este mismo barrido, confirmed/rejected si lo
 * decidió el centro manualmente), o lo cuenta en `inconsistentMeetings`
 * si el estado no puede interpretarse con seguridad.
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

// Franja horaria EXCLUSIVA de este archivo para uno de los tests de este
// fichero — todo `treatment-masaje-relajante-60`/`professional-owner`/
// `zone-cabina-1` a las 10:00 UTC ya está repartido, sin ningún hueco de
// día hábil libre por debajo del horizonte máximo
// (`MAX_LEAD_TIME_DAYS = 60`, packages/contracts/src/booking.ts) entre
// TODOS los ficheros que comparten ese trío (offsets 1-51 todos ya en
// uso). 11:00 UTC no se usa en ningún fichero de la suite (verificado por
// grep) — evita la colisión sin tocar ningún offset ajeno.
function nextBusinessDayAt11Utc(n: number): string {
  const date = new Date()
  date.setUTCHours(11, 0, 0, 0)
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
  return { firstName: 'Elvira', lastName: 'Barrido', phone: '+34 688 888 888', email: `sweep-${unique}@example.test` }
}

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es')
  return jar
}

async function createVerifiedAndExpiredBooking(
  dayOffset: number,
  // Por defecto 10:00 UTC (igual que siempre) — el único uso de 11:00 UTC
  // es el test de "Canceled sin resolutionReason" de más abajo, que
  // necesita un hueco propio (ver nextBusinessDayAt11Utc arriba).
  slotBuilder: (n: number) => string = nextBusinessDayAt10Utc,
): Promise<{ requestId: string; meetingId: string }> {
  const jar = await freshJarWithCsrf()
  const guest = freshGuest()
  const startAt = slotBuilder(dayOffset)

  const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
    idempotencyKey: randomUUID(),
    treatmentId: TREATMENT_ID,
    professionalId: PROFESSIONAL_ID,
    zoneId: ZONE_ID,
    startAt,
    guest,
  })
  if (create.status !== 202) throw new Error(`create failed: ${create.status} ${JSON.stringify(create.body)}`)
  const requestId = create.body.requestId as string
  const accessToken = create.body.accessToken as string
  const code = await getLatestOtpCodeForEmail(guest.email)
  const verify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
  if (verify.status !== 200) throw new Error(`verify failed: ${verify.status} ${JSON.stringify(verify.body)}`)
  const meetingId = verify.body.meetingId as string

  await withBookingDb((client) =>
    client.query("update booking_request_records set approval_expires_at = now() - interval '1 minute' where id = $1", [requestId]),
  )

  return { requestId, meetingId }
}

async function runSweep(): Promise<{ status: number; body: Record<string, unknown> }> {
  const baseUrl = inject('integrationBaseUrl')
  const response = await fetch(`${baseUrl}/api/booking/v1/internal/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-api-secret': INTERNAL_SECRET },
    body: JSON.stringify({}),
  })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, body: body as Record<string, unknown> }
}

describe('sweep recovery — a Meeting already canceled by a PRIOR sweep pass that crashed before resolving', () => {
  it('the next sweep pass adopts approval_expired instead of leaving the request stuck forever', async () => {
    const { requestId, meetingId } = await createVerifiedAndExpiredBooking(46)

    // Simula exactamente lo que deja una pasada anterior que canceló el
    // Meeting pero cayó antes de resolver BookingRequestRecord.
    await decideSimEspoMeetingForTesting(meetingId, 'Canceled', 'system:approval-sweep', 'ApprovalExpired')

    const sweep = await runSweep()
    expect(sweep.status).toBe(200)
    expect((sweep.body as { expiredApprovals: number }).expiredApprovals).toBeGreaterThanOrEqual(1)

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'resolved', resolution: 'approval_expired', reason_code: 'ApprovalExpired' })
  })

  it('is idempotent: a second sweep pass over the same already-repaired request neither double-resolves nor double-counts it', async () => {
    const { requestId, meetingId } = await createVerifiedAndExpiredBooking(47)
    await decideSimEspoMeetingForTesting(meetingId, 'Canceled', 'system:approval-sweep', 'ApprovalExpired')

    await runSweep()
    const recordAfterFirst = await findBookingRequestRow(requestId)
    expect(recordAfterFirst).toMatchObject({ status: 'resolved', resolution: 'approval_expired' })

    const second = await runSweep()
    expect(second.status).toBe(200)

    const recordAfterSecond = await findBookingRequestRow(requestId)
    expect(recordAfterSecond).toEqual(recordAfterFirst)
  })
})

describe('sweep recovery — a Meeting decided manually (approved/rejected) while its request sat past approvalExpiresAt', () => {
  it('adopts confirmed/Approved — never expires a Meeting the center already approved', async () => {
    const { requestId, meetingId } = await createVerifiedAndExpiredBooking(48)

    await decideSimEspoMeetingForTesting(meetingId, 'Confirmed', 'staff-1', 'Approved')

    const sweep = await runSweep()
    expect(sweep.status).toBe(200)

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'resolved', resolution: 'confirmed', reason_code: 'Approved' })
  })

  it('adopts rejected/RejectedByStaff — never mislabels a manual rejection as approval_expired', async () => {
    const { requestId, meetingId } = await createVerifiedAndExpiredBooking(49)

    await decideSimEspoMeetingForTesting(meetingId, 'Canceled', 'staff-1', 'RejectedByStaff')

    const sweep = await runSweep()
    expect(sweep.status).toBe(200)

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'resolved', resolution: 'rejected', reason_code: 'RejectedByStaff' })
  })
})

describe('sweep recovery — an unsafe-to-interpret Meeting state is counted for manual review, never guessed', () => {
  it('a Meeting in a cEstadoReserva outside {Confirmed, Canceled} is counted in inconsistentMeetings, never resolved as approval_expired by guesswork', async () => {
    const { requestId, meetingId } = await createVerifiedAndExpiredBooking(50)

    // Estado real del dominio (packages/contracts/src/estado-reserva.ts)
    // que `deriveResolutionFromDecidedMeeting` no sabe interpretar como
    // una resolución de BookingRequestRecord — simula, por ejemplo, un
    // Meeting que un futuro adaptador real marcó `NoShow` mientras la
    // solicitud seguía `pending_approval` en el BFF.
    await decideSimEspoMeetingForTesting(meetingId, 'NoShow', 'staff-1', null)

    const sweep = await runSweep()
    expect(sweep.status).toBe(200)
    expect((sweep.body as { inconsistentMeetings: number }).inconsistentMeetings).toBeGreaterThanOrEqual(1)

    // Nunca se inventa una resolución — la solicitud queda tal cual para
    // revisión manual, no "approval_expired" por defecto.
    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'pending_approval', resolution: null })
  })

  it('"Fase 4B — flujo de decisión final": Canceled SIN resolutionReason (dato heredado) nunca se adivina por decidedBy — cuenta como inconsistencia', async () => {
    // Offsets 1-51 a las 10:00 UTC están TODOS ya en uso por algún fichero
    // de la suite de integración que comparte
    // treatment-masaje-relajante-60/professional-owner/zone-cabina-1
    // (booking.{approvalSweep,authenticatedFlow,concurrency,otpOutbox,
    // auditAtomicity,guestFlow,outboxLease,decisionRecovery,sweepRecovery}
    // .int.test.ts) — y 52+ supera `MAX_LEAD_TIME_DAYS = 60`
    // (packages/contracts/src/booking.ts) en el peor caso, con 400/409
    // (`horizon_violation`/`slot_unavailable`). Se usa 11:00 UTC (franja
    // no usada en ningún fichero de la suite) en vez de pelear por un
    // hueco de día ya agotado.
    const { requestId, meetingId } = await createVerifiedAndExpiredBooking(21, nextBusinessDayAt11Utc)

    // decidedBy lleva el sentinel de caducidad de sistema, pero
    // resolutionReason es null — dato heredado ambiguo (p. ej. un Meeting
    // decidido antes de que este campo existiera). El barrido NUNCA debe
    // reinterpretar esto como "approval_expired" solo porque decidedBy lo
    // sugiere — esa es exactamente la inferencia prohibida por el encargo.
    await decideSimEspoMeetingForTesting(meetingId, 'Canceled', 'system:approval-sweep', null)

    const sweep = await runSweep()
    expect(sweep.status).toBe(200)
    expect((sweep.body as { inconsistentMeetings: number }).inconsistentMeetings).toBeGreaterThanOrEqual(1)

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'pending_approval', resolution: null })
  })

  it('"Fase 4B — flujo de decisión final": Confirmed con resolutionReason incompatible (RejectedByStaff) nunca se adopta como aprobación — cuenta como inconsistencia', async () => {
    const { requestId, meetingId } = await createVerifiedAndExpiredBooking(35)

    // Combinación que MeetingResolutionPolicy nunca debería dejar escribir
    // en la instancia real — simula un dato corrupto/heredado para probar
    // que el barrido falla seguro en vez de confiar ciegamente en
    // cEstadoReserva === 'Confirmed'.
    await decideSimEspoMeetingForTesting(meetingId, 'Confirmed', 'staff-1', 'RejectedByStaff')

    const sweep = await runSweep()
    expect(sweep.status).toBe(200)
    expect((sweep.body as { inconsistentMeetings: number }).inconsistentMeetings).toBeGreaterThanOrEqual(1)

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'pending_approval', resolution: null })
  })
})

describe('sweep recovery — concurrent sweep passes converge on a single coherent resolution', () => {
  it('two concurrent sweep runs over the same expired+already-canceled request never double-resolve or crash', async () => {
    const { requestId, meetingId } = await createVerifiedAndExpiredBooking(51)
    await decideSimEspoMeetingForTesting(meetingId, 'Canceled', 'system:approval-sweep', 'ApprovalExpired')

    const [first, second] = await Promise.all([runSweep(), runSweep()])
    expect([first.status, second.status]).toEqual([200, 200])

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'resolved', resolution: 'approval_expired' })
  })
})
