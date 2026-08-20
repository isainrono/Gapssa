import { randomUUID } from 'node:crypto'

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'

// `SimulatedEspoBookingAdapter` (espoAdapter.ts) importa `server-only`
// (marcador que revienta fuera del bundler de Next — ver el comentario de
// `vitest.setup.ts`, que hace exactamente este mock para la suite
// unitaria). La suite de integración no lo aplica globalmente porque el
// resto de sus ficheros hablan con el servidor real por HTTP
// (`bookingClient.ts`) y nunca importan código `server-only` directamente
// — este fichero es la única excepción: contract-testea la clase del
// adaptador en sí, no un endpoint, así que necesita importarla en el
// propio proceso de Vitest.
vi.mock('server-only', () => ({}))

const { SimulatedEspoBookingAdapter } = await import('../../src/server/booking/espoAdapter')
const schema = await import('../../src/server/booking/db/schema')

/**
 * Pruebas contractuales del adaptador SIMULADO — Fase 4B, punto 9. Mismos
 * escenarios que `src/server/booking/httpEspoAdapter.test.ts` (servidor
 * fake), para demostrar comportamiento equivalente en los puntos que
 * exige el contrato `EspoBookingAdapter`. Corre contra
 * `gapssa_booking_test_<random>` (efímera, creada y migrada por
 * `global-setup.ts`) — nunca contra `gapssa_booking` real: el cliente de
 * este fichero se construye a mano con la URL inyectada por `inject()`,
 * nunca con el `bookingDb` importado desde `server/booking/db/client.ts`
 * (ese sí apuntaría a la base real de desarrollo).
 */

const pool = new Pool({ connectionString: inject('integrationBookingDatabaseUrl') })
const testDb = drizzle(pool, { schema })

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await testDb.delete(schema.simEspoMeetings)
  await testDb.delete(schema.simEspoContacts)
})

function adapter() {
  return new SimulatedEspoBookingAdapter(testDb)
}

describe('matching de Contact', () => {
  it('cero coincidencias crea un Contact nuevo', async () => {
    const result = await adapter().findOrCreateContact({
      firstName: 'Ana',
      lastName: 'Ruiz',
      email: 'ana-sim@example.com',
      phone: '+34600000101',
    })
    expect(result.outcome).toBe('created')
  })

  it('una coincidencia inequívoca por correo se reutiliza', async () => {
    const created = await adapter().findOrCreateContact({
      firstName: 'Ana',
      lastName: 'Ruiz',
      email: 'ana-sim2@example.com',
      phone: '+34600000102',
    })
    const result = await adapter().findOrCreateContact({
      firstName: 'Ana',
      lastName: 'Ruiz',
      email: 'ana-sim2@example.com',
      phone: '+34699999999',
    })
    expect(result.outcome).toBe('matched')
    if (result.outcome === 'matched' && created.outcome !== 'manual_review') {
      expect(result.contact.id).toBe(created.contact.id)
    }
  })

  it('correo y teléfono apuntan a Contacts distintos -> manual_review, nunca se fusiona', async () => {
    await adapter().findOrCreateContact({ firstName: 'Ana', lastName: 'Ruiz', email: 'ana-sim3@example.com', phone: '+34600000103' })
    await adapter().findOrCreateContact({ firstName: 'Otro', lastName: 'Contacto', email: 'otro-sim3@example.com', phone: '+34600000104' })

    const result = await adapter().findOrCreateContact({
      firstName: 'Ana',
      lastName: 'Ruiz',
      email: 'ana-sim3@example.com',
      phone: '+34600000104',
    })
    expect(result.outcome).toBe('manual_review')
  })
})

describe('búsqueda de Meeting por bookingRequestId', () => {
  it('sin Meeting existente, devuelve not_found', async () => {
    expect(await adapter().findMeetingByBookingRequestId(randomUUID())).toEqual({ outcome: 'not_found' })
  })

  // A diferencia de `HttpEspoBookingAdapter` (`httpEspoAdapter.test.ts`,
  // "búsqueda de Meeting por cBookingRequestId"), el estado `duplicate` NO
  // es reproducible aquí: `sim_espo_meetings.booking_request_id` tiene un
  // índice único real en Postgres (`db/schema.ts`) — un segundo `INSERT`
  // con el mismo bookingRequestId falla en la propia base de datos, nunca
  // llega a existir como fila. Es la asimetría deliberada entre ambos
  // adaptadores: Postgres SÍ puede garantizar esta unicidad de forma
  // atómica hoy; la API REST de EspoCRM real, sin el índice único
  // recomendado (`docs/fase4b-integracion-http.md` §10, punto 2, pendiente
  // de autorización), no. El contrato (`MeetingLookupResult`) sigue siendo
  // idéntico en ambos — la prueba de la rama `duplicate` en sí solo puede
  // demostrarse de forma realista contra el adaptador HTTP.
})

async function fixtureInput(bookingRequestId: string) {
  const contact = await adapter().findOrCreateContact({
    firstName: 'Ana',
    lastName: 'Ruiz',
    email: `${bookingRequestId}@example.com`,
    phone: '+34600000105',
  })
  if (contact.outcome === 'manual_review') throw new Error('unexpected manual_review in fixture')
  return {
    bookingRequestId,
    contactId: contact.contact.id,
    treatmentId: 'treatment-masaje-relajante-60',
    professionalId: 'professional-owner',
    zoneId: 'zone-cabina-1',
    startAt: new Date('2026-09-01T09:00:00.000Z'),
    endAt: new Date('2026-09-01T10:00:00.000Z'),
  }
}

