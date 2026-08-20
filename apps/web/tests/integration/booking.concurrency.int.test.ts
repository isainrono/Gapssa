import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import {
  auditRowsForBookingEntity,
  disableMeetingCreationFailureFor,
  disableMeetingLinkFailureFor,
  enableMeetingCreationFailureFor,
  enableMeetingLinkFailureFor,
  findBookingRequestRow,
  findSimEspoMeetingByBookingRequestId,
  installMeetingCreationFailureInjection,
  installMeetingLinkFailureInjection,
} from './bookingDb'
import { deleteBookingLocksFor, hasAnyBookingLock } from './redisTestHelper'

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
  return { firstName: 'Concurrencia', lastName: 'Prueba', phone: '+34 633 333 333', email: `guest-${unique}@example.test` }
}

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es')
  return jar
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

async function createGuestRequest(dayOffset: number, guest = freshGuest()) {
  const jar = await freshJarWithCsrf()
  const startAt = nextBusinessDayAt10Utc(dayOffset)
  const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
    idempotencyKey: randomUUID(),
    treatmentId: TREATMENT_ID,
    professionalId: PROFESSIONAL_ID,
    zoneId: ZONE_ID,
    startAt,
    guest,
  })
  return { jar, guest, startAt, create }
}

describe('concurrencia — dos clientes reclamando el mismo horario', () => {
  it('solo uno de los dos gana el hueco; el otro recibe slot_unavailable', async () => {
    const startAt = nextBusinessDayAt10Utc(40)
    const guestA = freshGuest()
    const guestB = freshGuest()
    const jarA = await freshJarWithCsrf()
    const jarB = await freshJarWithCsrf()

    const [responseA, responseB] = await Promise.all([
      bookingApi.post(jarA, '/api/booking/v1/requests', {
        idempotencyKey: randomUUID(),
        treatmentId: TREATMENT_ID,
        professionalId: PROFESSIONAL_ID,
        zoneId: ZONE_ID,
        startAt,
        guest: guestA,
      }),
      bookingApi.post(jarB, '/api/booking/v1/requests', {
        idempotencyKey: randomUUID(),
        treatmentId: TREATMENT_ID,
        professionalId: PROFESSIONAL_ID,
        zoneId: ZONE_ID,
        startAt,
        guest: guestB,
      }),
    ])

    const statuses = [responseA.status, responseB.status].sort()
    expect(statuses).toEqual([202, 409])

    const loser = responseA.status === 409 ? responseA : responseB
    expect(loser.body.error).toMatchObject({ code: 'slot_unavailable' })
  })
})

describe('concurrencia — dos verificaciones simultáneas con el mismo código correcto', () => {
  it('ambas responden con éxito, pero solo se crea un Meeting y una sola transición auditada', async () => {
    const { guest, create } = await createGuestRequest(41)
    expect(create.status).toBe(202)
    const requestId = create.body.requestId as string
    const accessToken = create.body.accessToken as string
    const code = await getLatestOtpCodeForEmail(guest.email)

    const jar1 = await freshJarWithCsrf()
    const jar2 = await freshJarWithCsrf()

    const [verify1, verify2] = await Promise.all([
      bookingApi.post(jar1, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken }),
      bookingApi.post(jar2, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken }),
    ])

    // Ambas ganan (una "verified" real, la otra recupera vía already_consumed
    // con el mismo código correcto) — nunca un error de servidor.
    expect([verify1.status, verify2.status]).toEqual([200, 200])
    expect(verify1.body.meetingId).toBe(verify2.body.meetingId)

    const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meeting).toMatchObject({ c_estado_reserva: 'PendingCenterApproval' })

    const audits = await auditRowsForBookingEntity('BookingRequestRecord', requestId)
    const statusTransitions = (audits as Record<string, unknown>[]).filter(
      (row) => row.value_representation === 'raw' && row.field === 'status' && row.new_value === 'pending_approval',
    )
    expect(statusTransitions).toHaveLength(1)
  })
})

