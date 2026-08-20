import 'server-only'
import { and, eq, gt, inArray, lt, notInArray } from 'drizzle-orm'

import {
  ESTADO_RESERVA_A_MEETING_STATUS,
  isMeetingResolutionReasonCompatible,
  type EstadoMeetingNativo,
  type EstadoReserva,
  type MeetingResolutionReason,
} from '@gapssa/contracts'

import {
  findProfessional,
  findTreatment,
  findZone,
  listActiveProfessionals,
  TREATMENT_FIXTURES,
  ZONE_FIXTURES,
  type ProfessionalFixture,
  type TreatmentFixture,
  type ZoneFixture,
} from './catalog'
import { isUniqueViolation } from '../auth/dbErrors'
import { bookingDb, type BookingDbClient } from './db/client'
import { simEspoContacts, simEspoMeetingContacts, simEspoMeetings } from './db/schema'

/**
 * Interfaz sustituible del adaptador de reservas contra EspoCRM
 * (`docs/contratos-portal-v1.md` §6, `docs/fase3-autenticacion.md` §6 —
 * mismo patrón que `EspoLinkAdapter` de Fase 3). El resto del código
 * (`server/booking/guestFlow.ts`, `authenticatedFlow.ts`,
 * `reconciliation.ts`) SOLO conoce esta interfaz — pasar de
 * `SimulatedEspoBookingAdapter` a llamadas HTTP reales contra la instancia
 * de EspoCRM (Fase 4+, requiere autorización explícita:
 * `docs/fase3-autenticacion.md` §6.1) es sustituir la implementación, sin
 * tocar ningún llamante. Todos los métodos devuelven `Promise` incluso en
 * la implementación simulada (sin I/O real) para que la firma no cambie
 * cuando un adaptador real añada latencia de red de verdad.
 */

export interface SimContact {
  id: string
  gapssaAccountId: string | null
  firstName: string
  lastName: string
  email: string
  phone: string
}

export interface SimMeeting {
  id: string
  /**
   * Revisión 2 de Fase 4B, punto 2: lista completa de Contacts
   * relacionados — nunca un `contactId` singular derivado con `[0]`.
   * `Meeting.contacts` es `linkMultiple` en EspoCRM real (0, 1 o varios);
   * el adaptador simulado ahora refleja la misma multiplicidad
   * (`sim_espo_meeting_contacts`). Un Meeting recién creado por este mismo
   * flujo siempre tiene exactamente un elemento; leer un Meeting
   * preexistente (adopción por `cBookingRequestId`, o ajeno al portal)
   * puede encontrar 0 o varios — ver `evaluateContactAdoption`.
   */
  contactIds: string[]
  bookingRequestId: string
  treatmentId: string
  professionalId: string
  zoneId: string
  startAt: Date
  endAt: Date
  cEstadoReserva: EstadoReserva
  status: EstadoMeetingNativo
  decidedBy: string | null
  decidedAt: Date | null
  note: string | null
  /**
   * "Fase 4B — flujo de decisión final", hueco 3: representación durable y
   * cerrada del motivo de resolución (`Meeting.cMotivoResolucionReserva`
   * en EspoCRM real — campo NUEVO, no creado todavía). NUNCA se infiere de
   * `decidedBy`; `deriveResolutionFromDecidedMeeting` (`decisionRecovery.ts`)
   * la lee directamente. `null` para cualquier Meeting que no haya pasado
   * por una decisión (incluye estados fuera del flujo de reservas).
   */
  resolutionReason: MeetingResolutionReason | null
  /**
   * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas, no un
   * atributo de negocio normal. Espejo de lectura de
   * `Meeting.cExcluirGoogleCalendarSync` (Puerta 6,
   * `docs/fase4b-puerta6-exclusion-gcs.md`) — `false` en cualquier Meeting
   * fuera de una ejecución de prueba de esta subpuerta.
   * `SimulatedEspoBookingAdapter` siempre lo reporta `false` (nunca simula
   * una exclusión real de GCS, que no le concierne — ver
   * `SimulatedEspoBookingAdapter.createMeeting`).
   */
  cExcluirGoogleCalendarSync: boolean
}

export interface FindOrCreateContactInput {
  gapssaAccountId?: string | null
  firstName: string
  lastName: string
  email: string
  phone: string
}

