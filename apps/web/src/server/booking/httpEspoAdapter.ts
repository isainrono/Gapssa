import 'server-only'
import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import {
  CONTACT_GAPSSA_ACCOUNT_ID_FIELD,
  ESTADO_RESERVA_A_MEETING_STATUS,
  ESTADOS_RESERVA,
  MEETING_RESOLUTION_REASONS,
  type EstadoReserva,
  type MeetingResolutionReason,
} from '@gapssa/contracts'

import type { ProfessionalFixture, TreatmentFixture, ZoneFixture } from './catalog'
import { assertSafeEspoSelect, espoPiiSelectAllowlist } from './espoQuerySafety'
import type {
  ContactMatchResult,
  CreateMeetingInput,
  CreateMeetingOutcome,
  EspoBookingAdapter,
  FindOrCreateContactInput,
  ListOccupiedMeetingsInput,
  MeetingLookupResult,
  SimContact,
  SimMeeting,
} from './espoAdapter'

/**
 * Adaptador HTTP real de `EspoBookingAdapter` (Fase 4B) — sustituye a
 * `SimulatedEspoBookingAdapter` sin que ningún llamante (`guestFlow.ts`,
 * `authenticatedFlow.ts`, `verificationSteps.ts`, `reconciliation.ts`) note
 * la diferencia: misma interfaz, misma forma de retorno. Selección
 * explícita vía `ESPO_BOOKING_ADAPTER` (`server/env.ts`,
 * `getEspoBookingAdapter` en `adapterSelector.ts`) — este módulo nunca se
 * autoselecciona.
 *
 * Limitaciones y aproximaciones documentadas, verificadas contra la
 * instancia real en la auditoría de Fase 4B (ver docs/fase4b-*.md):
 *
 * 1. **Resuelto en "Fase 4B — flujo de decisión final"**: `decideMeeting`/
 *    `expireMeeting` YA NO usan `PUT /api/v1/Meeting/{id}` genérico con
 *    lectura-antes-de-escribir (ventana de carrera real, documentada en
 *    revisiones anteriores) — llaman exclusivamente a
 *    `PUT /api/v1/GapssaMeetingDecision/{id}` (`PutDecide.php`), que posee
 *    su propia transacción con `SELECT ... FOR UPDATE` sobre el Meeting
 *    (CAS atómico real, verificado en `docs/fase4b-occ-revision-2.md`/`-3.md`
 *    contra una instancia EspoCRM desechable). `GuardMeetingDecisionTransition`
 *    RECHAZA cualquier intento de decidir vía el `PUT` genérico — este
 *    adaptador nunca debe volver a usarlo para estas dos operaciones. Ver
 *    `docs/fase4b-decision-flow-final.md`.
 * 2. `Meeting.contacts` es `linkMultiple` (muchos-a-muchos) en EspoCRM real;
 *    el contrato (`SimMeeting.contactId`) asume un único Contact. Este
 *    adaptador siempre crea/relaciona exactamente un Contact por Meeting
 *    (nunca más), pero al LEER un Meeting ya existente que pudiera tener
 *    varios o ninguno (p. ej. una reunión interna creada a mano en
 *    EspoCRM), toma el primero de `contactsIds` — nunca falla, pero es una
 *    simplificación deliberada solo segura para Meetings que ha creado el
 *    propio flujo de reservas.
 * 3. **Parcialmente resuelto**: el MOTIVO de una decisión (`Approved`/
 *    `RejectedByStaff`/`ApprovalExpired`) ya no se aproxima con
 *    `decidedBy`/`modifiedById` — se lee directamente del campo durable
 *    `cMotivoResolucionReserva` (campo NUEVO, no creado todavía en la
 *    instancia real — `docs/fase4b-decision-flow-final.md` §6). Lo que
 *    SIGUE sin tener equivalente real es el ACTOR humano exacto:
 *    `decidedBy`/`decidedAt` se aproximan con los campos nativos
 *    `modifiedById`/`modifiedAt`, que — cuando la decisión llega vía el
 *    endpoint interno del BFF (`/internal/decisions`) — siempre identifican
 *    al API User técnico (`portal-gapssa-api`), nunca a la persona real que
 *    tomó la decisión. La vía PREFERIDA para conservar `modifiedById`
 *    real es que el usuario humano autenticado en EspoCRM llame a
 *    `PutDecide` directamente desde la interfaz de EspoCRM (acción
 *    "Aprobar reserva"/"Rechazar reserva", con su propia sesión/ACL) — ver
 *    `docs/fase4b-decision-flow-final.md` §3. `note` sí tiene equivalente
 *    real exacto: el campo nativo `description`.
 * 4. `Contact.gapssaAccountId` y `Meeting.cBookingRequestId` NO existen
 *    todavía en la instancia real (auditoría de Fase 4B) — las llamadas que
 *    los usan fallarán con un error de EspoCRM ("campo desconocido") hasta
 *    que esos campos custom se creen (escritura de esquema en EspoCRM
 *    real, requiere autorización aparte, Fase 4B punto 10). El resto del
 *    adaptador (catálogo, disponibilidad, creación de Meeting) no depende
 *    de ellos. `Meeting.cMotivoResolucionReserva` (nuevo, ver punto 3
 *    arriba) está en la misma situación.
 * 5. "Profesional reservable" no tiene ningún marcador real en EspoCRM
 *    (rol/equipo no confirmados como criterio de negocio) — se usa la
 *    lista blanca explícita `ESPOCRM_PROFESSIONAL_USER_IDS`.
 */

// ---------------------------------------------------------------------------
// Cliente HTTP: timeouts, AbortController, límite de tamaño, redacción,
// reintentos solo para operaciones seguras (GET), backoff limitado.
// ---------------------------------------------------------------------------

