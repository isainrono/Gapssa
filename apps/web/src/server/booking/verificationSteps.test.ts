import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Fase 4B, revisión 2, puntos 1/2/3 — pruebas del flujo reestructurado de
 * `completeBookingToMeeting`: matriz exacta pedida — Meeting con Contact
 * correcto / sin Contact / con dos Contacts / con Contact distinto; mismo
 * horario+tratamiento pero otra persona (ambigüedad de Contact antes de
 * tocar el Meeting); timeout de creación seguido de adopción con Contact
 * correcto; timeout seguido de Meeting incompatible (duplicado). Todo el
 * acceso a Postgres/Redis/auth se mockea — estas son pruebas unitarias
 * puras sobre la orquestación, nunca contra una base real (ver
 * `tests/integration/booking.review.int.test.ts` para el ciclo completo).
 */

vi.mock('server-only', () => ({}))

const repositoryMock = vi.hoisted(() => ({
  openBookingReviewAtomic: vi.fn(async () => ({ outcome: 'opened' as const, review: { id: 'review-1' } }) as never),
  writeMeetingIdAndPendingApproval: vi.fn(async () => 'updated' as const),
  purgePendingGuestIdentity: vi.fn(async () => {}),
  purgePendingAuthenticatedContactDetails: vi.fn(async () => {}),
  findPendingGuestIdentity: vi.fn(async () => null),
  findPendingAuthenticatedContactDetails: vi.fn(async () => null),
}))
vi.mock('./repository', () => repositoryMock)

vi.mock('./bookingLock', () => ({ acquireOrRenewBookingLock: vi.fn(async () => 'acquired' as const) }))
vi.mock('./catalog', () => ({ findZone: vi.fn(() => ({ id: 'zone-1', name: 'Zona', capacidadSimultanea: 1 })) }))
vi.mock('../auth/repository', () => ({ findAccountById: vi.fn(async () => null) }))

// Puerta 5B-2A: `undefined` por defecto en cada test (operación normal) —
// solo los tests dedicados a esta subpuerta lo ponen a `true`, nunca al
// revés (mismo principio que el resto de mocks de este archivo:
// `beforeEach` restablece el estado por defecto).
const controlledTestModeMock = vi.hoisted(() => ({ resolveControlledTestGcsExclusion: vi.fn((): true | undefined => undefined) }))
vi.mock('./controlledTestMode', () => controlledTestModeMock)

const { completeBookingToMeeting, IncompatibleMeetingError } = await import('./verificationSteps')
const { evaluateContactAdoption } = await import('./espoAdapter')
import type { EspoBookingAdapter, MeetingLookupResult, CreateMeetingOutcome, ContactMatchResult } from './espoAdapter'

const RECORD = {
  id: 'req-1',
  treatmentId: 'treatment-1',
  professionalId: 'professional-1',
  zoneId: 'zone-1',
  startAt: new Date('2026-09-01T09:00:00.000Z'),
  endAt: new Date('2026-09-01T10:00:00.000Z'),
}

const CONTACT = { firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: '+34600000001' }

const OPTIONS = {
  purgeGuestIdentityAfterLink: true,
  actor: { type: 'guest', guestId: 'req-1' } as const,
  channel: 'email' as const,
}

function baseMeeting(overrides: Partial<{ contactIds: string[]; id: string; cExcluirGoogleCalendarSync: boolean }> = {}) {
  return {
    id: overrides.id ?? 'meeting-1',
    contactIds: overrides.contactIds ?? ['contact-1'],
    bookingRequestId: RECORD.id,
    treatmentId: RECORD.treatmentId,
    professionalId: RECORD.professionalId,
    zoneId: RECORD.zoneId,
    startAt: RECORD.startAt,
    endAt: RECORD.endAt,
    cEstadoReserva: 'PendingCenterApproval' as const,
    status: 'Planned' as const,
    decidedBy: null,
    decidedAt: null,
    note: null,
    resolutionReason: null,
    // Puerta 5B-2A: `false` por defecto — el mismo valor que cualquier
    // Meeting fuera de una ejecución de prueba controlada.
    cExcluirGoogleCalendarSync: overrides.cExcluirGoogleCalendarSync ?? false,
  }
}

