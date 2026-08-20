import { describe, expect, it, vi, beforeEach } from 'vitest'

// `availabilityConfig` se mockea completa para que los tests sean
// deterministas y no dependan de las variables de entorno reales
// (`.env`) ni de su horario de apertura/granularidad configurados para
// desarrollo — revisión 2, punto 1: fijamos aquí exactamente lo que cada
// escenario necesita. `vi.hoisted` porque `vi.mock` se eleva por encima
// de cualquier `const` de nivel superior.
const mockedAvailabilityConfig = vi.hoisted(() => ({
  minLeadTimeHours: 0,
  maxLeadTimeDays: 365,
  openDays: [0, 1, 2, 3, 4, 5, 6],
  openTime: '09:00',
  closeTime: '21:00',
  slotGranularityMinutes: 30,
  maxSlotsPerQuery: 40,
}))

vi.mock('./availabilityConfig', () => ({
  availabilityConfig: mockedAvailabilityConfig,
}))

const listUnresolvedOverlappingMock = vi.hoisted(() => vi.fn(async () => [] as UnresolvedOverlapRow[]))
vi.mock('./repository', () => ({
  listUnresolvedOverlapping: (...args: unknown[]) => listUnresolvedOverlappingMock(...(args as [])),
}))

import { computeAvailability, type AvailabilitySlot } from './availability'
import { zonedTimeToUtc } from './timezone'
import type { EspoBookingAdapter, SimMeeting } from './espoAdapter'
import type { ProfessionalFixture, TreatmentFixture, ZoneFixture } from './catalog'

interface UnresolvedOverlapRow {
  id: string
  professionalId: string
  zoneId: string
  startAt: Date
  endAt: Date
}

const NOW = new Date('2026-08-10T06:00:00Z')
const QUERY_DATE = '2026-08-11' // martes — dentro de openDays por config mockeada

function localTime(hour: number, minute: number): Date {
  const [year, month, day] = QUERY_DATE.split('-').map(Number) as [number, number, number]
  return zonedTimeToUtc(year, month, day, hour, minute)
}

function makeMeeting(overrides: Partial<SimMeeting> & Pick<SimMeeting, 'professionalId' | 'zoneId' | 'startAt' | 'endAt'>): SimMeeting {
  return {
    id: `meeting-${Math.random().toString(36).slice(2)}`,
    contactIds: ['contact-1'],
    bookingRequestId: `request-${Math.random().toString(36).slice(2)}`,
    treatmentId: 'treatment-test',
    cEstadoReserva: 'PendingCenterApproval',
    status: 'Planned',
    decidedBy: null,
    decidedAt: null,
    note: null,
    resolutionReason: null,
    cExcluirGoogleCalendarSync: false,
    ...overrides,
  }
}

function makeAdapter(input: {
  treatment: TreatmentFixture
  zones: ZoneFixture[]
  professionals: ProfessionalFixture[]
  activeMeetings?: SimMeeting[]
}): EspoBookingAdapter {
  return {
    listTreatments: async () => [input.treatment],
    listZones: async () => input.zones,
    listProfessionals: async () => input.professionals,
    getTreatment: async (id) => (id === input.treatment.id ? input.treatment : null),
    getZone: async (id) => input.zones.find((zone) => zone.id === id) ?? null,
    getProfessional: async (id) => input.professionals.find((professional) => professional.id === id) ?? null,
    listActiveMeetingsOverlapping: async () => input.activeMeetings ?? [],
    findMeetingByBookingRequestId: async () => ({ outcome: 'not_found' }),
    getMeetingById: async () => null,
    getContactById: async () => null,
    findOrCreateContact: async () => {
      throw new Error('not used by computeAvailability')
    },
    createMeeting: async () => {
      throw new Error('not used by computeAvailability')
    },
    decideMeeting: async () => null,
    expireMeeting: async () => null,
    listAllMeetings: async () => [],
  }
}

const TREATMENT_60: TreatmentFixture = {
  id: 'treatment-60',
  name: 'Tratamiento 60 min',
  familia: 'test',
  durationMinutes: 60,
}
const TREATMENT_30: TreatmentFixture = {
  id: 'treatment-30',
  name: 'Tratamiento 30 min',
  familia: 'test',
  durationMinutes: 30,
}

function slotsAt(slots: AvailabilitySlot[], hour: number, minute: number): AvailabilitySlot[] {
  const target = localTime(hour, minute).toISOString()
  return slots.filter((slot) => slot.startAt === target)
}

beforeEach(() => {
  listUnresolvedOverlappingMock.mockReset()
  listUnresolvedOverlappingMock.mockResolvedValue([])
})

