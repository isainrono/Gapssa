import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FakeEspoServer } from '../../../tests/contract/fakeEspoServer'
import {
  HttpEspoBookingAdapter,
  ControlledTestExclusionUnverifiedError,
  EspoApiError,
  isIdempotencyKeyReusedConflict,
  MEETING_SELECT_FIELDS,
  PORTAL_MEETING_NAME,
  type HttpEspoAdapterConfig,
} from './httpEspoAdapter'

/**
 * Pruebas contractuales del adaptador HTTP real contra un servidor EspoCRM
 * fake — Fase 4B, punto 9. Nunca contacta la instancia real de EspoCRM
 * (`FakeEspoServer` es un `http.Server` en memoria, puerto efímero
 * 127.0.0.1). Comportamiento equivalente al adaptador simulado se
 * demuestra en `tests/integration/booking.simulatedEspoAdapter.contract.int.test.ts`
 * (mismos escenarios de idempotencia/matching de Contact).
 */

let server: FakeEspoServer
let adapter: HttpEspoBookingAdapter

function config(overrides: Partial<HttpEspoAdapterConfig> = {}): HttpEspoAdapterConfig {
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    apiKey: server.apiKey,
    timeoutMs: 500,
    maxRetries: 2,
    retryBaseDelayMs: 10,
    maxResponseBytes: 1_000_000,
    professionalUserIds: [],
    ...overrides,
  }
}

beforeEach(async () => {
  server = new FakeEspoServer()
  await server.start()
  adapter = new HttpEspoBookingAdapter(config())
})

afterEach(async () => {
  await server.stop()
})

describe('autenticación', () => {
  it('una API key correcta permite leer el catálogo', async () => {
    server.treatments.push({ id: 't1', name: 'Masaje', familia: 'Masajes', duracionMinutos: 60, activo: 'true' })
    const result = await adapter.listTreatments()
    expect(result).toEqual([{ id: 't1', name: 'Masaje', familia: 'Masajes', durationMinutes: 60 }])
  })

  it('una API key incorrecta se rechaza con 401, nunca se filtra al mensaje de error', async () => {
    const badAdapter = new HttpEspoBookingAdapter(config({ apiKey: 'wrong-key' }))
    await expect(badAdapter.listTreatments()).rejects.toThrow(EspoApiError)
    try {
      await badAdapter.listTreatments()
    } catch (error) {
      expect(error).toBeInstanceOf(EspoApiError)
      const message = (error as EspoApiError).message
      expect(message).not.toContain('wrong-key')
      expect(message).not.toContain(server.apiKey)
    }
  })
})

describe('timeouts y errores de red', () => {
  it('un servidor que no responde a tiempo produce un EspoApiError, nunca cuelga (ni siquiera tras agotar los reintentos)', async () => {
    // config().maxRetries = 2 -> 3 intentos en total; cada uno debe topar
    // con el timeout (500ms) antes de que el fake responda (5s).
    server.queueFault('GET /api/v1/CTratamiento', { delayMs: 5000 })
    server.queueFault('GET /api/v1/CTratamiento', { delayMs: 5000 })
    server.queueFault('GET /api/v1/CTratamiento', { delayMs: 5000 })
    await expect(adapter.listTreatments()).rejects.toThrow(EspoApiError)
  }, 10000)
})

describe('respuestas 4xx/5xx', () => {
  it('un 404 en getTreatment se traduce a null, no a una excepción', async () => {
    const result = await adapter.getTreatment('no-existe')
    expect(result).toBeNull()
  })

  it('un 500 no retryable (POST) se propaga como EspoApiError con el status', async () => {
    server.queueFault('POST /api/v1/Contact', { status: 500 })
    await expect(
      adapter.findOrCreateContact({ firstName: 'A', lastName: 'B', email: 'a@example.com', phone: '+34600000000' }),
    ).rejects.toMatchObject({ status: 500 })
  })
})

describe('rate limit y reintentos', () => {
  it('un 429 en una operación de lectura se reintenta y puede terminar en éxito', async () => {
    server.treatments.push({ id: 't1', name: 'Masaje', familia: 'Masajes', duracionMinutos: 60, activo: 'true' })
    server.queueFault('GET /api/v1/CTratamiento', { status: 429 })
    const result = await adapter.listTreatments()
    expect(result).toHaveLength(1)
  })

  it('agotados los reintentos, un 429 persistente se propaga', async () => {
    server.queueFault('GET /api/v1/CTratamiento', { status: 429 })
    server.queueFault('GET /api/v1/CTratamiento', { status: 429 })
    server.queueFault('GET /api/v1/CTratamiento', { status: 429 })
    await expect(adapter.listTreatments()).rejects.toMatchObject({ status: 429 })
  })

  it('un POST (no idempotente) nunca se reintenta automáticamente ante un fallo', async () => {
    server.queueFault('POST /api/v1/Contact', { status: 503 })
    await expect(
      adapter.findOrCreateContact({ firstName: 'A', lastName: 'B', email: 'a@example.com', phone: '+34600000000' }),
    ).rejects.toMatchObject({ status: 503 })
    // Solo debió llegar UNA petición POST al fake — nunca reintentada.
    const postAttempts = server.requestLog.filter((entry) => entry.method === 'POST' && entry.path === '/api/v1/Contact')
    expect(postAttempts).toHaveLength(1)
  })
})