export class EspoApiError extends Error {
  constructor(
    message: string,
    readonly correlationId: string,
    readonly status?: number,
    /**
     * Cuerpo JSON ya parseado de una respuesta no-ok, cuando pudo leerse —
     * "Fase 4B — flujo de decisión final": `PutDecide` responde 409 con un
     * cuerpo estructurado (`{status: 'conflict', reason: ...}`) que es
     * información legítima, no solo un fallo opaco — `putDecide()` lo usa
     * para distinguir "conflicto real de estado" de "idempotencyKey
     * reutilizada con payload distinto" (nunca tratados igual). Nunca
     * incluye PII: el cuerpo de estas respuestas de decisión solo lleva
     * ids/enums/estados.
     */
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'EspoApiError'
  }
}

/**
 * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas: se lanza
 * cuando `createMeeting` pidió `controlledTestExcludeGcs=true` pero la
 * relectura por `select=` cerrado (`MEETING_SELECT_FIELDS`) tras la
 * creación no confirma `cExcluirGoogleCalendarSync=true` — nunca se
 * inventa el éxito. El Meeting YA EXISTE en EspoCRM en este punto (el
 * `POST` ya se aplicó) — el llamante nunca debe reintentar la creación a
 * ciegas; un reintento de `completeBookingToMeeting` adoptará el Meeting
 * existente por `cBookingRequestId` y volverá a comprobar la exclusión
 * esperada (`verificationSteps.ts`), nunca duplicándolo.
 */
export class ControlledTestExclusionUnverifiedError extends Error {
  constructor(
    readonly bookingRequestId: string,
    readonly meetingId: string,
  ) {
    super(
      `No se pudo verificar cExcluirGoogleCalendarSync=true tras crear el Meeting ${meetingId} (bookingRequestId=${bookingRequestId}) — Puerta 5B-2A nunca inventa este resultado.`,
    )
    this.name = 'ControlledTestExclusionUnverifiedError'
  }
}

export interface HttpEspoAdapterConfig {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
  maxResponseBytes: number
  professionalUserIds: readonly string[]
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, string>
  body?: unknown
  /** Solo GET es idempotente por construcción en este adaptador — nunca se marca `true` para POST/PUT. */
  retryable?: boolean
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

/** Único cómputo de la allowlist de PII de este adaptador — ver `espoQuerySafety.ts`. */
const ESPO_PII_SELECT_ALLOWLIST = espoPiiSelectAllowlist(CONTACT_GAPSSA_ACCOUNT_ID_FIELD)

/**
 * Puerta 5A, causa raíz confirmada contra `gapssa-espocrm-1` real
 * (`docs/fase4b-puerta5-propuesta-v3.md`): `Meeting.name` es un campo
 * obligatorio del propio entity def de EspoCRM — `POST /api/v1/Meeting`
 * sin `name` responde `400 validationFailure field=name type=required`,
 * independientemente del ACL de campo del actor. `createMeeting()` ya no
 * puede omitirlo.
 *
 * Constante fija, nunca derivada de `CreateMeetingInput` — deliberado:
 * - **Nunca** debe permitir correlacionar un `Meeting` con un cliente,
 *   tratamiento, profesional, fecha/hora o `bookingRequestId` real: un
 *   valor dinámico convertiría un campo puramente técnico en un vector de
 *   fuga de datos de negocio, visible para cualquiera con `Meeting.name`
 *   en `read:yes` (p. ej. un futuro rol/integración distinto de `Portal
 *   GAPSSA API`) aunque careciera de acceso a `Contact`/`CTratamiento`.
 * - Puerta 3C (propuesta, `docs/fase4b-puerta3c-meeting-name-acl.md`)
 *   deja `Portal GAPSSA API` en `Meeting.name = {read: no, edit: yes}` —
 *   deliberadamente asimétrico:
 *   - `edit: yes` es el mínimo estrictamente necesario para poder crear
 *     el `Meeting` obligatorio (sin él, todo `createMeeting()` falla).
 *   - `read: no` se mantiene — nunca se amplía a `read: yes` — porque
 *     evita exponer asuntos o nombres de `Meeting` reales (creados desde
 *     la propia interfaz de EspoCRM, con texto libre) a través de un rol
 *     pensado únicamente para orquestar el flujo de reservas del portal.
 *   - Este adaptador nunca depende de LEER `name`: no está en
 *     `MEETING_SELECT_FIELDS` ni en `meetingRecordSchema` (más abajo) —
 *     `read: no` no le quita ninguna capacidad.
 */
/** Exportada únicamente para que las pruebas contractuales (`httpEspoAdapter.test.ts`) puedan afirmar el valor exacto sin duplicar el literal — nunca pensada como API pública del módulo más allá de eso. */
export const PORTAL_MEETING_NAME = 'Reserva portal GAPSSA'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Lee el body con un tope de bytes — protege contra una respuesta
 * inesperadamente grande (o un EspoCRM mal configurado devolviendo HTML de
 * error) antes de intentar `JSON.parse`. Nunca confía en `Content-Length`
 * a solas (puede faltar o mentir).
 */
async function readBodyWithLimit(response: Response, maxBytes: number, correlationId: string): Promise<string> {
  if (!response.body) {
    return ''
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new EspoApiError('Respuesta de EspoCRM excede el tamaño máximo permitido.', correlationId, response.status)
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8')
}

export class HttpEspoBookingAdapter implements EspoBookingAdapter {
  constructor(private readonly config: HttpEspoAdapterConfig) {}

  /**
   * Nunca registra `Authorization`/`X-Api-Key`, nunca registra el cuerpo de
   * la petición (puede llevar datos de Contact) — solo método, ruta,
   * estado HTTP y un id de correlación opaco generado aquí (EspoCRM no
   * define uno propio; sirve solo para correlar nuestros propios logs de
   * error, nunca se envía como prueba de identidad).
   */
  private async request<T>(options: RequestOptions): Promise<T> {
    // Fase 4B, revisión 2, punto 7: única puerta de salida HTTP de este
    // adaptador — la comprobación corre ANTES de construir la URL o de
    // tocar `fetch`, nunca como una validación posterior u opcional. Lanza
    // síncronamente (dentro de esta función async, se convierte en un
    // rechazo de la promesa) sin que ninguna petición llegue a la red.
    assertSafeEspoSelect(options.method, options.path, options.query, ESPO_PII_SELECT_ALLOWLIST)

    const correlationId = randomUUID()
    const url = new URL(options.path, this.config.baseUrl)
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value)
      }
    }