describe('computeAvailability', () => {
  it('offers overlapping alternative start times for a single professional (no false occupancy from offered slots)', async () => {
    const zoneCapacity1: ZoneFixture = { id: 'zone-1', name: 'Zona 1', capacidadSimultanea: 1 }
    const professional: ProfessionalFixture = { id: 'professional-1', name: 'Prof 1', active: true }
    const adapter = makeAdapter({ treatment: TREATMENT_60, zones: [zoneCapacity1], professionals: [professional] })

    const result = await computeAvailability(adapter, { treatmentId: TREATMENT_60.id, date: QUERY_DATE }, NOW)
    expect(result.outcome).toBe('ok')
    if (result.outcome !== 'ok') return

    // 60 min de duración con 30 min de granularidad: 09:00, 09:30 y 10:00
    // deben poder ofrecerse TODOS como alternativas para la misma
    // profesional — antes del arreglo, aceptar 09:00 marcaba la
    // profesional como "ocupada" hasta las 10:00 y 09:30 nunca se ofrecía.
    expect(slotsAt(result.slots, 9, 0)).toHaveLength(1)
    expect(slotsAt(result.slots, 9, 30)).toHaveLength(1)
    expect(slotsAt(result.slots, 10, 0)).toHaveLength(1)
  })

  it('offers two professionals as alternatives for the same time in a zone with capacity 1', async () => {
    const zoneCapacity1: ZoneFixture = { id: 'zone-1', name: 'Zona 1', capacidadSimultanea: 1 }
    const professionals: ProfessionalFixture[] = [
      { id: 'professional-a', name: 'Prof A', active: true },
      { id: 'professional-b', name: 'Prof B', active: true },
    ]
    const adapter = makeAdapter({ treatment: TREATMENT_30, zones: [zoneCapacity1], professionals })

    const result = await computeAvailability(adapter, { treatmentId: TREATMENT_30.id, date: QUERY_DATE }, NOW)
    expect(result.outcome).toBe('ok')
    if (result.outcome !== 'ok') return

    // Ambas profesionales deben poder ofrecerse como alternativas a las
    // 09:00 aunque la zona solo tenga capacidad para una cita simultánea
    // real — la capacidad real se confirma al crear la reserva, no aquí.
    const at9 = slotsAt(result.slots, 9, 0)
    expect(at9.map((slot) => slot.professionalId).sort()).toEqual(['professional-a', 'professional-b'])
  })

  it('removes only the slots that real occupancy (Meeting/BookingRequestRecord) actually blocks', async () => {
    const zone: ZoneFixture = { id: 'zone-1', name: 'Zona 1', capacidadSimultanea: 2 }
    const professional: ProfessionalFixture = { id: 'professional-1', name: 'Prof 1', active: true }
    const adapter = makeAdapter({
      treatment: TREATMENT_30,
      zones: [zone],
      professionals: [professional],
      activeMeetings: [
        makeMeeting({
          professionalId: professional.id,
          zoneId: zone.id,
          startAt: localTime(9, 30),
          endAt: localTime(10, 0),
        }),
      ],
    })

    const result = await computeAvailability(adapter, { treatmentId: TREATMENT_30.id, date: QUERY_DATE }, NOW)
    expect(result.outcome).toBe('ok')
    if (result.outcome !== 'ok') return

    expect(slotsAt(result.slots, 9, 0)).toHaveLength(1)
    expect(slotsAt(result.slots, 9, 30)).toHaveLength(0)
    expect(slotsAt(result.slots, 10, 0)).toHaveLength(1)
  })

  it('counts unresolved BookingRequestRecord (pending_verification/verification_processing) as real occupancy too', async () => {
    const zone: ZoneFixture = { id: 'zone-1', name: 'Zona 1', capacidadSimultanea: 1 }
    const professional: ProfessionalFixture = { id: 'professional-1', name: 'Prof 1', active: true }
    const adapter = makeAdapter({ treatment: TREATMENT_30, zones: [zone], professionals: [professional] })

    listUnresolvedOverlappingMock.mockResolvedValue([
      {
        id: 'unresolved-1',
        professionalId: professional.id,
        zoneId: zone.id,
        startAt: localTime(9, 0),
        endAt: localTime(9, 30),
      },
    ])

    const result = await computeAvailability(adapter, { treatmentId: TREATMENT_30.id, date: QUERY_DATE }, NOW)
    expect(result.outcome).toBe('ok')
    if (result.outcome !== 'ok') return

    expect(slotsAt(result.slots, 9, 0)).toHaveLength(0)
    expect(slotsAt(result.slots, 9, 30)).toHaveLength(1)
  })

  it('respects a 30-minute granularity for a 60-minute treatment, offering 09:00/09:30/10:00/...', async () => {
    const zone: ZoneFixture = { id: 'zone-1', name: 'Zona 1', capacidadSimultanea: 5 }
    const professional: ProfessionalFixture = { id: 'professional-1', name: 'Prof 1', active: true }
    const adapter = makeAdapter({ treatment: TREATMENT_60, zones: [zone], professionals: [professional] })

    const result = await computeAvailability(adapter, { treatmentId: TREATMENT_60.id, date: QUERY_DATE }, NOW)
    expect(result.outcome).toBe('ok')
    if (result.outcome !== 'ok') return

    const startTimes = result.slots.map((slot) => slot.startAt)
    expect(startTimes).toContain(localTime(9, 0).toISOString())
    expect(startTimes).toContain(localTime(9, 30).toISOString())
    expect(startTimes).toContain(localTime(10, 0).toISOString())
    expect(startTimes).toContain(localTime(10, 30).toISOString())

    // Nunca un candidato fuera de la rejilla de 30 min (p. ej. 09:15).
    for (const slot of result.slots) {
      const minute = new Date(slot.startAt).getUTCMinutes()
      expect([0, 30]).toContain(minute)
    }
  })

  it('is deterministic across repeated calls and respects maxSlotsPerQuery without always favoring the first professional', async () => {
    const zone: ZoneFixture = { id: 'zone-1', name: 'Zona 1', capacidadSimultanea: 5 }
    const professionals: ProfessionalFixture[] = [
      { id: 'professional-z', name: 'Prof Z', active: true },
      { id: 'professional-a', name: 'Prof A', active: true },
    ]
    const adapter = makeAdapter({ treatment: TREATMENT_30, zones: [zone], professionals })

    mockedAvailabilityConfig.maxSlotsPerQuery = 3
    try {
      const first = await computeAvailability(adapter, { treatmentId: TREATMENT_30.id, date: QUERY_DATE }, NOW)
      const second = await computeAvailability(adapter, { treatmentId: TREATMENT_30.id, date: QUERY_DATE }, NOW)
      expect(first.outcome).toBe('ok')
      expect(second.outcome).toBe('ok')
      if (first.outcome !== 'ok' || second.outcome !== 'ok') return

      expect(first.slots).toHaveLength(3)
      expect(first.slots).toEqual(second.slots)

      // Orden determinista por profesional dentro del primer horario
      // (09:00) para ESTA fecha concreta (2026-08-11, desplazamiento de
      // rotación 0 con 2 profesionales — ver test siguiente para la
      // rotación real): ordenado por id ('professional-a' antes que
      // 'professional-z'), no por el orden de llegada de
      // adapter.listProfessionals().
      expect(first.slots[0]?.professionalId).toBe('professional-a')
      expect(first.slots[1]?.professionalId).toBe('professional-z')
    } finally {
      mockedAvailabilityConfig.maxSlotsPerQuery = 40
    }
  })

  it('revisión 3, punto 6 — maxSlotsPerQuery cutting mid time-slot never lets the same professional monopolize the result across different queried dates', async () => {
    const zone: ZoneFixture = { id: 'zone-1', name: 'Zona 1', capacidadSimultanea: 5 }
    // Tres profesionales activas, tope de 1 slot: con el número de
    // profesionales activas >= al tope, el primer horario candidato (el
    // más temprano del día) por sí solo agota el tope — antes del arreglo,
    // eso significaba que SOLO la profesional de id "menor" aparecía en el
    // resultado, para SIEMPRE, sin importar la fecha consultada.
    const professionals: ProfessionalFixture[] = [
      { id: 'professional-a', name: 'Prof A', active: true },
      { id: 'professional-b', name: 'Prof B', active: true },
      { id: 'professional-c', name: 'Prof C', active: true },
    ]
    const adapter = makeAdapter({ treatment: TREATMENT_30, zones: [zone], professionals })

    mockedAvailabilityConfig.maxSlotsPerQuery = 1
    try {
      // Un rango de fechas consecutivas suficientemente amplio para
      // recorrer las 3 posiciones posibles de rotación al menos una vez
      // (martes 2026-08-11 en adelante, todas dentro de openDays).
      const winners = new Set<string>()
      for (let offset = 0; offset < 6; offset += 1) {
        const date = new Date(Date.UTC(2026, 7, 11 + offset)).toISOString().slice(0, 10)
        const result = await computeAvailability(adapter, { treatmentId: TREATMENT_30.id, date }, NOW)
        expect(result.outcome).toBe('ok')
        if (result.outcome !== 'ok') continue
        expect(result.slots).toHaveLength(1)
        winners.add(result.slots[0]!.professionalId)

        // Determinismo: repetir la MISMA fecha da SIEMPRE la MISMA ganadora
        // — la rotación depende de la fecha consultada, nunca de aleatoriedad.
        const repeat = await computeAvailability(adapter, { treatmentId: TREATMENT_30.id, date }, NOW)
        expect(repeat.outcome).toBe('ok')
        if (repeat.outcome === 'ok') {
          expect(repeat.slots).toEqual(result.slots)
        }
      }

      // Ninguna profesional monopoliza sistemáticamente el resultado: a lo
      // largo de estas fechas aparece más de una ganadora distinta.
      expect(winners.size).toBeGreaterThan(1)
    } finally {
      mockedAvailabilityConfig.maxSlotsPerQuery = 40
    }
  })
})