/**
 * Resultado del matching de Contact (Fase 4B, `docs/fase4b-...`). `matched`/
 * `created` traen un único Contact utilizable de inmediato. `manual_review`
 * significa varias coincidencias o señales contradictorias — nunca se
 * fusiona ni se elige arbitrariamente entre ellas (política de
 * `PROJECT_CONTEXT.md` §7.1); el llamante debe transicionar el
 * `BookingRequestRecord` a `"contact_review_pending"` en vez de crear el
 * Meeting. `candidateContactIds` es solo para trazabilidad interna — nunca
 * se expone al cliente ni se copia a auditoría (ver `audit.ts`,
 * `reasonCode: "ContactAmbiguous"`).
 */
export type ContactMatchResult =
  | { outcome: 'matched' | 'created'; contact: SimContact }
  | {
      outcome: 'manual_review'
      candidateContactIds: string[]
      /**
       * Revisión 2 de Fase 4B, punto 3: distingue el `BookingReviewConflictType`
       * exacto (`packages/contracts/src/booking.ts`) sin que el llamante
       * tenga que volver a inspeccionar `candidateContactIds` — "varios
       * candidatos por una misma señal" (p. ej. `gapssaAccountId` o correo
       * repetidos) y "correo y teléfono apuntan a Contacts distintos" son
       * conflictos de naturaleza distinta aunque ambos terminen en
       * `manual_review`.
       */
      reason: 'multiple_matches' | 'conflicting_signals'
    }

export interface CreateMeetingInput {
  bookingRequestId: string
  /** Contact único con el que se crea el Meeting — siempre exactamente uno en la creación (nunca ambiguo: ya se resolvió antes de llamar). */
  contactId: string
  treatmentId: string
  professionalId: string
  zoneId: string
  startAt: Date
  endAt: Date
  /**
   * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas, NUNCA una
   * función productiva. Decidido EXCLUSIVAMENTE por
   * `resolveControlledTestGcsExclusion()`
   * (`server/booking/controlledTestMode.ts`) a partir de `serverEnv` —
   * jamás derivado de un valor enviado por el navegador ni de ningún dato
   * persistido controlable por el cliente. `undefined` en operación
   * normal (el caso de todos los entornos reales hoy). Cuando es `true`,
   * `HttpEspoBookingAdapter` envía exactamente `true` y verifica por
   * relectura que se persistió — nunca envía `false` derivado de esto.
   * `SimulatedEspoBookingAdapter` no puede honrarlo (lanza) — ver esa
   * clase.
   */
  controlledTestExcludeGcs?: true
}

/**
 * Revisión 2 de Fase 4B, punto 1: resultado explícito de buscar un Meeting
 * por `cBookingRequestId` — NUNCA `rows[0]` cuando hay más de una fila.
 * `duplicate` es, en sí mismo, un estado de datos inconsistente (dos
 * Meetings comparten el mismo `bookingRequestId`, algo que no debería
 * poder ocurrir si el índice único recomendado en
 * `docs/fase4b-integracion-http.md` §10 punto 2 llega a aplicarse) — el
 * llamante debe transicionar la solicitud a revisión manual, nunca elegir
 * ni fusionar.
 */
export type MeetingLookupResult =
  | { outcome: 'not_found' }
  | { outcome: 'found'; meeting: SimMeeting }
  | { outcome: 'duplicate'; meetingIds: string[] }

/**
 * Resultado de `createMeeting` — distingue "se creó/adoptó un único
 * Meeting utilizable" de "una carrera concurrente produjo más de un
 * Meeting para el mismo bookingRequestId" (revisión 2 de Fase 4B, punto
 * 1). En el caso `duplicate`, `createMeeting` NUNCA crea un tercer
 * Meeting ni elige entre los existentes — el llamante debe transicionar a
 * revisión manual.
 */
export type CreateMeetingOutcome =
  | { outcome: 'created'; meeting: SimMeeting }
  | { outcome: 'duplicate'; meetingIds: string[] }

/**
 * Revisión 2 de Fase 4B, punto 2: decisión pura y comprobable de si un
 * Meeting YA EXISTENTE (encontrado por `cBookingRequestId`) puede
 * adoptarse para una solicitud con un `expectedContactId` concreto —
 * compartida por `verificationSteps.ts` (llamante único hoy) y por
 * cualquier adaptador que necesite la misma política. Nunca indexa
 * `contactIds[0]` — solo compara longitud e igualdad exacta.
 */