    const maxAttempts = options.retryable ? this.config.maxRetries + 1 : 1
    let lastError: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        // Backoff exponencial limitado — nunca reintenta más rápido que el intento anterior.
        await sleep(this.config.retryBaseDelayMs * 2 ** (attempt - 1))
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

      try {
        const response = await fetch(url, {
          method: options.method,
          headers: {
            'X-Api-Key': this.config.apiKey,
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        })

        const text = await readBodyWithLimit(response, this.config.maxResponseBytes, correlationId)

        if (!response.ok) {
          if (options.retryable && RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts - 1) {
            lastError = new EspoApiError(`EspoCRM respondió ${response.status} en ${options.method} ${options.path}.`, correlationId, response.status)
            continue
          }
          let parsedBody: unknown
          try {
            parsedBody = text.length > 0 ? JSON.parse(text) : undefined
          } catch {
            // Corrección de puerta 4, bloqueo de concurrencia: no todo
            // cuerpo de error de EspoCRM es JSON — `Conflict::createWithBody()`
            // (core de EspoCRM, ver `PutDecide.php::runWithinTransaction`,
            // `idempotency_key_reused`) escribe el segundo argumento TAL
            // CUAL en el cuerpo de la respuesta, sin envolverlo en JSON
            // (confirmado leyendo `Espo\Core\Api\ErrorOutput::printBody()`
            // en la instancia real: `$response->writeBody($exception->getBody())`).
            // Guardar el texto crudo (nunca `undefined`) es lo que permite
            // a `isIdempotencyKeyReusedConflict()` reconocer ese código
            // contractual concreto más abajo — perderlo aquí es exactamente
            // lo que hacía que ese 409 se propagara como un fallo opaco.
            parsedBody = text.length > 0 ? text : undefined
          }
          throw new EspoApiError(`EspoCRM respondió ${response.status} en ${options.method} ${options.path}.`, correlationId, response.status, parsedBody)
        }

        if (text.length === 0) {
          return undefined as T
        }

        try {
          return JSON.parse(text) as T
        } catch {
          throw new EspoApiError(`EspoCRM devolvió JSON inválido en ${options.method} ${options.path}.`, correlationId, response.status)
        }
      } catch (error) {
        if (error instanceof EspoApiError) {
          throw error
        }
        // Error de red/timeout — solo se reintenta en operaciones marcadas `retryable`.
        lastError = new EspoApiError(
          `Fallo de red o timeout en ${options.method} ${options.path}.`,
          correlationId,
        )
        if (!options.retryable || attempt === maxAttempts - 1) {
          throw lastError
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    throw lastError instanceof Error ? lastError : new EspoApiError('Fallo desconocido al llamar a EspoCRM.', correlationId)
  }

  /** Recorre todas las páginas hasta `total` o hasta `hardCap` (protección contra catálogos inesperadamente grandes) — nunca un escaneo sin límite. */
  private async listAllPages<T>(
    path: string,
    baseQuery: Record<string, string>,
    itemSchema: z.ZodType<T>,
    pageSize = 200,
    hardCap = 5000,
  ): Promise<T[]> {
    const pageSchema = z.object({ total: z.number(), list: z.array(itemSchema) })
    const results: T[] = []
    let offset = 0

    for (;;) {
      const raw = await this.request<unknown>({
        method: 'GET',
        path,
        query: { ...baseQuery, maxSize: String(pageSize), offset: String(offset) },
        retryable: true,
      })
      const page = pageSchema.parse(raw)
      results.push(...page.list)
      offset += page.list.length

      if (page.list.length === 0 || results.length >= page.total || results.length >= hardCap) {
        break
      }
    }
    return results
  }

  // -------------------------------------------------------------------------
  // Catálogo
  // -------------------------------------------------------------------------

  async listTreatments(): Promise<TreatmentFixture[]> {
    const rows = await this.listAllPages(
      '/api/v1/CTratamiento',
      { select: TREATMENT_SELECT_FIELDS, 'where[0][type]': 'isTrue', 'where[0][attribute]': 'activo' },
      treatmentRecordSchema,
    )
    return rows.map(toTreatmentFixture)
  }

  async listZones(): Promise<ZoneFixture[]> {
    const rows = await this.listAllPages(
      '/api/v1/CZonaAtencion',
      { select: 'id,name,capacidadSimultanea,activa', 'where[0][type]': 'isTrue', 'where[0][attribute]': 'activa' },
      zoneRecordSchema,
    )
    return rows.map(toZoneFixture)
  }

  async listProfessionals(): Promise<ProfessionalFixture[]> {
    if (this.config.professionalUserIds.length === 0) {
      return []
    }
    const rows = await Promise.all(this.config.professionalUserIds.map((id) => this.getProfessional(id)))
    return rows.filter((row): row is ProfessionalFixture => row !== null && row.active)
  }

  async getTreatment(id: string): Promise<TreatmentFixture | null> {
    return this.getById('/api/v1/CTratamiento', id, TREATMENT_SELECT_FIELDS, treatmentRecordSchema, toTreatmentFixture)
  }

  async getZone(id: string): Promise<ZoneFixture | null> {
    return this.getById('/api/v1/CZonaAtencion', id, ZONE_SELECT_FIELDS, zoneRecordSchema, toZoneFixture)
  }

  async getProfessional(id: string): Promise<ProfessionalFixture | null> {
    if (!this.config.professionalUserIds.includes(id)) {
      return null
    }
    return this.getById('/api/v1/User', id, USER_SELECT_FIELDS, userRecordSchema, toProfessionalFixture)
  }

  /**
   * Incidente de PII (`docs/fase4b-integracion-http.md` §1): antes de esta
   * revisión, ningún `GET` de registro único pasaba `select=` — devolvía
   * TODOS los campos del registro, PII incluida en `User`/`Contact`.
   * `select` es ahora un parámetro OBLIGATORIO (nunca opcional): la
   * comprobación real de `assertSafeEspoSelect` corre dentro de
   * `request()`, pero exigirlo aquí en tiempo de compilación evita que un
   * llamante futuro vuelva a omitirlo por descuido.
   */
  private async getById<TRaw, TOut>(
    path: string,
    id: string,
    select: string,
    schema: z.ZodType<TRaw>,
    map: (raw: TRaw) => TOut,
  ): Promise<TOut | null> {
    try {
      const raw = await this.request<unknown>({ method: 'GET', path: `${path}/${encodeURIComponent(id)}`, query: { select }, retryable: true })
      return map(schema.parse(raw))
    } catch (error) {
      if (error instanceof EspoApiError && error.status === 404) {
        return null
      }
      throw error
    }
  }

  // -------------------------------------------------------------------------
  // Disponibilidad / lectura de Meetings
  // -------------------------------------------------------------------------

  async listActiveMeetingsOverlapping(input: ListOccupiedMeetingsInput): Promise<SimMeeting[]> {
    const query: Record<string, string> = {
      select: MEETING_SELECT_FIELDS,
      'where[0][type]': 'notIn',
      'where[0][attribute]': 'cEstadoReserva',
      'where[0][value][0]': 'Canceled',
      'where[0][value][1]': 'NoShow',
      'where[1][type]': 'lessThan',
      'where[1][attribute]': 'dateStart',
      'where[1][value]': formatEspoDateTime(input.to),
      'where[2][type]': 'greaterThan',
      'where[2][attribute]': 'dateEnd',
      'where[2][value]': formatEspoDateTime(input.from),
    }
    if (input.professionalId) {
      query['where[3][type]'] = 'equals'
      query['where[3][attribute]'] = 'assignedUserId'
      query['where[3][value]'] = input.professionalId
    }
    if (input.zoneId) {
      query['where[4][type]'] = 'equals'
      query['where[4][attribute]'] = 'cZonaAtencionId'
      query['where[4][value]'] = input.zoneId
    }

    const rows = await this.listAllPages('/api/v1/Meeting', query, meetingRecordSchema)
    return rows.map(toSimMeeting)
  }

  /**
   * Cota de páginas: 5 Meetings duplicados por el mismo cBookingRequestId
   * ya es, en sí mismo, un incidente operativo — un `hardCap` bajo evita un
   * escaneo sin límite ante un estado de datos verdaderamente roto, y basta
   * para que un `BookingReviewRecord` (`candidateMeetingIds`) tenga
   * suficiente traza para el operador sin necesidad de listarlos todos.
   */
  private static readonly DUPLICATE_MEETING_LOOKUP_CAP = 5

  /**
   * Revisión 2 de Fase 4B, punto 1: distingue explícitamente cero/uno/varios
   * — nunca `rows[0]`. `cBookingRequestId` NO es todavía un índice único en
   * la instancia real (`docs/fase4b-integracion-http.md` §1/§10 punto 2),
   * así que más de una fila es un estado de datos real y alcanzable.
   */
  async findMeetingByBookingRequestId(bookingRequestId: string): Promise<MeetingLookupResult> {
    const rows = await this.listAllPages(
      '/api/v1/Meeting',
      {
        select: MEETING_SELECT_FIELDS,
        'where[0][type]': 'equals',
        'where[0][attribute]': 'cBookingRequestId',
        'where[0][value]': bookingRequestId,
      },
      meetingRecordSchema,
      HttpEspoBookingAdapter.DUPLICATE_MEETING_LOOKUP_CAP,
      HttpEspoBookingAdapter.DUPLICATE_MEETING_LOOKUP_CAP,
    )

    if (rows.length === 0) {
      return { outcome: 'not_found' }
    }
    if (rows.length > 1) {
      return { outcome: 'duplicate', meetingIds: rows.map((row) => row.id) }
    }
    return { outcome: 'found', meeting: toSimMeeting(rows[0]!) }
  }

  async getMeetingById(meetingId: string): Promise<SimMeeting | null> {
    return this.getById('/api/v1/Meeting', meetingId, MEETING_SELECT_FIELDS, meetingRecordSchema, toSimMeeting)
  }

  async listAllMeetings(): Promise<SimMeeting[]> {
    const rows = await this.listAllPages('/api/v1/Meeting', { select: MEETING_SELECT_FIELDS }, meetingRecordSchema)
    return rows.map(toSimMeeting)
  }

  // -------------------------------------------------------------------------
  // Contact
  // -------------------------------------------------------------------------

  async findOrCreateContact(input: FindOrCreateContactInput): Promise<ContactMatchResult> {
    if (input.gapssaAccountId) {
      const byAccount = await this.findContactsBy(CONTACT_GAPSSA_ACCOUNT_ID_FIELD, input.gapssaAccountId)
      if (byAccount.length === 1) {
        return { outcome: 'matched', contact: toSimContact(byAccount[0]!) }
      }
      if (byAccount.length > 1) {
        return { outcome: 'manual_review', candidateContactIds: byAccount.map((c) => c.id), reason: 'multiple_matches' }
      }
    }

    const [byEmail, byPhone] = await Promise.all([
      this.findContactsBy('emailAddress', input.email),
      this.findContactsBy('phoneNumber', input.phone),
    ])

    const candidateIds = new Set([...byEmail.map((c) => c.id), ...byPhone.map((c) => c.id)])
    if (candidateIds.size > 1) {
      // Varias coincidencias, o correo y teléfono apuntan a Contacts
      // distintos — señales contradictorias, nunca se fusiona ni se elige
      // arbitrariamente (PROJECT_CONTEXT.md §7.1).
      const reason = byEmail.length > 0 && byPhone.length > 0 && byEmail[0]!.id !== byPhone[0]!.id ? 'conflicting_signals' : 'multiple_matches'
      return { outcome: 'manual_review', candidateContactIds: [...candidateIds], reason }
    }
    if (candidateIds.size === 1) {
      const match = [...byEmail, ...byPhone][0]!
      return { outcome: 'matched', contact: toSimContact(match) }
    }

    const created = await this.request<unknown>({
      method: 'POST',
      path: '/api/v1/Contact',
      body: {
        firstName: input.firstName,
        lastName: input.lastName,
        emailAddress: input.email,
        phoneNumber: input.phone,
        ...(input.gapssaAccountId ? { [CONTACT_GAPSSA_ACCOUNT_ID_FIELD]: input.gapssaAccountId } : {}),
      },
    })
    return { outcome: 'created', contact: toSimContact(contactRecordSchema.parse(created)) }
  }

  /** Revisión 3 de Fase 4B, punto 4: registro único, misma protección de `select=` que el resto de `getById` (`espoQuerySafety.ts`) — nunca todos los campos del Contact real. */
  async getContactById(contactId: string): Promise<SimContact | null> {
    return this.getById('/api/v1/Contact', contactId, CONTACT_SELECT_FIELDS, contactRecordSchema, toSimContact)
  }

  private async findContactsBy(attribute: string, value: string): Promise<ContactRecord[]> {
    const rows = await this.listAllPages(
      '/api/v1/Contact',
      {
        select: CONTACT_SELECT_FIELDS,
        'where[0][type]': 'equals',
        'where[0][attribute]': attribute,
        'where[0][value]': value,
      },
      contactRecordSchema,
      10,
    )
    return rows
  }

  // -------------------------------------------------------------------------
  // Meeting: creación idempotente, decisión, expiración
  // -------------------------------------------------------------------------

  /**
   * Revisión 2 de Fase 4B, punto 1: `createMeeting` ya NO decide nada sobre
   * la relación Meeting↔Contact de un Meeting PREEXISTENTE — esa validación
   * (`evaluateContactAdoption`) es ahora responsabilidad exclusiva de
   * `verificationSteps.ts`, ANTES de decidir siquiera si hace falta crear
   * un Meeting. `createMeeting` solo garantiza dos cosas: (a) nunca crea un
   * Meeting duplicado para el mismo bookingRequestId — una carrera que sí
   * produce dos se detecta y se devuelve `duplicate`, nunca se elige un
   * ganador; (b) un Meeting recién creado por ESTA llamada queda con
   * exactamente el Contact esperado relacionado.
   */
  async createMeeting(input: CreateMeetingInput): Promise<CreateMeetingOutcome> {
    // Paso 5 (docs/contratos-portal-v1.md §3.4), repetido aquí a nivel del
    // propio adaptador: nunca crea sin buscar primero.
    const lookup = await this.findMeetingByBookingRequestId(input.bookingRequestId)
    if (lookup.outcome === 'duplicate') {
      return { outcome: 'duplicate', meetingIds: lookup.meetingIds }
    }
    if (lookup.outcome === 'found') {
      return { outcome: 'created', meeting: lookup.meeting }
    }

    let created: MeetingRecord
    try {
      const raw = await this.request<unknown>({
        method: 'POST',
        path: '/api/v1/Meeting',
        body: {
          name: PORTAL_MEETING_NAME,
          dateStart: formatEspoDateTime(input.startAt),
          dateEnd: formatEspoDateTime(input.endAt),
          cTratamientoId: input.treatmentId,
          cZonaAtencionId: input.zoneId,
          assignedUserId: input.professionalId,
          cEstadoReserva: 'PendingCenterApproval' satisfies EstadoReserva,
          status: ESTADO_RESERVA_A_MEETING_STATUS.PendingCenterApproval,
          cBookingRequestId: input.bookingRequestId,
          // Puerta 5B-2A: SOLO se añade la clave cuando es exactamente
          // `true` — funcionamiento normal (`undefined`) nunca la incluye
          // (equivale al `default: false` del propio esquema de EspoCRM,
          // Puerta 6), y nunca se envía `false` derivado del cliente.
          ...(input.controlledTestExcludeGcs ? { cExcluirGoogleCalendarSync: true as const } : {}),
        },
      })
      created = meetingRecordSchema.parse(raw)
    } catch (error) {
      // Respuesta ambigua (timeout, 5xx tras enviar la petición): nunca se
      // reintenta la creación a ciegas — se vuelve a buscar por
      // cBookingRequestId (Fase 4B punto 4) antes de decidir, distinguiendo
      // otra vez cero/uno/varios. Si la creación sí llegó a aplicarse en
      // EspoCRM, se adopta; si no, el error original se propaga para que el
      // llamante decida (nunca se inventa un resultado).
      const adopted = await this.findMeetingByBookingRequestId(input.bookingRequestId)
      if (adopted.outcome === 'duplicate') {
        return { outcome: 'duplicate', meetingIds: adopted.meetingIds }
      }
      if (adopted.outcome === 'found') {
        return { outcome: 'created', meeting: adopted.meeting }
      }
      throw error
    }

    if (input.controlledTestExcludeGcs) {
      // Verifica la exclusión ANTES de relacionar el Contact. El hook GCS
      // también reacciona a `afterRelate`; si EspoCRM hubiese filtrado el
      // campo por ACL, relacionar primero encolaría un segundo UPSERT antes
      // de que pudiéramos detectar el fallo. En modo controlado no se toca
      // ninguna relación hasta probar por una relectura independiente que
      // el Meeting nació realmente excluido.
      const verifiedBeforeRelate = await this.getMeetingById(created.id)
      if (!verifiedBeforeRelate || verifiedBeforeRelate.cExcluirGoogleCalendarSync !== true) {
        throw new ControlledTestExclusionUnverifiedError(input.bookingRequestId, created.id)
      }
    }

    await this.relateContact(created.id, input.contactId)

    // Relectura tras el propio POST — una carrera concurrente puede haber
    // creado OTRO Meeting para el mismo bookingRequestId casi al mismo
    // tiempo; nunca se asume en silencio que esta llamada ganó.
    const postInsertLookup = await this.findMeetingByBookingRequestId(input.bookingRequestId)
    if (postInsertLookup.outcome === 'duplicate') {
      return { outcome: 'duplicate', meetingIds: postInsertLookup.meetingIds }
    }

    if (input.controlledTestExcludeGcs) {
      // Puerta 5B-2A: nunca confiar en el eco del propio POST (`created`,
      // sin `select=` cerrado) para confirmar el campo más sensible de
      // esta subpuerta — relectura explícita por `select=` cerrado
      // (`MEETING_SELECT_FIELDS`, vía `getMeetingById`), igual que
      // cualquier otra verificación de este adaptador. Si EspoCRM omite el
      // campo o lo devuelve `false` (ACL cerrado, extensión no
      // desplegada, o cualquier otra causa), NUNCA se inventa `true` — se
      // falla de forma recuperable: el Meeting ya existe, y un reintento
      // de `completeBookingToMeeting` lo adopta por `cBookingRequestId`
      // (nunca lo duplica) y vuelve a comprobar la exclusión esperada.
      const verified = await this.getMeetingById(created.id)
      if (!verified || verified.cExcluirGoogleCalendarSync !== true) {
        throw new ControlledTestExclusionUnverifiedError(input.bookingRequestId, created.id)
      }
      return { outcome: 'created', meeting: verified }
    }

    return { outcome: 'created', meeting: toSimMeeting({ ...created, contactsIds: [input.contactId] }) }
  }

  private async relateContact(meetingId: string, contactId: string): Promise<void> {
    await this.request({
      method: 'POST',
      path: `/api/v1/Meeting/${encodeURIComponent(meetingId)}/contacts`,
      body: { id: contactId },
    })
  }

  /**
   * "Fase 4B — flujo de decisión final", hueco 1: decisión HUMANA
   * (aprobar/rechazar). `resultReason` se deriva 1:1 de `decision` — nunca
   * se acepta un `resultReason` ajeno, mismo principio que
   * `MeetingResolutionPolicy::isCompatible` del lado PHP. Llama
   * EXCLUSIVAMENTE a `PutDecide` (`putDecide()`) — nunca a
   * `PUT /api/v1/Meeting/{id}` genérico, que `GuardMeetingDecisionTransition`
   * rechazaría de todos modos.
   */
  async decideMeeting(
    input:
      | { meetingId: string; decision: 'approved'; decidedBy: string; note?: string; operationKey: string }
      | { meetingId: string; decision: 'rejected'; decidedBy: string; note: string; operationKey: string },
  ): Promise<SimMeeting | null> {
    const nextEstado: EstadoReserva = input.decision === 'approved' ? 'Confirmed' : 'Canceled'
    const resultReason: MeetingResolutionReason = input.decision === 'approved' ? 'Approved' : 'RejectedByStaff'
    return this.putDecide(input.meetingId, {
      decision: nextEstado,
      resultReason,
      note: input.note,
      operationKey: input.operationKey,
    })
  }

  /**
   * Hueco 1: caducidad de SISTEMA (barrido de conciliación). Siempre
   * `resultReason: 'ApprovalExpired'`, nunca nota humana — `PutDecide`
   * admite únicamente ausencia de nota o la nota técnica fija para este
   * motivo (`MeetingResolutionPolicy::isNoteAcceptable`); este adaptador
   * simplemente no envía ninguna, dejando que EspoCRM aplique su propio
   * valor por defecto (`null`).
   */
  async expireMeeting(input: { meetingId: string; operationKey: string }): Promise<SimMeeting | null> {
    return this.putDecide(input.meetingId, {
      decision: 'Canceled',
      resultReason: 'ApprovalExpired',
      operationKey: input.operationKey,
    })
  }

  /**
   * Único punto de llamada a `PUT /api/v1/GapssaMeetingDecision/{id}`
   * (`PutDecide.php`) — dueño de su propia transacción atómica
   * (`SELECT ... FOR UPDATE`) del lado de EspoCRM; este método nunca
   * implementa su propio CAS/lectura-antes-de-escribir, a diferencia de la
   * versión anterior (`writeIfPendingCenterApproval`, eliminada).
   *
   * - 200 (aplicado O repetido/replay — transparente, mismo cuerpo): relee
   *   el Meeting completo (`getMeetingById`) para devolver un `SimMeeting`
   *   con todos los campos, no solo los que `PutDecide` incluye en su
   *   respuesta.
   * - 409 `meeting_decision_conflict` (el Meeting ya no estaba en
   *   `PendingCenterApproval`): `null` — el llamante reconcilia releyendo
   *   el estado actual (`decisionRecovery.ts`/`reconciliation.ts`), nunca
   *   se asume qué pasó.
   * - 404 (Meeting inexistente): `null` — mismo tratamiento que el
   *   llamante ya da a "no encontrado" vía `getMeetingById`.
   * - Cualquier otro estado (400 propio de un payload mal formado, 409
   *   `idempotency_key_reused`, 401/403, 500): se propaga como excepción —
   *   NUNCA se trata aquí como "alguien más ya decidió", son señales de un
   *   fallo o un error de programación, no (a este nivel) de una carrera
   *   legítima. `idempotency_key_reused` SÍ es reconocible por el llamante
   *   — `isIdempotencyKeyReusedConflict()`, exportada más abajo — para el
   *   único caso legítimo documentado: dos decisiones HUMANAS distintas
   *   compitiendo por el mismo `bookingRequestId` (`decisionRecovery.ts::applyOrAdoptBookingDecision`),
   *   nunca dentro de este adaptador, que se mantiene deliberadamente
   *   agnóstico de esa reconciliación.
   */
  private async putDecide(
    meetingId: string,
    body: { decision: 'Confirmed' | 'Canceled'; resultReason: MeetingResolutionReason; note?: string; operationKey: string },
  ): Promise<SimMeeting | null> {
    try {
      await this.request<unknown>({
        method: 'PUT',
        path: `/api/v1/GapssaMeetingDecision/${encodeURIComponent(meetingId)}`,
        body: {
          decision: body.decision,
          resultReason: body.resultReason,
          ...(body.note !== undefined ? { note: body.note } : {}),
          operationKey: body.operationKey,
        },
      })
    } catch (error) {
      if (error instanceof EspoApiError && error.status === 404) {
        return null
      }
      if (error instanceof EspoApiError && error.status === 409) {
        const parsed = putDecideConflictBodySchema.safeParse(error.body)
        if (parsed.success && parsed.data.reason === 'meeting_decision_conflict') {
          return null
        }
      }
      throw error
    }

    return this.getMeetingById(meetingId)
  }
}

// ---------------------------------------------------------------------------
// Esquemas de validación en tiempo de ejecución — nunca se confía solo en
// TypeScript para lo que devuelve la red.
// ---------------------------------------------------------------------------

const TREATMENT_SELECT_FIELDS = 'id,name,familia,duracionMinutos,precioOrientativo,estadoPrecio'
const treatmentRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  familia: z.string(),
  duracionMinutos: z.number().int().positive(),
  precioOrientativo: z.number().nullable().optional(),
  estadoPrecio: z.string().nullable().optional(),
})
type TreatmentRecord = z.infer<typeof treatmentRecordSchema>