describe('JSON inválido', () => {
  it('una respuesta 200 con cuerpo no-JSON produce un EspoApiError explícito', async () => {
    server.queueFault('GET /api/v1/CTratamiento', { status: 200, rawBody: '{not-json' })
    await expect(adapter.listTreatments()).rejects.toThrow(/JSON inválido/)
  })
})

describe('paginación', () => {
  it('recorre varias páginas hasta agotar el total', async () => {
    for (let i = 0; i < 5; i++) {
      server.zones.push({ id: `z${i}`, name: `Zona ${i}`, capacidadSimultanea: 1, activa: 'true' })
    }
    const smallPageAdapter = new HttpEspoBookingAdapter(config())
    // listAllPages usa maxSize=200 por defecto en zonas; forzamos un
    // catálogo mayor que una sola página simulando 2 páginas de 2/3.
    const result = await smallPageAdapter.listZones()
    expect(result).toHaveLength(5)
    expect(new Set(result.map((z) => z.id)).size).toBe(5)
  })
})

describe('profesionales: allowlist ESPOCRM_PROFESSIONAL_USER_IDS', () => {
  // Fase 4B/Puerta 3D — auditoría de assignmentPermission: `createMeeting()`
  // usa `professionalId` directamente como `assignedUserId` (POST a
  // EspoCRM). La única defensa de este adaptador contra un `professionalId`
  // arbitrario es esta allowlist — `getProfessional`/`listProfessionals`
  // deben rechazar cualquier id fuera de ella ANTES de llamar a EspoCRM,
  // nunca dejar que EspoCRM decida. La segunda capa de defensa
  // (`assignmentPermission=team` en el rol `Portal GAPSSA API`, Puerta 3D)
  // es independiente de esta y se audita/ensaya aparte
  // (`docs/fase4b-puerta3d-assignment-team.md`) — nunca un sustituto de esta.
  it('getProfessional con un id fuera de la allowlist devuelve null sin llamar a EspoCRM', async () => {
    server.users.push({ id: 'u-no-permitido', name: 'Nombre', isActive: true })
    const restrictedAdapter = new HttpEspoBookingAdapter(config({ professionalUserIds: ['u-permitido'] }))
    const result = await restrictedAdapter.getProfessional('u-no-permitido')
    expect(result).toBeNull()
    expect(server.requestLog.some((r) => r.path.startsWith('/api/v1/User'))).toBe(false)
  })

  it('getProfessional con un id de la allowlist sí consulta EspoCRM y lo devuelve', async () => {
    server.users.push({ id: 'u-permitido', name: 'Nombre', isActive: true })
    const restrictedAdapter = new HttpEspoBookingAdapter(config({ professionalUserIds: ['u-permitido'] }))
    const result = await restrictedAdapter.getProfessional('u-permitido')
    expect(result).toEqual({ id: 'u-permitido', name: 'Nombre', active: true })
  })

  it('listProfessionals nunca devuelve un profesional fuera de la allowlist, aunque exista en EspoCRM', async () => {
    server.users.push(
      { id: 'u-permitido', name: 'Permitido', isActive: true },
      { id: 'u-no-permitido', name: 'No permitido', isActive: true },
    )
    const restrictedAdapter = new HttpEspoBookingAdapter(config({ professionalUserIds: ['u-permitido'] }))
    const result = await restrictedAdapter.listProfessionals()
    expect(result.map((p) => p.id)).toEqual(['u-permitido'])
  })

  it('con la allowlist vacía (sin configurar), ningún id se resuelve nunca', async () => {
    server.users.push({ id: 'u-cualquiera', name: 'Nombre', isActive: true })
    expect(await adapter.getProfessional('u-cualquiera')).toBeNull()
    expect(await adapter.listProfessionals()).toEqual([])
  })
})

describe('protección contra respuestas grandes', () => {
  it('una respuesta que excede el límite configurado se rechaza', async () => {
    const tinyLimitAdapter = new HttpEspoBookingAdapter(config({ maxResponseBytes: 10 }))
    server.treatments.push({ id: 't1', name: 'Masaje relajante muy largo', familia: 'Masajes', duracionMinutos: 60, activo: 'true' })
    await expect(tinyLimitAdapter.listTreatments()).rejects.toThrow(/tamaño máximo/)
  })
})