export type ContactAdoptionOutcome =
  | { outcome: 'compatible' }
  | { outcome: 'missing' }
  | { outcome: 'multiple' }
  | { outcome: 'mismatch'; actualContactId: string }

export function evaluateContactAdoption(input: { contactIds: string[]; expectedContactId: string }): ContactAdoptionOutcome {
  if (input.contactIds.length === 0) {
    return { outcome: 'missing' }
  }
  if (input.contactIds.length > 1) {
    return { outcome: 'multiple' }
  }
  const [actualContactId] = input.contactIds
  if (actualContactId === input.expectedContactId) {
    return { outcome: 'compatible' }
  }
  return { outcome: 'mismatch', actualContactId: actualContactId! }
}

export interface ListOccupiedMeetingsInput {
  professionalId?: string
  zoneId?: string
  from: Date
  to: Date
}

/** Estados que NO ocupan el horario (la cita ya no cuenta contra la capacidad ni la exclusividad del profesional). */
const NON_OCCUPYING_ESTADOS_RESERVA: EstadoReserva[] = ['Canceled', 'NoShow']

export interface EspoBookingAdapter {
  listTreatments(): Promise<TreatmentFixture[]>
  listZones(): Promise<ZoneFixture[]>
  listProfessionals(): Promise<ProfessionalFixture[]>
  getTreatment(id: string): Promise<TreatmentFixture | null>
  getZone(id: string): Promise<ZoneFixture | null>
  getProfessional(id: string): Promise<ProfessionalFixture | null>
  /** Citas activas (no Canceled/NoShow) que solapan [from, to) para el profesional y/o la zona indicados — base de la comprobación de disponibilidad. */
  listActiveMeetingsOverlapping(input: ListOccupiedMeetingsInput): Promise<SimMeeting[]>
  /** Nunca devuelve `rows[0]` cuando hay más de un Meeting con el mismo bookingRequestId — ver `MeetingLookupResult`. */
  findMeetingByBookingRequestId(bookingRequestId: string): Promise<MeetingLookupResult>
  /** Estado actual y decisión (cEstadoReserva/decidedBy/decidedAt/note) de un Meeting por su id — revisión 2 de Fase 4A, punto 5: permite reconciliar cuándo `decideMeeting`/`expireMeeting` no ganan su CAS porque el Meeting ya fue decidido por otra vía. */
  getMeetingById(meetingId: string): Promise<SimMeeting | null>
  /**
   * Idempotente: primero por gapssaAccountId, luego por email, luego por
   * phone. Cero coincidencias -> crea (`created`). Una coincidencia
   * inequívoca -> la reutiliza (`matched`). Varias coincidencias o señales
   * contradictorias -> `manual_review`, nunca fusiona ni elige
   * arbitrariamente.
   */
  findOrCreateContact(input: FindOrCreateContactInput): Promise<ContactMatchResult>
  /**
   * Revisión 3 de Fase 4B, punto 4: consulta directa de un Contact real por
   * id — único mecanismo que `review.ts::resolveBookingReview` usa para
   * validar `resolutionContactId` antes de reanudar. Null si no existe.
   * Nunca se acepta un id que no se haya confirmado existente mediante esta
   * llamada.
   */
  getContactById(contactId: string): Promise<SimContact | null>
  /**
   * Idempotente por bookingRequestId — un reintento con el mismo
   * bookingRequestId adopta el Meeting ya creado, nunca duplica. Una
   * carrera que sí produce dos Meetings para el mismo bookingRequestId
   * devuelve `duplicate`, nunca elige un ganador arbitrario — ver
   * `CreateMeetingOutcome`.
   */
  createMeeting(input: CreateMeetingInput): Promise<CreateMeetingOutcome>
  /**
   * "Fase 4B — flujo de decisión final". Decisión HUMANA (aprobar/rechazar)
   * — nunca caducidad de sistema (ver `expireMeeting`). `resultReason` se
   * deriva 1:1 de `decision` (`approved` -> `Approved`,
   * `rejected` -> `RejectedByStaff`) y se escribe en
   * `cMotivoResolucionReserva` en la MISMA operación que `cEstadoReserva` —
   * nunca en dos pasos. `note` es OBLIGATORIA y no vacía/no-solo-espacios
   * cuando `decision === 'rejected'` (a nivel de tipo: no opcional en esa
   * rama) — el rechazo debe conservar un motivo operativo real.
   * `operationKey`: clave de idempotencia DURABLE — nunca una UUID nueva
   * por reintento; el llamante (`decisionRecovery.ts`) es responsable de
   * reutilizar la misma clave persistida (`ensureDecisionOperationKey`,
   * `repository.ts`) en cualquier reintento de la MISMA decisión lógica.
   * `null` si el CAS/lock no gana (ya decidido por otra vía) — el llamante
   * reconcilia contra `getMeetingById`, nunca asume.
   */
  decideMeeting(
    input:
      | { meetingId: string; decision: 'approved'; decidedBy: string; note?: string; operationKey: string }
      | { meetingId: string; decision: 'rejected'; decidedBy: string; note: string; operationKey: string },
  ): Promise<SimMeeting | null>
  /**
   * Caducidad de SISTEMA (barrido de conciliación) — siempre
   * `resultReason: 'ApprovalExpired'`, nunca lleva nota humana (la nota
   * técnica fija es opcional y la decide el propio adaptador, nunca el
   * llamante). `operationKey` DEBE ser determinista y versionada, derivada
   * del `bookingRequestId` (`buildApprovalExpiryOperationKey`,
   * `@gapssa/contracts`) — nunca una UUID nueva por pasada del barrido, para
   * que dos pasadas sobre la MISMA solicitud vencida converjan en la MISMA
   * operación idempotente.
   */
  expireMeeting(input: { meetingId: string; operationKey: string }): Promise<SimMeeting | null>
  /** Todas las citas — usado únicamente por el barrido de conciliación para detectar `cEstadoReserva`/`status` inconsistentes (estado-reserva.ts, ESTADO_RESERVA_A_MEETING_STATUS). Volumen de este negocio: seguro sin paginar. */
  listAllMeetings(): Promise<SimMeeting[]>
}