function fakeAdapter(overrides: {
  findOrCreateContact?: () => Promise<ContactMatchResult>
  findMeetingByBookingRequestId?: () => Promise<MeetingLookupResult>
  createMeeting?: () => Promise<CreateMeetingOutcome>
}): EspoBookingAdapter {
  return {
    listTreatments: async () => [],
    listZones: async () => [],
    listProfessionals: async () => [],
    getTreatment: async () => null,
    getZone: async () => null,
    getProfessional: async () => null,
    listActiveMeetingsOverlapping: async () => [],
    findMeetingByBookingRequestId: overrides.findMeetingByBookingRequestId ?? (async () => ({ outcome: 'not_found' })),
    getMeetingById: async () => null,
    getContactById: async () => null,
    findOrCreateContact: overrides.findOrCreateContact ?? (async () => ({ outcome: 'matched', contact: { id: 'contact-1', gapssaAccountId: null, ...CONTACT } })),
    createMeeting:
      overrides.createMeeting ??
      (async () => ({
        outcome: 'created',
        meeting: baseMeeting(),
      })),
    decideMeeting: async () => null,
    expireMeeting: async () => null,
    listAllMeetings: async () => [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  repositoryMock.openBookingReviewAtomic.mockResolvedValue({ outcome: 'opened', review: { id: 'review-1' } } as never)
  repositoryMock.writeMeetingIdAndPendingApproval.mockResolvedValue('updated')
  controlledTestModeMock.resolveControlledTestGcsExclusion.mockReturnValue(undefined)
})

describe('completeBookingToMeeting — sanity de evaluateContactAdoption reutilizada', () => {
  it('el propio módulo reexporta la misma decisión pura que espoAdapter.ts', () => {
    expect(evaluateContactAdoption({ contactIds: ['a'], expectedContactId: 'a' })).toEqual({ outcome: 'compatible' })
  })
})

describe('Meeting existente con Contact correcto', () => {
  it('adopta el Meeting y crea la solicitud como pending_approval', async () => {
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({ outcome: 'found', meeting: baseMeeting({ contactIds: ['contact-1'] }) }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'meeting_created', meetingId: 'meeting-1' })
    expect(repositoryMock.openBookingReviewAtomic).not.toHaveBeenCalled()
    expect(repositoryMock.writeMeetingIdAndPendingApproval).toHaveBeenCalledWith('req-1', 'meeting-1', expect.any(Date), OPTIONS.actor, OPTIONS.channel, expect.any(Date))
  })
})

describe('Meeting existente sin ningún Contact', () => {
  it('abre revisión meeting_contact_missing — nunca inventa la relación', async () => {
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({ outcome: 'found', meeting: baseMeeting({ contactIds: [] }) }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'contact_review_pending' })
    expect(repositoryMock.openBookingReviewAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ conflictType: 'meeting_contact_missing', candidateContactIds: null }),
      OPTIONS.actor,
      OPTIONS.channel,
      expect.any(Date),
    )
    expect(repositoryMock.writeMeetingIdAndPendingApproval).not.toHaveBeenCalled()
  })
})

describe('Meeting existente con dos Contacts', () => {
  it('abre revisión meeting_multiple_contacts — nunca elige el primero', async () => {
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({ outcome: 'found', meeting: baseMeeting({ contactIds: ['contact-1', 'contact-9'] }) }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'contact_review_pending' })
    expect(repositoryMock.openBookingReviewAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ conflictType: 'meeting_multiple_contacts', candidateContactIds: ['contact-1', 'contact-9'] }),
      OPTIONS.actor,
      OPTIONS.channel,
      expect.any(Date),
    )
  })
})

describe('Meeting existente con un Contact distinto del esperado', () => {
  it('abre revisión meeting_contact_mismatch con el id real, nunca sobrescribe', async () => {
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({ outcome: 'found', meeting: baseMeeting({ contactIds: ['contact-other'] }) }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'contact_review_pending' })
    expect(repositoryMock.openBookingReviewAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ conflictType: 'meeting_contact_mismatch', candidateContactIds: ['contact-other'] }),
      OPTIONS.actor,
      OPTIONS.channel,
      expect.any(Date),
    )
  })
})