const ZONE_SELECT_FIELDS = 'id,name,capacidadSimultanea'
const zoneRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  capacidadSimultanea: z.number().int().positive(),
})
type ZoneRecord = z.infer<typeof zoneRecordSchema>

/** Mismos tres campos que `espoPiiSelectAllowlist().User` (`espoQuerySafety.ts`) — nunca más. */
const USER_SELECT_FIELDS = 'id,name,isActive'
const userRecordSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  isActive: z.boolean(),
})
type UserRecord = z.infer<typeof userRecordSchema>

/**
 * `CONTACT_GAPSSA_ACCOUNT_ID_FIELD` (`packages/contracts/src/booking.ts`,
 * Fase 4B revisión 2 punto 4) es la ÚNICA fuente del nombre real del
 * campo — nunca se repite el literal `"gapssaAccountId"` aquí.
 */
const CONTACT_SELECT_FIELDS = `id,firstName,lastName,emailAddress,phoneNumber,${CONTACT_GAPSSA_ACCOUNT_ID_FIELD}`
const contactRecordSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  emailAddress: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  [CONTACT_GAPSSA_ACCOUNT_ID_FIELD]: z.string().nullable().optional(),
})
type ContactRecord = z.infer<typeof contactRecordSchema>

/** Exportada únicamente para que las pruebas contractuales puedan afirmar que `name` nunca se añade aquí (Puerta 3C: `Portal GAPSSA API` tiene `Meeting.name` en `read: no` — pedirlo en `select=` no serviría de nada y documentaría una dependencia de lectura que este adaptador nunca tiene). */
export const MEETING_SELECT_FIELDS =
  'id,dateStart,dateEnd,status,cEstadoReserva,cMotivoResolucionReserva,cTratamientoId,cZonaAtencionId,assignedUserId,contactsIds,cBookingRequestId,description,modifiedById,modifiedAt,cExcluirGoogleCalendarSync'