function toSimMeeting(row: typeof simEspoMeetings.$inferSelect, contactIds: string[]): SimMeeting {
  return {
    id: row.id,
    contactIds,
    bookingRequestId: row.bookingRequestId,
    treatmentId: row.treatmentId,
    professionalId: row.professionalId,
    zoneId: row.zoneId,
    startAt: row.startAt,
    endAt: row.endAt,
    cEstadoReserva: row.cEstadoReserva,
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    note: row.note,
    resolutionReason: row.resolutionReason,
    // Puerta 5B-2A: el adaptador simulado nunca sincroniza con GCS —
    // siempre `false`, nunca inferido de ningún campo de `sim_espo_meetings`
    // (que no lo modela; ver `SimMeeting.cExcluirGoogleCalendarSync`).
    cExcluirGoogleCalendarSync: false,
  }
}

function toSimContact(row: typeof simEspoContacts.$inferSelect): SimContact {
  return {
    id: row.id,
    gapssaAccountId: row.gapssaAccountId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
  }
}

/**
 * Implementación SIMULADA — backend real en `gapssa_booking`
 * (`sim_espo_contacts`/`sim_espo_meetings`, ver comentario de cabecera de
 * `db/schema.ts`), nunca la instancia real de EspoCRM. `db` es
 * inyectable (por defecto `bookingDb`) para que los llamantes que ya
 * tienen una transacción abierta (p. ej. `createMeeting` dentro del paso 6
 * del flujo de verificación) puedan pasarla y que la creación del Meeting
 * se confirme/revierta junto con el resto de esa transacción.
 */
export class SimulatedEspoBookingAdapter implements EspoBookingAdapter {
  constructor(private readonly db: BookingDbClient = bookingDb) {}

  async listTreatments(): Promise<TreatmentFixture[]> {
    return [...TREATMENT_FIXTURES]
  }

  async listZones(): Promise<ZoneFixture[]> {
    return [...ZONE_FIXTURES]
  }

  async listProfessionals(): Promise<ProfessionalFixture[]> {
    return listActiveProfessionals()
  }

  async getTreatment(id: string): Promise<TreatmentFixture | null> {
    return findTreatment(id)
  }

  async getZone(id: string): Promise<ZoneFixture | null> {
    return findZone(id)
  }

  async getProfessional(id: string): Promise<ProfessionalFixture | null> {
    return findProfessional(id)
  }