describe('creación idempotente de Meeting', () => {
  it('crea el Meeting cuando no existe todavía', async () => {
    const bookingRequestId = randomUUID()
    const input = await fixtureInput(bookingRequestId)
    const outcome = await adapter().createMeeting(input)
    expect(outcome.outcome).toBe('created')
    if (outcome.outcome !== 'created') return
    expect(outcome.meeting.bookingRequestId).toBe(bookingRequestId)
    expect(outcome.meeting.contactIds).toEqual([input.contactId])
  })

  it('reintentar con la misma bookingRequestId adopta el Meeting ya creado, nunca duplica', async () => {
    const bookingRequestId = randomUUID()
    const input = await fixtureInput(bookingRequestId)
    const first = await adapter().createMeeting(input)
    const second = await adapter().createMeeting(input)
    expect(first.outcome).toBe('created')
    expect(second.outcome).toBe('created')
    if (first.outcome !== 'created' || second.outcome !== 'created') return
    expect(second.meeting.id).toBe(first.meeting.id)

    const all = await adapter().listAllMeetings()
    expect(all.filter((m) => m.bookingRequestId === bookingRequestId)).toHaveLength(1)
  })

  it('dos creaciones concurrentes con la misma bookingRequestId: o bien coinciden en un único Meeting, o bien ambas detectan y reportan el mismo duplicate — nunca una gana en silencio dejando la otra huérfana', async () => {
    // Revisión 2 de Fase 4B, punto 1: sin índice único en bookingRequestId
    // (db/schema.ts — la instancia real de EspoCRM tampoco lo tiene hoy),
    // una carrera genuina puede producir dos filas reales. El resultado
    // válido depende del entrelazado exacto de los dos INSERT concurrentes
    // — nunca es "una llamada adopta la otra sin comprobar", que es
    // exactamente el comportamiento prohibido.
    const bookingRequestId = randomUUID()
    const input = await fixtureInput(bookingRequestId)
    const [a, b] = await Promise.all([adapter().createMeeting(input), adapter().createMeeting(input)])

    const all = await adapter().listAllMeetings()
    const rowsForRequest = all.filter((m) => m.bookingRequestId === bookingRequestId)

    if (rowsForRequest.length === 1) {
      expect(a.outcome).toBe('created')
      expect(b.outcome).toBe('created')
      if (a.outcome === 'created' && b.outcome === 'created') {
        expect(a.meeting.id).toBe(b.meeting.id)
      }
    } else {
      expect(rowsForRequest).toHaveLength(2)
      expect(a.outcome).toBe('duplicate')
      expect(b.outcome).toBe('duplicate')
      if (a.outcome === 'duplicate' && b.outcome === 'duplicate') {
        expect(a.meetingIds.sort()).toEqual(b.meetingIds.sort())
        expect(a.meetingIds.sort()).toEqual(rowsForRequest.map((m) => m.id).sort())
      }
    }
  })
})

describe('decisión de Meeting: CAS real', () => {
  async function createOne(bookingRequestId: string) {
    const input = await fixtureInput(bookingRequestId)
    const outcome = await adapter().createMeeting(input)
    if (outcome.outcome !== 'created') throw new Error('unexpected duplicate in fixture')
    return outcome.meeting
  }

  it('aprobar un Meeting en PendingCenterApproval lo confirma con resolutionReason Approved', async () => {
    const meeting = await createOne(randomUUID())
    const result = await adapter().decideMeeting({ meetingId: meeting.id, decision: 'approved', decidedBy: 'staff-1', operationKey: randomUUID() })
    expect(result?.cEstadoReserva).toBe('Confirmed')
    expect(result?.resolutionReason).toBe('Approved')
  })

  it('rechazar con nota exige nota no vacía y marca resolutionReason RejectedByStaff', async () => {
    const meeting = await createOne(randomUUID())
    const result = await adapter().decideMeeting({
      meetingId: meeting.id,
      decision: 'rejected',
      decidedBy: 'staff-1',
      note: 'no compatible con la agenda',
      operationKey: randomUUID(),
    })
    expect(result?.cEstadoReserva).toBe('Canceled')
    expect(result?.resolutionReason).toBe('RejectedByStaff')
  })

  it('expireMeeting marca resolutionReason ApprovalExpired, distinguible de un rechazo manual', async () => {
    const meeting = await createOne(randomUUID())
    const result = await adapter().expireMeeting({ meetingId: meeting.id, operationKey: randomUUID() })
    expect(result?.cEstadoReserva).toBe('Canceled')
    expect(result?.resolutionReason).toBe('ApprovalExpired')
  })

  it('decidir un Meeting ya decidido devuelve null, nunca sobrescribe (CAS real de Postgres)', async () => {
    const meeting = await createOne(randomUUID())
    await adapter().decideMeeting({ meetingId: meeting.id, decision: 'rejected', decidedBy: 'staff-1', note: 'motivo', operationKey: randomUUID() })
    const second = await adapter().decideMeeting({ meetingId: meeting.id, decision: 'approved', decidedBy: 'staff-2', operationKey: randomUUID() })
    expect(second).toBeNull()

    const current = await adapter().getMeetingById(meeting.id)
    expect(current?.cEstadoReserva).toBe('Canceled')
    expect(current?.resolutionReason).toBe('RejectedByStaff')
  })
})

describe('ningún acceso accidental a gapssa_booking real', () => {
  it('la conexión de este fichero apunta a la base de pruebas inyectada, nunca a DATABASE_URL_BOOKING del proceso', () => {
    expect(inject('integrationBookingDatabaseUrl')).toMatch(/gapssa_booking_test_/)
  })
})