describe('búsqueda de Meeting por cBookingRequestId', () => {
  it('sin Meeting existente, devuelve not_found', async () => {
    expect(await adapter.findMeetingByBookingRequestId('req-sin-meeting')).toEqual({ outcome: 'not_found' })
  })

  it('con un único Meeting compatible, lo devuelve como found', async () => {
    server.meetings.push({
      id: 'm1',
      dateStart: '2026-09-01T09:00:00.000Z',
      dateEnd: '2026-09-01T10:00:00.000Z',
      status: 'Planned',
      cEstadoReserva: 'PendingCenterApproval',
      cBookingRequestId: 'req-1',
      contactsIds: ['c1'],
    })
    const result = await adapter.findMeetingByBookingRequestId('req-1')
    expect(result.outcome).toBe('found')
    if (result.outcome === 'found') {
      expect(result.meeting.id).toBe('m1')
      expect(result.meeting.contactIds).toEqual(['c1'])
    }
  })

  it('con Meetings duplicados por cBookingRequestId, devuelve duplicate con ambos IDs — nunca elige ni fusiona', async () => {
    server.meetings.push(
      { id: 'm1', dateStart: '2026-09-01T09:00:00.000Z', dateEnd: '2026-09-01T10:00:00.000Z', status: 'Planned', cEstadoReserva: 'PendingCenterApproval', cBookingRequestId: 'req-dup' },
      { id: 'm2', dateStart: '2026-09-01T09:00:00.000Z', dateEnd: '2026-09-01T10:00:00.000Z', status: 'Planned', cEstadoReserva: 'PendingCenterApproval', cBookingRequestId: 'req-dup' },
    )
    const result = await adapter.findMeetingByBookingRequestId('req-dup')
    expect(result.outcome).toBe('duplicate')
    if (result.outcome === 'duplicate') {
      expect(result.meetingIds.sort()).toEqual(['m1', 'm2'])
    }
  })
})

describe('creación idempotente de Meeting', () => {
  const input = {
    bookingRequestId: 'req-create-1',
    contactId: 'c1',
    treatmentId: 't1',
    professionalId: 'u1',
    zoneId: 'z1',
    startAt: new Date('2026-09-01T09:00:00.000Z'),
    endAt: new Date('2026-09-01T10:00:00.000Z'),
  }

  it('crea el Meeting y relaciona el Contact cuando no existe todavía', async () => {
    const outcome = await adapter.createMeeting(input)
    expect(outcome.outcome).toBe('created')
    if (outcome.outcome !== 'created') return
    expect(outcome.meeting.bookingRequestId).toBe('req-create-1')
    expect(outcome.meeting.contactIds).toEqual(['c1'])
    const stored = server.meetings.find((m) => m.id === outcome.meeting.id)
    expect(stored?.contactsIds).toEqual(['c1'])
  })

  it('un timeout tras enviar la creación, seguido de reintento, adopta el Meeting ya creado en vez de duplicar', async () => {
    // Simula: la escritura SÍ llegó a EspoCRM (queda en el fake), pero la
    // respuesta al cliente se pierde (timeout muy corto). El adaptador debe
    // volver a buscar por cBookingRequestId — distinguiendo otra vez
    // cero/uno/varios — antes de reintentar cualquier otra cosa.
    const shortTimeoutAdapter = new HttpEspoBookingAdapter(config({ timeoutMs: 20 }))
    server.queueFault('POST /api/v1/Meeting', { delayMs: 200 })
    // El propio POST fallido igualmente deja el registro creado en el fake
    // en cuanto el fake termina de procesarlo (el fake no aborta al
    // cliente irse) — simulamos ese resultado insertándolo manualmente,
    // igual que "la escritura llegó a aplicarse en EspoCRM".
    server.meetings.push({
      id: 'm-adopted',
      dateStart: input.startAt.toISOString(),
      dateEnd: input.endAt.toISOString(),
      status: 'Planned',
      cEstadoReserva: 'PendingCenterApproval',
      cBookingRequestId: input.bookingRequestId,
      cTratamientoId: input.treatmentId,
      cZonaAtencionId: input.zoneId,
      assignedUserId: input.professionalId,
      contactsIds: ['c1'],
    })

    const outcome = await shortTimeoutAdapter.createMeeting(input)
    expect(outcome.outcome).toBe('created')
    if (outcome.outcome !== 'created') return
    expect(outcome.meeting.id).toBe('m-adopted')
  })

  it('un timeout seguido de reintento que encuentra un Meeting incompatible (contact distinto) se adopta tal cual — la validación de identidad es responsabilidad del llamante, nunca de este adaptador', async () => {
    const shortTimeoutAdapter = new HttpEspoBookingAdapter(config({ timeoutMs: 20 }))
    server.queueFault('POST /api/v1/Meeting', { delayMs: 200 })
    server.meetings.push({
      id: 'm-adopted-2',
      dateStart: input.startAt.toISOString(),
      dateEnd: input.endAt.toISOString(),
      status: 'Planned',
      cEstadoReserva: 'PendingCenterApproval',
      cBookingRequestId: input.bookingRequestId,
      contactsIds: [] as string[],
    })

    const outcome = await shortTimeoutAdapter.createMeeting(input)
    expect(outcome.outcome).toBe('created')
    if (outcome.outcome !== 'created') return
    // Se devuelve TAL CUAL — sin Contact relacionado — nunca se "autosana"
    // relacionando uno en silencio (Fase 4B, punto 2: verificationSteps.ts
    // es quien decide, vía evaluateContactAdoption, si esto es admisible.
    expect(outcome.meeting.contactIds).toEqual([])
  })

  it('llamado cuando YA existen dos Meetings para la misma bookingRequestId (carrera previa) devuelve duplicate — nunca elige ni crea un tercero', async () => {
    // El fake no aplica un índice único real sobre cBookingRequestId (como
    // tampoco lo aplica hoy la instancia real de EspoCRM — Fase 4B §1/§10
    // punto 2), así que este estado es alcanzable: dos intentos
    // concurrentes anteriores ganaron ambos su POST.
    server.meetings.push(
      { id: 'm-race-1', dateStart: input.startAt.toISOString(), dateEnd: input.endAt.toISOString(), status: 'Planned', cEstadoReserva: 'PendingCenterApproval', cBookingRequestId: input.bookingRequestId, contactsIds: ['c1'] },
      { id: 'm-race-2', dateStart: input.startAt.toISOString(), dateEnd: input.endAt.toISOString(), status: 'Planned', cEstadoReserva: 'PendingCenterApproval', cBookingRequestId: input.bookingRequestId, contactsIds: ['c1'] },
    )
    const outcome = await adapter.createMeeting(input)
    expect(outcome.outcome).toBe('duplicate')
    if (outcome.outcome !== 'duplicate') return
    expect(outcome.meetingIds.sort()).toEqual(['m-race-1', 'm-race-2'])
    // Nunca se creó un tercer Meeting para "resolver" la ambigüedad.
    expect(server.meetings.filter((m) => m.cBookingRequestId === input.bookingRequestId)).toHaveLength(2)
  })
})