  /** Contacts relacionados de UN Meeting — usado allí donde ya se sabe que hay como mucho una fila de por medio (getMeetingById, decideMeeting/expireMeeting, adopción por bookingRequestId). */
  private async contactIdsForMeeting(meetingId: string): Promise<string[]> {
    const rows = await this.db.select({ contactId: simEspoMeetingContacts.contactId }).from(simEspoMeetingContacts).where(eq(simEspoMeetingContacts.meetingId, meetingId))
    return rows.map((row) => row.contactId)
  }

  /** Igual que `contactIdsForMeeting`, pero en lote — evita N+1 consultas al listar varios Meetings a la vez (listActiveMeetingsOverlapping/listAllMeetings). */
  private async contactIdsByMeeting(meetingIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>(meetingIds.map((id) => [id, []]))
    if (meetingIds.length === 0) {
      return map
    }
    const rows = await this.db
      .select({ meetingId: simEspoMeetingContacts.meetingId, contactId: simEspoMeetingContacts.contactId })
      .from(simEspoMeetingContacts)
      .where(inArray(simEspoMeetingContacts.meetingId, meetingIds))
    for (const row of rows) {
      map.get(row.meetingId)?.push(row.contactId)
    }
    return map
  }

  async listActiveMeetingsOverlapping(input: ListOccupiedMeetingsInput): Promise<SimMeeting[]> {
    const conditions = [
      notInArray(simEspoMeetings.cEstadoReserva, NON_OCCUPYING_ESTADOS_RESERVA),
      // Solape de intervalos semiabiertos [start, end): existing.start < to AND existing.end > from.
      lt(simEspoMeetings.startAt, input.to),
      gt(simEspoMeetings.endAt, input.from),
    ]
    if (input.professionalId) {
      conditions.push(eq(simEspoMeetings.professionalId, input.professionalId))
    }
    if (input.zoneId) {
      conditions.push(eq(simEspoMeetings.zoneId, input.zoneId))
    }

    const rows = await this.db
      .select()
      .from(simEspoMeetings)
      .where(and(...conditions))

    const contactsByMeeting = await this.contactIdsByMeeting(rows.map((row) => row.id))
    return rows.map((row) => toSimMeeting(row, contactsByMeeting.get(row.id) ?? []))
  }

  /**
   * Revisión 2 de Fase 4B, punto 1: distingue explícitamente cero/uno/varios
   * — nunca `rows[0]`. Sin índice único en `bookingRequestId` (ver
   * `db/schema.ts`), más de una fila es un estado real y alcanzable, no
   * solo teórico.
   */
  async findMeetingByBookingRequestId(bookingRequestId: string): Promise<MeetingLookupResult> {
    const rows = await this.db.select().from(simEspoMeetings).where(eq(simEspoMeetings.bookingRequestId, bookingRequestId))

    if (rows.length === 0) {
      return { outcome: 'not_found' }
    }
    if (rows.length > 1) {
      return { outcome: 'duplicate', meetingIds: rows.map((row) => row.id) }
    }

    const [row] = rows
    const contactIds = await this.contactIdsForMeeting(row!.id)
    return { outcome: 'found', meeting: toSimMeeting(row!, contactIds) }
  }

  async getMeetingById(meetingId: string): Promise<SimMeeting | null> {
    const [row] = await this.db.select().from(simEspoMeetings).where(eq(simEspoMeetings.id, meetingId)).limit(1)
    if (!row) {
      return null
    }
    const contactIds = await this.contactIdsForMeeting(row.id)
    return toSimMeeting(row, contactIds)
  }

  async getContactById(contactId: string): Promise<SimContact | null> {
    const [row] = await this.db.select().from(simEspoContacts).where(eq(simEspoContacts.id, contactId)).limit(1)
    return row ? toSimContact(row) : null
  }