describe('recuperación — fallo de EspoCRM antes de crear el Meeting', () => {
  it('la primera verificación falla, el registro permanece recuperable, y un reintento con el mismo código completa sin duplicar', async () => {
    await installMeetingCreationFailureInjection()
    const { guest, create } = await createGuestRequest(42)
    const requestId = create.body.requestId as string
    const accessToken = create.body.accessToken as string
    const code = await getLatestOtpCodeForEmail(guest.email)

    await enableMeetingCreationFailureFor(requestId)
    try {
      const jar = await freshJarWithCsrf()
      const failedVerify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
      expect(failedVerify.status).not.toBe(200)

      // El registro sigue vivo y sin Meeting — nunca se purgó la identidad
      // por un fallo de EspoCRM (docs/contratos-portal-v1.md §3.4, paso 8).
      const midway = await findBookingRequestRow(requestId)
      expect(midway).toMatchObject({ meeting_id: null })
      expect(await findSimEspoMeetingByBookingRequestId(requestId)).toBeNull()
    } finally {
      await disableMeetingCreationFailureFor(requestId)
    }

    const jar2 = await freshJarWithCsrf()
    const retry = await bookingApi.post(jar2, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
    expect(retry.status).toBe(200)
    expect(retry.body.meetingId).toBeTruthy()

    const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meeting).toMatchObject({ c_estado_reserva: 'PendingCenterApproval' })
  })
})

describe('recuperación — fallo al escribir meetingId después de crear el Meeting', () => {
  it('el Meeting ya creado se adopta en el reintento, nunca se duplica', async () => {
    await installMeetingLinkFailureInjection()
    const { guest, create } = await createGuestRequest(43)
    const requestId = create.body.requestId as string
    const accessToken = create.body.accessToken as string
    const code = await getLatestOtpCodeForEmail(guest.email)

    await enableMeetingLinkFailureFor(requestId)
    try {
      const jar = await freshJarWithCsrf()
      const failedVerify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
      expect(failedVerify.status).not.toBe(200)

      // El Meeting SÍ se creó en el adaptador simulado (paso 6 completado)
      // aunque la escritura de meetingId en Postgres fallara (paso 7).
      const meetingAfterFailure = await findSimEspoMeetingByBookingRequestId(requestId)
      expect(meetingAfterFailure).not.toBeNull()

      const midway = await findBookingRequestRow(requestId)
      expect(midway).toMatchObject({ meeting_id: null })
    } finally {
      await disableMeetingLinkFailureFor(requestId)
    }

    const jar2 = await freshJarWithCsrf()
    const retry = await bookingApi.post(jar2, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
    expect(retry.status).toBe(200)

    const finalRecord = await findBookingRequestRow(requestId)
    expect(finalRecord).toMatchObject({ status: 'pending_approval' })
    expect(finalRecord?.meeting_id).toBe(retry.body.meetingId)

    // Un único Meeting para esta solicitud — el índice único de
    // booking_request_id ya lo garantiza a nivel de esquema, esto confirma
    // que el reintento lo adoptó en vez de intentar (y fallar) crear otro.
    expect(await findSimEspoMeetingByBookingRequestId(requestId)).toMatchObject({ id: retry.body.meetingId })
  })
})

describe('recuperación — pérdida del BookingLock en Redis', () => {
  it('el barrido de conciliación reconstruye el lock de una solicitud activa a partir de Postgres', async () => {
    const { create } = await createGuestRequest(44)
    expect(create.status).toBe(202)

    expect(await hasAnyBookingLock(PROFESSIONAL_ID, ZONE_ID)).toBe(true)
    await deleteBookingLocksFor(PROFESSIONAL_ID, ZONE_ID)
    expect(await hasAnyBookingLock(PROFESSIONAL_ID, ZONE_ID)).toBe(false)

    const sweep = await internalPost('/api/booking/v1/internal/sweep', {})
    expect(sweep.status).toBe(200)
    expect((sweep.body as { reconstructedLocks: number }).reconstructedLocks).toBeGreaterThanOrEqual(1)

    expect(await hasAnyBookingLock(PROFESSIONAL_ID, ZONE_ID)).toBe(true)
  })
})

describe('auditoría — nunca PII del invitado ni códigos OTP', () => {
  it('booking_audit_log no contiene el nombre, correo, teléfono ni el código del invitado en ningún punto del flujo', async () => {
    const { guest, create } = await createGuestRequest(45)
    const requestId = create.body.requestId as string
    const accessToken = create.body.accessToken as string
    const code = await getLatestOtpCodeForEmail(guest.email)
    expect(code).toBeTruthy()

    const jar = await freshJarWithCsrf()
    const verify = await bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
    expect(verify.status).toBe(200)

    await internalPost('/api/booking/v1/internal/decisions', {
      meetingId: verify.body.meetingId,
      decision: 'approved',
      decidedBy: 'staff-1',
    })

    const audits = await auditRowsForBookingEntity('BookingRequestRecord', requestId)
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toContain(guest.firstName)
    expect(serialized).not.toContain(guest.lastName)
    expect(serialized).not.toContain(guest.email)
    expect(serialized).not.toContain(guest.phone)
    expect(serialized).not.toContain(code as string)
  })
})