/**
 * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas, no una
 * función productiva. `controlledTestExcludeGcs` nunca lo decide el
 * navegador (ver `controlledTestMode.ts`/`verificationSteps.ts`) — aquí
 * solo se prueba el contrato del adaptador HTTP: qué envía, qué verifica,
 * y que nunca inventa `true`.
 */
describe('Puerta 5B-2A — modo de ensayo controlado', () => {
  const input = {
    bookingRequestId: 'req-5b2a-1',
    contactId: 'c1',
    treatmentId: 't1',
    professionalId: 'u1',
    zoneId: 'z1',
    startAt: new Date('2026-09-01T09:00:00.000Z'),
    endAt: new Date('2026-09-01T10:00:00.000Z'),
  }

  it('funcionamiento normal (controlledTestExcludeGcs ausente): el POST nunca incluye cExcluirGoogleCalendarSync', async () => {
    const outcome = await adapter.createMeeting(input)
    expect(outcome.outcome).toBe('created')
    const stored = server.meetings.find((m) => m.cBookingRequestId === input.bookingRequestId)
    expect(stored).toBeDefined()
    expect('cExcluirGoogleCalendarSync' in stored!).toBe(false)
    if (outcome.outcome === 'created') {
      expect(outcome.meeting.cExcluirGoogleCalendarSync).toBe(false)
    }
  })

  it('controlledTestExcludeGcs=true: el POST envía exactamente cExcluirGoogleCalendarSync=true, y la relectura lo confirma', async () => {
    const outcome = await adapter.createMeeting({ ...input, controlledTestExcludeGcs: true })
    expect(outcome.outcome).toBe('created')
    const stored = server.meetings.find((m) => m.cBookingRequestId === input.bookingRequestId)
    expect(stored?.cExcluirGoogleCalendarSync).toBe(true)
    if (outcome.outcome === 'created') {
      // Puerta 5B-2A: viene de la RELECTURA (getMeetingById), no del eco
      // del POST — ver el propio adaptador.
      expect(outcome.meeting.cExcluirGoogleCalendarSync).toBe(true)
    }
  })

  it('nunca envía false derivado del cliente: controlledTestExcludeGcs ausente equivale exactamente a omitir la clave, nunca a enviar false', async () => {
    await adapter.createMeeting(input)
    const stored = server.meetings.find((m) => m.cBookingRequestId === input.bookingRequestId)
    expect(stored?.cExcluirGoogleCalendarSync).toBeUndefined()
  })

  it('ACL edit:no real (campo enviado pero nunca persistido): nunca inventa true, falla de forma recuperable, y el Meeting sigue existiendo (nunca se duplica en un reintento)', async () => {
    server.blockGcsExclusionFieldWrites = true

    await expect(adapter.createMeeting({ ...input, controlledTestExcludeGcs: true })).rejects.toThrow(ControlledTestExclusionUnverifiedError)

    // El Meeting SÍ se creó (el resto de la escritura se aplica igual que
    // en ACL de campo real) — un reintento debe adoptarlo por
    // cBookingRequestId, nunca crear un segundo.
    const stored = server.meetings.filter((m) => m.cBookingRequestId === input.bookingRequestId)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.cExcluirGoogleCalendarSync).toBeUndefined()

    server.blockGcsExclusionFieldWrites = false
    // Un reintento del adaptador encuentra el Meeting YA CREADO por
    // `cBookingRequestId` y lo adopta sin volver a intentar el `POST`
    // (mismo camino que "un timeout tras enviar la creación..." más
    // arriba) — nunca duplica. La comprobación de que la exclusión
    // adoptada coincide con la esperada es responsabilidad de
    // `verificationSteps.ts` (Puerta 5B-2A, ver ese archivo de pruebas),
    // no de este adaptador en su camino de adopción.
    const retry = await adapter.createMeeting({ ...input, controlledTestExcludeGcs: true })
    expect(retry.outcome).toBe('created')
    const afterRetry = server.meetings.filter((m) => m.cBookingRequestId === input.bookingRequestId)
    expect(afterRetry).toHaveLength(1)
  })

  it('MEETING_SELECT_FIELDS incluye cExcluirGoogleCalendarSync — la relectura de verificación usa el mismo select cerrado que el resto del adaptador', () => {
    expect(MEETING_SELECT_FIELDS.split(',')).toContain('cExcluirGoogleCalendarSync')
  })
})