  async findOrCreateContact(input: FindOrCreateContactInput): Promise<ContactMatchResult> {
    if (input.gapssaAccountId) {
      const byAccount = await this.db.select().from(simEspoContacts).where(eq(simEspoContacts.gapssaAccountId, input.gapssaAccountId))
      if (byAccount.length > 1) {
        // Nunca `rows[0]` — mismo principio que la búsqueda de Meeting por
        // bookingRequestId (MeetingLookupResult) aplicado aquí a Contact.
        return { outcome: 'manual_review', candidateContactIds: byAccount.map((c) => c.id), reason: 'multiple_matches' }
      }
      if (byAccount.length === 1) {
        return { outcome: 'matched', contact: toSimContact(byAccount[0]!) }
      }
    }

    const [byEmail] = await this.db.select().from(simEspoContacts).where(eq(simEspoContacts.email, input.email)).limit(1)
    const [byPhone] = await this.db.select().from(simEspoContacts).where(eq(simEspoContacts.phone, input.phone)).limit(1)

    if (byEmail && byPhone && byEmail.id !== byPhone.id) {
      // Señales contradictorias: el correo apunta a un Contact y el
      // teléfono a otro distinto. Nunca se elige arbitrariamente entre
      // ellos (PROJECT_CONTEXT.md §7.1).
      return { outcome: 'manual_review', candidateContactIds: [byEmail.id, byPhone.id], reason: 'conflicting_signals' }
    }
    if (byEmail) {
      return { outcome: 'matched', contact: toSimContact(byEmail) }
    }
    if (byPhone) {
      return { outcome: 'matched', contact: toSimContact(byPhone) }
    }

    const [created] = await this.db
      .insert(simEspoContacts)
      .values({
        gapssaAccountId: input.gapssaAccountId ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
      })
      .returning()

    if (!created) {
      throw new Error('No se pudo crear el Contact simulado.')
    }
    return { outcome: 'created', contact: toSimContact(created) }
  }

  /**
   * Revisión 2 de Fase 4B, punto 1: `bookingRequestId` es único a nivel de
   * esquema (`db/schema.ts`) — un mismo bookingRequestId es, por
   * construcción, UNA sola reserva, así que dos intentos de creación
   * concurrentes para el MISMO bookingRequestId (p. ej. dos pestañas
   * verificando el mismo código de invitado casi a la vez) no son una
   * ambigüedad real: Postgres serializa el índice único y solo uno de los
   * dos `INSERT` gana; el otro se recupera adoptando el Meeting que ganó —
   * mismo espíritu que el resto del repositorio ("búsqueda idempotente
   * antes de crear"), NUNCA una elección arbitraria entre candidatos
   * ambiguos (eso es lo que prohíbe `MeetingLookupResult.duplicate`, que
   * sigue existiendo para el caso en que dos filas YA existan por una vía
   * ajena a esta llamada — inalcanzable hoy a través de `createMeeting` en
   * el adaptador simulado gracias al índice único, pero sí real y
   * alcanzable en `HttpEspoBookingAdapter`, que no tiene esa protección
   * contra la instancia real de EspoCRM).
   */
  async createMeeting(input: CreateMeetingInput): Promise<CreateMeetingOutcome> {
    // Puerta 5B-2A: defensa en profundidad — `serverEnv` ya impide que
    // `ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true` conviva con
    // `ESPO_BOOKING_ADAPTER=simulated` (`env.ts`, `superRefine`), así que
    // esta rama nunca debería alcanzarse por el único camino real
    // (`adapterSelector.ts`). Falla cerrado en vez de fabricar un
    // `SimMeeting` que dijera `cExcluirGoogleCalendarSync=true` sin que
    // esa exclusión signifique nada real (el simulado nunca habla con
    // GCS) — nunca confunde una reserva simulada con una prueba real.
    if (input.controlledTestExcludeGcs) {
      throw new Error(
        'SimulatedEspoBookingAdapter no puede honrar controlledTestExcludeGcs=true — requiere ESPO_BOOKING_ADAPTER=http (Puerta 5B-2A).',
      )
    }

    const lookup = await this.findMeetingByBookingRequestId(input.bookingRequestId)
    if (lookup.outcome === 'duplicate') {
      return { outcome: 'duplicate', meetingIds: lookup.meetingIds }
    }
    if (lookup.outcome === 'found') {
      return { outcome: 'created', meeting: lookup.meeting }
    }

    let created: typeof simEspoMeetings.$inferSelect
    try {
      const [row] = await this.db
        .insert(simEspoMeetings)
        .values({
          bookingRequestId: input.bookingRequestId,
          treatmentId: input.treatmentId,
          professionalId: input.professionalId,
          zoneId: input.zoneId,
          startAt: input.startAt,
          endAt: input.endAt,
          cEstadoReserva: 'PendingCenterApproval',
          status: 'Planned',
        })
        .returning()

      if (!row) {
        throw new Error('No se pudo crear el Meeting simulado.')
      }
      created = row
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }
      // Carrera perdida contra el índice único — adopta el Meeting que
      // ganó (idempotencia de un reintento concurrente para la MISMA
      // solicitud, nunca una fusión entre reservas distintas). Si la
      // relectura, contra toda expectativa dado el índice único, encuentra
      // más de una fila, se reporta `duplicate` en vez de asumir.
      const winner = await this.findMeetingByBookingRequestId(input.bookingRequestId)
      if (winner.outcome === 'duplicate') {
        return { outcome: 'duplicate', meetingIds: winner.meetingIds }
      }
      if (winner.outcome === 'found') {
        return { outcome: 'created', meeting: winner.meeting }
      }
      throw error
    }