describe('mismo horario y tratamiento pero otra persona (ambigüedad de Contact, nunca llega al Meeting)', () => {
  it('correo/teléfono contradictorios -> revisión contact_conflicting_signals antes de buscar el Meeting', async () => {
    const findMeetingSpy = vi.fn(async () => ({ outcome: 'not_found' }) as MeetingLookupResult)
    const adapter = fakeAdapter({
      findOrCreateContact: async () => ({ outcome: 'manual_review', candidateContactIds: ['contact-1', 'contact-2'], reason: 'conflicting_signals' }),
      findMeetingByBookingRequestId: findMeetingSpy,
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'contact_review_pending' })
    expect(findMeetingSpy).not.toHaveBeenCalled()
    expect(repositoryMock.openBookingReviewAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ conflictType: 'contact_conflicting_signals', candidateContactIds: ['contact-1', 'contact-2'] }),
      OPTIONS.actor,
      OPTIONS.channel,
      expect.any(Date),
    )
  })

  it('varios candidatos por la misma señal -> revisión contact_multiple_matches', async () => {
    const adapter = fakeAdapter({
      findOrCreateContact: async () => ({ outcome: 'manual_review', candidateContactIds: ['contact-1', 'contact-2'], reason: 'multiple_matches' }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'contact_review_pending' })
    expect(repositoryMock.openBookingReviewAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ conflictType: 'contact_multiple_matches' }),
      OPTIONS.actor,
      OPTIONS.channel,
      expect.any(Date),
    )
  })
})

describe('creación tras timeout, seguida de adopción con Contact correcto', () => {
  it('el adaptador resuelve internamente el timeout/reintento y devuelve created — el flujo procede con normalidad', async () => {
    const adapter = fakeAdapter({
      createMeeting: async () => ({ outcome: 'created', meeting: baseMeeting({ id: 'meeting-adopted', contactIds: ['contact-1'] }) }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'meeting_created', meetingId: 'meeting-adopted' })
  })
})

describe('timeout de creación seguido de un estado de Meeting incompatible (duplicado)', () => {
  it('createMeeting detecta una carrera con duplicate -> abre revisión meeting_duplicate, nunca crea un tercer Meeting', async () => {
    const adapter = fakeAdapter({
      createMeeting: async () => ({ outcome: 'duplicate', meetingIds: ['meeting-a', 'meeting-b'] }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'contact_review_pending' })
    expect(repositoryMock.openBookingReviewAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ conflictType: 'meeting_duplicate', candidateMeetingIds: ['meeting-a', 'meeting-b'] }),
      OPTIONS.actor,
      OPTIONS.channel,
      expect.any(Date),
    )
    expect(repositoryMock.writeMeetingIdAndPendingApproval).not.toHaveBeenCalled()
  })
})

describe('lookup inicial ya duplicado', () => {
  it('findMeetingByBookingRequestId=duplicate abre revisión de inmediato, nunca llama a createMeeting', async () => {
    const createMeetingSpy = vi.fn(async () => ({ outcome: 'created', meeting: baseMeeting() }) as CreateMeetingOutcome)
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({ outcome: 'duplicate', meetingIds: ['meeting-a', 'meeting-b'] }),
      createMeeting: createMeetingSpy,
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'contact_review_pending' })
    expect(createMeetingSpy).not.toHaveBeenCalled()
  })
})

describe('Meeting incompatible en horario/tratamiento/profesional/zona', () => {
  it('sigue lanzando IncompatibleMeetingError — incidente operativo distinto de una ambigüedad de Contact', async () => {
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({
        outcome: 'found',
        meeting: baseMeeting({ contactIds: ['contact-1'] }),
      }),
    })
    // Fuerza incompatibilidad: distinto professionalId en el meeting devuelto.
    const incompatibleAdapter: EspoBookingAdapter = {
      ...adapter,
      findMeetingByBookingRequestId: async () => ({
        outcome: 'found',
        meeting: { ...baseMeeting({ contactIds: ['contact-1'] }), professionalId: 'someone-else' },
      }),
    }
    await expect(completeBookingToMeeting(incompatibleAdapter, RECORD, CONTACT, OPTIONS)).rejects.toThrow(IncompatibleMeetingError)
  })
})