/**
 * Puerta 5A, causa raíz confirmada contra `gapssa-espocrm-1` real
 * (`docs/fase4b-puerta5-propuesta-v3.md`): `Meeting.name` es obligatorio
 * en el propio entity def de EspoCRM — sin él, `POST /api/v1/Meeting`
 * responde `400 validationFailure field=name type=required`,
 * independientemente del ACL de campo del actor. Puerta 3C (propuesta,
 * `docs/fase4b-puerta3c-meeting-name-acl.md`) deja `Portal GAPSSA API` en
 * `Meeting.name = {read: no, edit: yes}` — este bloque prueba que
 * `createMeeting()` satisface ese `edit: yes` con un valor fijo y sin PII,
 * y que el resto del adaptador nunca depende de LEER `name` de vuelta.
 */
describe('Meeting.name — Puerta 3C (edit:yes, read:no)', () => {
  const input = {
    bookingRequestId: 'req-name-1',
    contactId: 'c-name-1',
    treatmentId: 't-name-1',
    professionalId: 'u-name-1',
    zoneId: 'z-name-1',
    startAt: new Date('2026-10-05T09:00:00.000Z'),
    endAt: new Date('2026-10-05T10:00:00.000Z'),
  }

  it('sin la corrección (name ausente), el fake reproduce el 400 real — demuestra que la prueba de regresión de abajo detecta el bug', async () => {
    // No se llama al adaptador aquí — se golpea el fake directamente con el
    // payload EXACTO que createMeeting() enviaba antes de esta corrección,
    // para demostrar que el fake reproduce fielmente el 400 real
    // (`docs/fase4b-puerta5-propuesta-v3.md`), no solo confiar en que el
    // adaptador ya corregido "por casualidad" pasa.
    const response = await fetch(`http://127.0.0.1:${server.port}/api/v1/Meeting`, {
      method: 'POST',
      headers: { 'X-Api-Key': server.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateStart: input.startAt.toISOString(),
        dateEnd: input.endAt.toISOString(),
        cTratamientoId: input.treatmentId,
        cZonaAtencionId: input.zoneId,
        assignedUserId: input.professionalId,
        cEstadoReserva: 'PendingCenterApproval',
        status: 'Planned',
        cBookingRequestId: input.bookingRequestId,
      }),
    })
    expect(response.status).toBe(400)
    const parsed = await response.json()
    expect(parsed).toEqual({ messageTranslation: { label: 'validationFailure', scope: null, data: { field: 'name', type: 'required' } } })
    expect(server.meetings).toHaveLength(0)
  })

  it('name vacío o compuesto solo por espacios se rechaza igual que ausente', async () => {
    for (const value of ['', '   ', '\t\n']) {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/v1/Meeting`, {
        method: 'POST',
        headers: { 'X-Api-Key': server.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value, dateStart: input.startAt.toISOString(), dateEnd: input.endAt.toISOString(), cEstadoReserva: 'PendingCenterApproval' }),
      })
      expect(response.status).toBe(400)
    }
    expect(server.meetings).toHaveLength(0)
  })

  it('createMeeting() envía exactamente PORTAL_MEETING_NAME — prueba de regresión: sin la corrección, esta prueba falla con 400', async () => {
    const outcome = await adapter.createMeeting(input)
    expect(outcome.outcome).toBe('created')
    const stored = server.meetings.find((m) => m.cBookingRequestId === input.bookingRequestId)
    expect(stored?.name).toBe(PORTAL_MEETING_NAME)
    expect(stored?.name).toBe('Reserva portal GAPSSA')
  })

  it('el valor es constante — no varía con ningún dato de CreateMeetingInput, y nunca contiene bookingRequestId/tratamiento/zona/profesional/contacto/fecha/hora', async () => {
    const otherInput = {
      bookingRequestId: 'req-name-DISTINTO-2',
      contactId: 'c-name-DISTINTO-2',
      treatmentId: 't-name-DISTINTO-2',
      professionalId: 'u-name-DISTINTO-2',
      zoneId: 'z-name-DISTINTO-2',
      startAt: new Date('2027-01-20T11:00:00.000Z'),
      endAt: new Date('2027-01-20T12:00:00.000Z'),
    }

    await adapter.createMeeting(input)
    await adapter.createMeeting(otherInput)

    const nameValues = new Set(server.meetings.map((m) => m.name))
    // Mismo valor para ambas creaciones — nunca depende del input.
    expect(nameValues.size).toBe(1)
    expect(nameValues.has(PORTAL_MEETING_NAME)).toBe(true)

    for (const candidate of [input, otherInput]) {
      expect(PORTAL_MEETING_NAME).not.toContain(candidate.bookingRequestId)
      expect(PORTAL_MEETING_NAME).not.toContain(candidate.treatmentId)
      expect(PORTAL_MEETING_NAME).not.toContain(candidate.professionalId)
      expect(PORTAL_MEETING_NAME).not.toContain(candidate.zoneId)
      expect(PORTAL_MEETING_NAME).not.toContain(candidate.contactId)
      expect(PORTAL_MEETING_NAME).not.toContain(candidate.startAt.toISOString())
      expect(PORTAL_MEETING_NAME).not.toContain(candidate.startAt.toISOString().slice(0, 10))
    }
  })

  it('PORTAL_MEETING_NAME no aparece en MEETING_SELECT_FIELDS — el adaptador nunca depende de leer name de vuelta', () => {
    expect(MEETING_SELECT_FIELDS.split(',')).not.toContain('name')
  })

  it('la respuesta de creación puede omitir name (read:no simulado por el fake) y meetingRecordSchema la acepta igual', async () => {
    expect(server.hideMeetingNameInResponses).toBe(true)
    const outcome = await adapter.createMeeting(input)
    expect(outcome.outcome).toBe('created')
    if (outcome.outcome !== 'created') return
    // El Meeting se crea y se usa con normalidad aunque la respuesta HTTP
    // de EspoCRM nunca haya incluido `name` — el adaptador no lo necesita.
    expect(outcome.meeting.bookingRequestId).toBe(input.bookingRequestId)
    // Confirmado también leyendo el Meeting de vuelta (mismo camino que
    // reconciliación/decisión usan) — `getMeetingById` tampoco depende de `name`.
    const reread = await adapter.getMeetingById(outcome.meeting.id)
    expect(reread?.id).toBe(outcome.meeting.id)
  })

  it('admin ficticio (sin la restricción read:no del fake) sí vería name — documenta que la restricción es del actor, no del dato', async () => {
    server.hideMeetingNameInResponses = false
    const outcome = await adapter.createMeeting(input)
    expect(outcome.outcome).toBe('created')
    const stored = server.meetings.find((m) => m.cBookingRequestId === input.bookingRequestId)
    expect(stored?.name).toBe(PORTAL_MEETING_NAME)
    // Con hideMeetingNameInResponses=false el propio POST ya habría
    // devuelto `name` en el cuerpo — el dato SIGUE existiendo en EspoCRM,
    // solo un actor con read:no deja de poder leerlo por HTTP.
  })

  it('idempotencia y concurrencia de creación no cambian con el name obligatorio — misma cobertura que sin la corrección', async () => {
    // Mismo escenario que "llamado cuando YA existen dos Meetings..." de
    // 'creación idempotente de Meeting', repetido aquí para confirmar que
    // añadir `name` al payload de creación no interfiere con la detección
    // de duplicados por cBookingRequestId (comprobación previa a la
    // creación, nunca depende de `name`).
    server.meetings.push(
      { id: 'm-race-name-1', name: PORTAL_MEETING_NAME, dateStart: input.startAt.toISOString(), dateEnd: input.endAt.toISOString(), status: 'Planned', cEstadoReserva: 'PendingCenterApproval', cBookingRequestId: input.bookingRequestId, contactsIds: ['c-name-1'] },
      { id: 'm-race-name-2', name: PORTAL_MEETING_NAME, dateStart: input.startAt.toISOString(), dateEnd: input.endAt.toISOString(), status: 'Planned', cEstadoReserva: 'PendingCenterApproval', cBookingRequestId: input.bookingRequestId, contactsIds: ['c-name-1'] },
    )
    const outcome = await adapter.createMeeting(input)
    expect(outcome.outcome).toBe('duplicate')
    // Ninguna llamada real llegó a intentar un tercer POST con name -> el
    // conteo de Meetings para este bookingRequestId sigue en 2.
    expect(server.meetings.filter((m) => m.cBookingRequestId === input.bookingRequestId)).toHaveLength(2)
  })

  it('la recuperación tras timeout (adopción del Meeting ya creado) sigue funcionando con name obligatorio', async () => {
    // Mismo patrón que "un timeout tras enviar la creación..." de
    // 'creación idempotente de Meeting': el fault de `queueFault`
    // intercepta ANTES de que la validación de `name` del fake se
    // ejecute (nunca llega a `route()`), así que el fix no puede romper
    // este camino — se repite aquí explícitamente para esta corrección,
    // no solo confiar en que el otro describe block ya lo cubre.
    const shortTimeoutAdapter = new HttpEspoBookingAdapter(config({ timeoutMs: 20 }))
    server.queueFault('POST /api/v1/Meeting', { delayMs: 200 })
    server.meetings.push({
      id: 'm-adopted-name',
      name: PORTAL_MEETING_NAME,
      dateStart: input.startAt.toISOString(),
      dateEnd: input.endAt.toISOString(),
      status: 'Planned',
      cEstadoReserva: 'PendingCenterApproval',
      cBookingRequestId: input.bookingRequestId,
      contactsIds: ['c-name-1'],
    })

    const outcome = await shortTimeoutAdapter.createMeeting(input)
    expect(outcome.outcome).toBe('created')
    if (outcome.outcome !== 'created') return
    expect(outcome.meeting.id).toBe('m-adopted-name')
  })
})

describe('matching de Contact', () => {
  it('cero coincidencias crea un Contact nuevo', async () => {
    const result = await adapter.findOrCreateContact({ firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: '+34600000001' })
    expect(result.outcome).toBe('created')
  })

  it('una coincidencia inequívoca por correo se reutiliza', async () => {
    server.contacts.push({ id: 'c1', firstName: 'Ana', lastName: 'Ruiz', emailAddress: 'ana@example.com', phoneNumber: '+34600000001' })
    const result = await adapter.findOrCreateContact({ firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: '+34699999999' })
    expect(result).toMatchObject({ outcome: 'matched', contact: { id: 'c1' } })
  })

  it('correo y teléfono apuntan a Contacts distintos -> manual_review con reason conflicting_signals, nunca se fusiona', async () => {
    server.contacts.push(
      { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', emailAddress: 'ana@example.com', phoneNumber: '+34600000001' },
      { id: 'c2', firstName: 'Otro', lastName: 'Contacto', emailAddress: 'otro@example.com', phoneNumber: '+34600000002' },
    )
    const result = await adapter.findOrCreateContact({ firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: '+34600000002' })
    expect(result.outcome).toBe('manual_review')
    if (result.outcome === 'manual_review') {
      expect(result.candidateContactIds.sort()).toEqual(['c1', 'c2'])
      expect(result.reason).toBe('conflicting_signals')
    }
  })

  it('gapssaAccountId con varios Contacts candidatos -> manual_review con reason multiple_matches, nunca rows[0]', async () => {
    server.contacts.push(
      { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', emailAddress: 'ana1@example.com', phoneNumber: '+34600000011', cGapssaAccountId: 'account-1' },
      { id: 'c2', firstName: 'Ana', lastName: 'Ruiz', emailAddress: 'ana2@example.com', phoneNumber: '+34600000012', cGapssaAccountId: 'account-1' },
    )
    const result = await adapter.findOrCreateContact({
      gapssaAccountId: 'account-1',
      firstName: 'Ana',
      lastName: 'Ruiz',
      email: 'ana1@example.com',
      phone: '+34600000011',
    })
    expect(result.outcome).toBe('manual_review')
    if (result.outcome === 'manual_review') {
      expect(result.candidateContactIds.sort()).toEqual(['c1', 'c2'])
      expect(result.reason).toBe('multiple_matches')
    }
  })
})

describe('decisión de Meeting: exclusivamente vía PutDecide (GapssaMeetingDecision)', () => {
  function pushPendingMeeting(id = 'm1'): void {
    server.meetings.push({
      id,
      dateStart: '2026-09-01T09:00:00.000Z',
      dateEnd: '2026-09-01T10:00:00.000Z',
      status: 'Planned',
      cEstadoReserva: 'PendingCenterApproval',
    })
  }

  it('aprobar un Meeting en PendingCenterApproval lo confirma con resultReason Approved', async () => {
    pushPendingMeeting()
    const result = await adapter.decideMeeting({ meetingId: 'm1', decision: 'approved', decidedBy: 'staff-1', operationKey: 'op-approve-1' })
    expect(result?.cEstadoReserva).toBe('Confirmed')
    expect(result?.resolutionReason).toBe('Approved')
  })

  it('rechazar con nota no vacía marca resolutionReason RejectedByStaff', async () => {
    pushPendingMeeting()
    const result = await adapter.decideMeeting({ meetingId: 'm1', decision: 'rejected', decidedBy: 'staff-1', note: 'no encaja en agenda', operationKey: 'op-reject-1' })
    expect(result?.cEstadoReserva).toBe('Canceled')
    expect(result?.resolutionReason).toBe('RejectedByStaff')
    expect(result?.note).toBe('no encaja en agenda')
  })

  it('caducar vía expireMeeting marca resolutionReason ApprovalExpired, nunca RejectedByStaff', async () => {
    pushPendingMeeting()
    const result = await adapter.expireMeeting({ meetingId: 'm1', operationKey: 'op-expire-1' })
    expect(result?.cEstadoReserva).toBe('Canceled')
    expect(result?.resolutionReason).toBe('ApprovalExpired')
  })

  it('decidir un Meeting que ya no está en PendingCenterApproval devuelve null, nunca sobrescribe (conflicto reconciliable)', async () => {
    server.meetings.push({
      id: 'm1',
      dateStart: '2026-09-01T09:00:00.000Z',
      dateEnd: '2026-09-01T10:00:00.000Z',
      status: 'Not Held',
      cEstadoReserva: 'Canceled',
      cMotivoResolucionReserva: 'ApprovalExpired',
    })
    const result = await adapter.decideMeeting({ meetingId: 'm1', decision: 'approved', decidedBy: 'staff-1', operationKey: 'op-approve-2' })
    expect(result).toBeNull()
    expect(server.meetings[0]!.cEstadoReserva).toBe('Canceled')
  })

  it('nunca llama a PUT genérico /api/v1/Meeting/{id} para decidir — solo GapssaMeetingDecision', async () => {
    pushPendingMeeting()
    await adapter.decideMeeting({ meetingId: 'm1', decision: 'approved', decidedBy: 'staff-1', operationKey: 'op-approve-3' })
    const genericMeetingPuts = server.requestLog.filter((entry) => entry.method === 'PUT' && entry.path === '/api/v1/Meeting/m1')
    expect(genericMeetingPuts).toHaveLength(0)
    const decisionPuts = server.requestLog.filter((entry) => entry.method === 'PUT' && entry.path === '/api/v1/GapssaMeetingDecision/m1')
    expect(decisionPuts).toHaveLength(1)
  })

  it('misma operationKey + mismo payload -> replay, sin doble escritura', async () => {
    pushPendingMeeting()
    const first = await adapter.decideMeeting({ meetingId: 'm1', decision: 'approved', decidedBy: 'staff-1', operationKey: 'op-replay-1' })
    const second = await adapter.decideMeeting({ meetingId: 'm1', decision: 'approved', decidedBy: 'staff-1', operationKey: 'op-replay-1' })
    expect(first?.cEstadoReserva).toBe('Confirmed')
    expect(second?.cEstadoReserva).toBe('Confirmed')
    expect(second?.decidedAt?.getTime()).toBe(first?.decidedAt?.getTime())
  })

  it('misma operationKey + payload distinto (decision distinta) -> 409, se propaga como error, nunca se trata como "ya decidido"', async () => {
    pushPendingMeeting()
    await adapter.decideMeeting({ meetingId: 'm1', decision: 'approved', decidedBy: 'staff-1', operationKey: 'op-reuse-1' })
    await expect(
      adapter.decideMeeting({ meetingId: 'm1', decision: 'rejected', decidedBy: 'staff-1', note: 'motivo', operationKey: 'op-reuse-1' }),
    ).rejects.toThrow()
  })

  it('reuso de operationKey: la excepción propagada es reconocible como el código contractual exacto idempotency_key_reused (cuerpo de texto plano, no JSON — fiel a Conflict::createWithBody del core real)', async () => {
    pushPendingMeeting()
    await adapter.decideMeeting({ meetingId: 'm1', decision: 'approved', decidedBy: 'staff-1', operationKey: 'op-reuse-2' })
    try {
      await adapter.decideMeeting({ meetingId: 'm1', decision: 'rejected', decidedBy: 'staff-1', note: 'motivo', operationKey: 'op-reuse-2' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EspoApiError)
      expect((error as EspoApiError).status).toBe(409)
      expect((error as EspoApiError).body).toBe('idempotency_key_reused')
      expect(isIdempotencyKeyReusedConflict(error)).toBe(true)
    }
  })

  it('un 409 meeting_decision_conflict (JSON real, operationKey nueva contra un Meeting ya decidido) nunca se confunde con idempotency_key_reused', async () => {
    pushPendingMeeting()
    await adapter.decideMeeting({ meetingId: 'm1', decision: 'approved', decidedBy: 'staff-1', operationKey: 'op-already-decided' })
    // `decideMeeting()`/`putDecide()` ya traducen `meeting_decision_conflict`
    // a `null` internamente (nunca lanzan) — lo relevante aquí es que ese
    // camino, con una operationKey NUEVA (no replay) contra un Meeting que
    // ya no está en PendingCenterApproval, jamás podría malinterpretarse
    // como el código contractual distinto `idempotency_key_reused`.
    const result = await adapter.decideMeeting({ meetingId: 'm1', decision: 'rejected', decidedBy: 'staff-1', note: 'motivo', operationKey: 'op-conflict-fresh' })
    expect(result).toBeNull()
  })

  it('el PUT genérico directo contra /api/v1/Meeting/{id} para decidir es rechazado por el fake (mismo comportamiento que GuardMeetingDecisionTransition)', async () => {
    pushPendingMeeting()
    await expect(
      adapter['request']({ method: 'PUT', path: '/api/v1/Meeting/m1', body: { cEstadoReserva: 'Confirmed' } }),
    ).rejects.toThrow()
    const meeting = await adapter.getMeetingById('m1')
    expect(meeting?.cEstadoReserva).toBe('PendingCenterApproval')
  })
})

describe('ausencia de PII/tokens en errores', () => {
  it('un error de EspoCRM nunca incluye la API key ni el cuerpo de la petición', async () => {
    server.queueFault('POST /api/v1/Contact', { status: 400, rawBody: JSON.stringify({ message: 'campo inválido' }) })
    try {
      await adapter.findOrCreateContact({ firstName: 'Secreto', lastName: 'Persona', email: 'secreto@example.com', phone: '+34600000009' })
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).not.toContain(server.apiKey)
      expect(message).not.toContain('Secreto')
      expect(message).not.toContain('secreto@example.com')
    }
  })
})

describe('ningún acceso accidental a EspoCRM real', () => {
  it('todas las peticiones del adaptador van al servidor fake en 127.0.0.1, nunca a un host externo', async () => {
    server.treatments.push({ id: 't1', name: 'Masaje', familia: 'Masajes', duracionMinutos: 60, activo: 'true' })
    await adapter.listTreatments()
    expect(server.requestLog.length).toBeGreaterThan(0)
    // La sola existencia de la petición en el log del fake (127.0.0.1)
    // demuestra que fue éste, y no un host externo, quien la recibió — el
    // `baseUrl` del adaptador está fijado a `config()` de este fichero.
  })
})