const meetingRecordSchema = z.object({
  id: z.string(),
  dateStart: z.string(),
  dateEnd: z.string(),
  status: z.enum(['Planned', 'Held', 'Not Held']),
  cEstadoReserva: z.enum(ESTADOS_RESERVA).nullable(),
  // "Fase 4B — flujo de decisión final": campo NUEVO, no creado todavía en
  // la instancia real (docs/fase4b-decision-flow-final.md §6) — nullable/
  // optional para que leer un Meeting antes de que el campo exista no
  // rompa el parseo (EspoCRM simplemente no lo incluye en la respuesta).
  cMotivoResolucionReserva: z.enum(MEETING_RESOLUTION_REASONS).nullable().optional(),
  cTratamientoId: z.string().nullable().optional(),
  cZonaAtencionId: z.string().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
  contactsIds: z.array(z.string()).nullable().optional(),
  cBookingRequestId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  modifiedById: z.string().nullable().optional(),
  modifiedAt: z.string().nullable().optional(),
  /**
   * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas (Puerta 6,
   * `docs/fase4b-puerta6-exclusion-gcs.md`). `nullable().optional()` por el
   * mismo motivo que `cMotivoResolucionReserva`: leer un Meeting en un
   * entorno donde la extensión GCS todavía no está desplegada no debe
   * romper el parseo — `toSimMeeting` nunca infiere `true` de su ausencia.
   */
  cExcluirGoogleCalendarSync: z.boolean().nullable().optional(),
})
type MeetingRecord = z.infer<typeof meetingRecordSchema>