describe('reanudación con resolvedContactId (revisión ya resuelta por un operador)', () => {
  it('salta findOrCreateContact por completo y usa el Contact elegido directamente', async () => {
    const findOrCreateContactSpy = vi.fn(async () => ({ outcome: 'matched', contact: { id: 'contact-1', gapssaAccountId: null, ...CONTACT } }) as ContactMatchResult)
    const adapter = fakeAdapter({
      findOrCreateContact: findOrCreateContactSpy,
      findMeetingByBookingRequestId: async () => ({ outcome: 'found', meeting: baseMeeting({ contactIds: ['contact-operator-chosen'] }) }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, { ...OPTIONS, resolvedContactId: 'contact-operator-chosen' })
    expect(result).toEqual({ outcome: 'meeting_created', meetingId: 'meeting-1' })
    expect(findOrCreateContactSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas, no una regla de
// negocio normal.
// ---------------------------------------------------------------------------

describe('Puerta 5B-2A — modo de ensayo controlado ausente (operación normal)', () => {
  it('nunca pasa controlledTestExcludeGcs a createMeeting, y nunca comprueba la exclusión de un Meeting adoptado', async () => {
    controlledTestModeMock.resolveControlledTestGcsExclusion.mockReturnValue(undefined)
    const createMeetingSpy = vi.fn(async () => ({ outcome: 'created', meeting: baseMeeting() }) as CreateMeetingOutcome)
    const adapter = fakeAdapter({ createMeeting: createMeetingSpy })

    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'meeting_created', meetingId: 'meeting-1' })
    expect(createMeetingSpy).toHaveBeenCalledWith(expect.objectContaining({ controlledTestExcludeGcs: undefined }))
  })

  it('adopta un Meeting existente con cExcluirGoogleCalendarSync=true sin abrir ninguna revisión — el campo es irrelevante fuera del modo de prueba', async () => {
    controlledTestModeMock.resolveControlledTestGcsExclusion.mockReturnValue(undefined)
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({
        outcome: 'found',
        meeting: baseMeeting({ contactIds: ['contact-1'], cExcluirGoogleCalendarSync: true }),
      }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'meeting_created', meetingId: 'meeting-1' })
    expect(repositoryMock.openBookingReviewAtomic).not.toHaveBeenCalled()
  })
})

describe('Puerta 5B-2A — modo de ensayo controlado activo (creación)', () => {
  it('pasa controlledTestExcludeGcs=true a adapter.createMeeting — mismo camino para invitado y autenticado (una sola función central)', async () => {
    controlledTestModeMock.resolveControlledTestGcsExclusion.mockReturnValue(true)
    const createMeetingSpy = vi.fn(async () => ({ outcome: 'created', meeting: baseMeeting({ cExcluirGoogleCalendarSync: true }) }) as CreateMeetingOutcome)
    const adapter = fakeAdapter({ createMeeting: createMeetingSpy })

    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'meeting_created', meetingId: 'meeting-1' })
    expect(createMeetingSpy).toHaveBeenCalledWith(expect.objectContaining({ controlledTestExcludeGcs: true }))
  })
})

describe('Puerta 5B-2A — recuperación idempotente tras timeout, adopción de un Meeting con exclusión distinta de la esperada', () => {
  it('nunca adopta un Meeting con cExcluirGoogleCalendarSync=false cuando se esperaba true — abre revisión manual, nunca muta el Meeting ni inventa éxito', async () => {
    controlledTestModeMock.resolveControlledTestGcsExclusion.mockReturnValue(true)
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({
        outcome: 'found',
        meeting: baseMeeting({ contactIds: ['contact-1'], cExcluirGoogleCalendarSync: false }),
      }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'contact_review_pending' })
    expect(repositoryMock.openBookingReviewAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ conflictType: 'meeting_gcs_exclusion_mismatch', candidateContactIds: null, candidateMeetingIds: ['meeting-1'] }),
      OPTIONS.actor,
      OPTIONS.channel,
      expect.any(Date),
    )
    expect(repositoryMock.writeMeetingIdAndPendingApproval).not.toHaveBeenCalled()
  })

  it('adopta sin abrir revisión cuando la exclusión del Meeting encontrado SÍ coincide con la esperada', async () => {
    controlledTestModeMock.resolveControlledTestGcsExclusion.mockReturnValue(true)
    const adapter = fakeAdapter({
      findMeetingByBookingRequestId: async () => ({
        outcome: 'found',
        meeting: baseMeeting({ contactIds: ['contact-1'], cExcluirGoogleCalendarSync: true }),
      }),
    })
    const result = await completeBookingToMeeting(adapter, RECORD, CONTACT, OPTIONS)
    expect(result).toEqual({ outcome: 'meeting_created', meetingId: 'meeting-1' })
    expect(repositoryMock.openBookingReviewAtomic).not.toHaveBeenCalled()
  })
})