    await this.db.insert(simEspoMeetingContacts).values({ meetingId: created.id, contactId: input.contactId })
    return { outcome: 'created', meeting: toSimMeeting(created, [input.contactId]) }
  }

  /**
   * `input.operationKey` no se persiste aquí: la protección contra doble
   * escritura en el adaptador simulado es el `WHERE cEstadoReserva =
   * 'PendingCenterApproval'` de Postgres (CAS real), suficiente por sí
   * mismo sin necesitar un almacén de idempotencia aparte. Se acepta en la
   * firma solo por paridad de contrato con `HttpEspoBookingAdapter`, que
   * SÍ la necesita (la REST API de EspoCRM no ofrece un CAS equivalente).
   */
  async decideMeeting(
    input:
      | { meetingId: string; decision: 'approved'; decidedBy: string; note?: string; operationKey: string }
      | { meetingId: string; decision: 'rejected'; decidedBy: string; note: string; operationKey: string },
  ): Promise<SimMeeting | null> {
    const nextEstado: EstadoReserva = input.decision === 'approved' ? 'Confirmed' : 'Canceled'
    const resultReason: MeetingResolutionReason = input.decision === 'approved' ? 'Approved' : 'RejectedByStaff'
    // Defensa en profundidad — mismo par decision/resultReason que valida
    // PutDecide.php del lado real; nunca escribir una combinación que la
    // propia política no reconoce como compatible.
    if (!isMeetingResolutionReasonCompatible(nextEstado, resultReason)) {
      throw new Error(`Combinación cEstadoReserva/resultReason incompatible: ${nextEstado}/${resultReason}`)
    }
    const now = new Date()

    const [updated] = await this.db
      .update(simEspoMeetings)
      .set({
        cEstadoReserva: nextEstado,
        status: ESTADO_RESERVA_A_MEETING_STATUS[nextEstado],
        decidedBy: input.decidedBy,
        decidedAt: now,
        resolutionReason: resultReason,
        note: input.note ?? null,
        updatedAt: now,
      })
      .where(and(eq(simEspoMeetings.id, input.meetingId), eq(simEspoMeetings.cEstadoReserva, 'PendingCenterApproval')))
      .returning()

    if (!updated) {
      return null
    }
    return toSimMeeting(updated, await this.contactIdsForMeeting(updated.id))
  }

  async expireMeeting(input: { meetingId: string; operationKey: string }): Promise<SimMeeting | null> {
    const now = new Date()
    const [updated] = await this.db
      .update(simEspoMeetings)
      .set({
        cEstadoReserva: 'Canceled',
        status: ESTADO_RESERVA_A_MEETING_STATUS.Canceled,
        decidedBy: 'system:approval-sweep',
        decidedAt: now,
        resolutionReason: 'ApprovalExpired',
        updatedAt: now,
      })
      .where(and(eq(simEspoMeetings.id, input.meetingId), eq(simEspoMeetings.cEstadoReserva, 'PendingCenterApproval')))
      .returning()

    if (!updated) {
      return null
    }
    return toSimMeeting(updated, await this.contactIdsForMeeting(updated.id))
  }

  async listAllMeetings(): Promise<SimMeeting[]> {
    const rows = await this.db.select().from(simEspoMeetings)
    const contactsByMeeting = await this.contactIdsByMeeting(rows.map((row) => row.id))
    return rows.map((row) => toSimMeeting(row, contactsByMeeting.get(row.id) ?? []))
  }
}