/**
 * Cuerpo de conflicto de `PutDecide` (`PutDecide.php::recordAndRespondConflict`)
 * — solo los campos necesarios para distinguir `meeting_decision_conflict`
 * (reconciliable) de cualquier otro 409 (p. ej. `idempotency_key_reused`,
 * nunca reconciliable en silencio). Sin PII: solo ids/enums.
 */
const putDecideConflictBodySchema = z.object({
  status: z.literal('conflict'),
  reason: z.string(),
  meetingId: z.string(),
  existingCEstadoReserva: z.string().nullable().optional(),
})

/**
 * Cuerpo EXACTO que `PutDecide.php::runWithinTransaction`/`persistIdempotentResult`
 * pasan a `Conflict::createWithBody($mensaje, 'idempotency_key_reused')` —
 * un string plano, no un objeto JSON (a diferencia de
 * `meeting_decision_conflict`, que sí compone su propia respuesta JSON
 * manualmente vía `ResponseComposer`). Confirmado leyendo el core real de
 * EspoCRM 10.0.3 (`Espo\Core\Api\ErrorOutput::printBody()`): el cuerpo de
 * una excepción `HasBody` se escribe tal cual, sin serializar.
 */
const IDEMPOTENCY_KEY_REUSED_BODY = 'idempotency_key_reused'

/**
 * Corrección de puerta 4, bloqueo de concurrencia: único punto que
 * reconoce el código contractual "operationKey ya usada con un payload
 * distinto" como tal — nunca por inspección de `error.message` (texto
 * libre, no contractual) ni tratando cualquier 409 como equivalente.
 * `decisionRecovery.ts::applyOrAdoptBookingDecision` es el único llamante
 * previsto: dos decisiones HUMANAS distintas compitiendo por el mismo
 * `bookingRequestId` pueden hacer que la segunda en llegar reciba este 409
 * exacto (`ensureDecisionOperationKey` ya fijó la MISMA `operationKey`
 * para ambas, ver `repository.ts`) — nunca se reintenta con una clave
 * nueva, se reconcilia releyendo el Meeting real (ver esa función).
 * Cualquier otro 409 (incluido `meeting_decision_conflict`, ya traducido a
 * `null` por `putDecide()`), y cualquier 401/403/404/5xx/error de
 * red/parseo, deben seguir propagándose sin pasar por aquí.
 */
export function isIdempotencyKeyReusedConflict(error: unknown): error is EspoApiError {
  return error instanceof EspoApiError && error.status === 409 && error.body === IDEMPOTENCY_KEY_REUSED_BODY
}

function toTreatmentFixture(row: TreatmentRecord): TreatmentFixture {
  return {
    id: row.id,
    name: row.name,
    familia: row.familia,
    durationMinutes: row.duracionMinutos,
    precioOrientativo: row.precioOrientativo ?? null,
    estadoPrecio: row.estadoPrecio ?? null,
  }
}

function toZoneFixture(row: ZoneRecord): ZoneFixture {
  return { id: row.id, name: row.name, capacidadSimultanea: row.capacidadSimultanea }
}

function toProfessionalFixture(row: UserRecord): ProfessionalFixture {
  return { id: row.id, name: row.name ?? row.id, active: row.isActive }
}

function toSimContact(row: ContactRecord): SimContact {
  return {
    id: row.id,
    gapssaAccountId: row[CONTACT_GAPSSA_ACCOUNT_ID_FIELD] ?? null,
    firstName: row.firstName ?? '',
    lastName: row.lastName ?? '',
    email: row.emailAddress ?? '',
    phone: row.phoneNumber ?? '',
  }
}

function toSimMeeting(row: MeetingRecord): SimMeeting {
  // cEstadoReserva puede ser null en Meetings reales fuera del flujo del
  // portal (docs/espocrm-modelo-inicial.md) — nunca alcanzable para un
  // Meeting creado por este adaptador (siempre lo fija explícitamente),
  // pero listAllMeetings/listActiveMeetingsOverlapping sí pueden leer
  // Meetings ajenos al portal. Se representa como 'RequestReceived' (el
  // valor menos comprometido: no ocupa horario en NON_OCCUPYING_ESTADOS_RESERVA
  // ni se malinterpreta como decidido) mientras el contrato exija un valor
  // no nulo — documentado, no silencioso.
  const cEstadoReserva = row.cEstadoReserva ?? 'RequestReceived'
  return {
    id: row.id,
    // Revisión 2 de Fase 4B, punto 2: la lista COMPLETA de contactsIds —
    // nunca solo el primero. Un Meeting real ajeno al portal puede llegar
    // aquí con 0 o varios Contacts relacionados; decidir qué hacer con esa
    // multiplicidad es responsabilidad del llamante
    // (`evaluateContactAdoption`, `espoAdapter.ts`), nunca de este mapeo.
    contactIds: row.contactsIds ?? [],
    bookingRequestId: row.cBookingRequestId ?? '',
    treatmentId: row.cTratamientoId ?? '',
    professionalId: row.assignedUserId ?? '',
    zoneId: row.cZonaAtencionId ?? '',
    startAt: parseEspoDateTime(row.dateStart),
    endAt: parseEspoDateTime(row.dateEnd),
    cEstadoReserva,
    status: row.status,
    decidedBy: row.modifiedById ?? null,
    decidedAt: row.modifiedAt ? new Date(row.modifiedAt) : null,
    note: row.description ?? null,
    resolutionReason: row.cMotivoResolucionReserva ?? null,
    // Puerta 5B-2A: nunca `true` por ausencia/`null` — solo `true` cuando
    // EspoCRM lo confirma explícitamente en la respuesta (ver
    // `createMeeting`, que trata la ausencia como no verificable, nunca
    // como éxito inventado).
    cExcluirGoogleCalendarSync: row.cExcluirGoogleCalendarSync ?? false,
  }
}

/** EspoCRM 10 valida DateTime en `YYYY-MM-DD HH:mm:ss` (UTC), no en ISO 8601 con `T`/milisegundos/`Z`. */
export function formatEspoDateTime(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('Fecha inválida para EspoCRM.')
  }
  return value.toISOString().slice(0, 19).replace('T', ' ')
}

/** Las respuestas DateTime de EspoCRM no llevan offset; el contrato de su API las expresa en UTC. */
export function parseEspoDateTime(value: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
  return new Date(normalized)
}
