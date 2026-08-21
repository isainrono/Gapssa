import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { APPROVAL_EXPIRED_TECHNICAL_NOTE } from '@gapssa/contracts'

/**
 * Servidor HTTP fake de EspoCRM — Fase 4B, punto 9. Cubre exactamente las
 * rutas que llama `HttpEspoBookingAdapter` (`src/server/booking/httpEspoAdapter.ts`),
 * con inyección de fallos programable (`queueFault`) para las pruebas
 * contractuales. Nunca es la instancia real de EspoCRM — vive solo en
 * memoria del proceso de pruebas, se crea y destruye por test.
 */

export interface FakeEspoRecord {
  id: string
  [key: string]: unknown
}

export interface Fault {
  /** Si se define, la respuesta se retrasa este número de ms antes de responder (o de no responder nunca, si excede el timeout del cliente). */
  delayMs?: number
  /** Si se define, responde con este status en vez del comportamiento normal. */
  status?: number
  /** Cuerpo crudo de la respuesta de fallo — si no es JSON válido, se usa para probar el manejo de "JSON inválido". */
  rawBody?: string
}

interface RequestLogEntry {
  method: string
  path: string
  query: string
  headers: Record<string, string | string[] | undefined>
}

export class FakeEspoServer {
  readonly treatments: FakeEspoRecord[] = []
  readonly zones: FakeEspoRecord[] = []
  readonly users: FakeEspoRecord[] = []
  readonly contacts: FakeEspoRecord[] = []
  readonly meetings: FakeEspoRecord[] = []

  readonly requestLog: RequestLogEntry[] = []

  /**
   * "Fase 4B — flujo de decisión final": réplica mínima pero fiel de la
   * tabla de idempotencia de `PutDecide.php`
   * (`gapssa_meeting_decision_operation`) — misma clave -> mismo payload
   * repite el resultado ya confirmado; misma clave -> payload distinto,
   * 409 `idempotency_key_reused`. Nunca se limpia entre peticiones del
   * mismo servidor fake (mismo ciclo de vida que la tabla real dentro de
   * una instancia EspoCRM: sobrevive mientras el proceso vive).
   */
  private readonly decisionOperations = new Map<string, { payloadHash: string; resultHttpStatus: number; resultBody: unknown }>()

  /** Fallos programados por `METHOD path` exacto (p. ej. `"GET /api/v1/Meeting"`) — se consumen una vez, en orden FIFO. */
  private readonly faultQueue = new Map<string, Fault[]>()

  private server: Server | null = null
  port = 0
  readonly apiKey: string

  /**
   * Puerta 3C (propuesta, `docs/fase4b-puerta3c-meeting-name-acl.md`):
   * `Portal GAPSSA API` tiene `Meeting.name` en `{read: no, edit: yes}` —
   * puede escribirlo al crear (si no, `400 validationFailure field=name`,
   * ver `handleMeetingNameValidation`) pero EspoCRM nunca lo devuelve en
   * ninguna respuesta para ese actor. `true` por defecto: el fake
   * reproduce el estado objetivo de la Puerta 3C, no el bloqueo previo
   * (que ya se demostró y no necesita repetirse en cada prueba). Pruebas
   * que necesiten reproducir el bloqueo original (`name` ausente) siguen
   * pudiendo hacerlo omitiendo `name` del payload — ver
   * `handleMeetingNameValidation`.
   */
  hideMeetingNameInResponses = true

  /**
   * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas: réplica del
   * ACL de campo `Meeting.cExcluirGoogleCalendarSync = {edit: no}` para
   * `Portal GAPSSA API` (Puerta 6, `docs/fase4b-puerta6-exclusion-gcs.md`
   * §6/§11.4, confirmado en la instancia real por la Puerta 5B-1) — un
   * `POST`/`PUT` que incluya el campo lo ve silenciosamente descartado
   * (comportamiento real de ACL de campo de EspoCRM: nunca un error, el
   * resto de la escritura se aplica igual). `false` por defecto (mismo
   * estado que el resto de este fake antes de esta subpuerta); las pruebas
   * dedicadas a la relectura-nunca-inventa-`true` de
   * `HttpEspoBookingAdapter.createMeeting` lo activan explícitamente.
   */
  blockGcsExclusionFieldWrites = false

  constructor(apiKey = `test-api-key-${randomUUID()}`) {
    this.apiKey = apiKey
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => this.handle(req, res))
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('No se pudo determinar el puerto del servidor fake de EspoCRM.')
    }
    this.port = address.port
    return `http://127.0.0.1:${this.port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()))
    })
  }

  /** Encola un fallo para la próxima petición que coincida exactamente con `"METHOD path"` (sin querystring). */
  queueFault(methodAndPath: string, fault: Fault): void {
    const queue = this.faultQueue.get(methodAndPath) ?? []
    queue.push(fault)
    this.faultQueue.set(methodAndPath, queue)
  }

  private takeFault(methodAndPath: string): Fault | null {
    const queue = this.faultQueue.get(methodAndPath)
    if (!queue || queue.length === 0) return null
    return queue.shift() ?? null
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
    const method = req.method ?? 'GET'
    const path = url.pathname

    this.requestLog.push({ method, path, query: url.search, headers: { ...req.headers } })

    const fault = this.takeFault(`${method} ${path}`)
    if (fault) {
      if (fault.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, fault.delayMs))
      }
      res.writeHead(fault.status ?? 500, { 'Content-Type': 'application/json' })
      res.end(fault.rawBody ?? JSON.stringify({ message: 'Fallo inyectado por la prueba.' }))
      return
    }

    if (req.headers['x-api-key'] !== this.apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Unauthorized' }))
      return
    }

    const body = await this.readJsonBody(req)

    try {
      this.route(method, path, url.searchParams, body, res)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Error interno del fake.' }))
    }
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    if (req.method === 'GET') return undefined
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const raw = Buffer.concat(chunks).toString('utf-8')
    if (raw.length === 0) return undefined
    return JSON.parse(raw)
  }

  private route(method: string, path: string, query: URLSearchParams, body: unknown, res: ServerResponse): void {
    const send = (status: number, payload: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(payload === undefined ? '' : JSON.stringify(payload))
    }
    /**
     * Réplica fiel de `Espo\Core\Api\ErrorOutput::printBody()` para una
     * excepción `HasBody` (`Conflict::createWithBody($mensaje, $body)`):
     * el `$body` se escribe TAL CUAL, sin serializar a JSON — a diferencia
     * de `send()`, que siempre produce JSON. Usado exclusivamente para el
     * 409 `idempotency_key_reused` de `handleDecision` (ver su cabecera):
     * si esto enviara JSON en vez de texto plano, la prueba contractual no
     * detectaría una regresión en el fallback de `httpEspoAdapter.ts::request()`
     * que lee el cuerpo crudo cuando `JSON.parse` falla.
     */
    const sendRaw = (status: number, statusReason: string, rawBody: string): void => {
      res.writeHead(status, { 'Content-Type': 'text/plain', 'X-Status-Reason': statusReason })
      res.end(rawBody)
    }

    const collectionMatch = /^\/api\/v1\/(CTratamiento|CZonaAtencion|User|Contact|Meeting)$/.exec(path)
    const recordMatch = /^\/api\/v1\/(CTratamiento|CZonaAtencion|User|Contact|Meeting)\/([^/]+)$/.exec(path)
    const contactsRelateMatch = /^\/api\/v1\/Meeting\/([^/]+)\/contacts$/.exec(path)
    const decisionMatch = /^\/api\/v1\/GapssaMeetingDecision\/([^/]+)$/.exec(path)

    if (method === 'PUT' && decisionMatch) {
      this.handleDecision(decisionMatch[1]!, body, send, sendRaw)
      return
    }

    if (method === 'GET' && collectionMatch) {
      const collection = this.collectionFor(collectionMatch[1]!)
      const filtered = applyWhere(collection, query)
      const offset = Number(query.get('offset') ?? '0')
      const maxSize = Number(query.get('maxSize') ?? '200')
      const list = filtered.slice(offset, offset + maxSize).map((r) => this.withMeetingNameVisibility(collectionMatch[1]!, r))
      send(200, { total: filtered.length, list })
      return
    }

    if (method === 'GET' && recordMatch) {
      const collection = this.collectionFor(recordMatch[1]!)
      const record = collection.find((r) => r.id === recordMatch[2])
      if (!record) {
        send(404, { message: 'Not Found' })
        return
      }
      send(200, this.withMeetingNameVisibility(recordMatch[1]!, record))
      return
    }

    if (method === 'POST' && collectionMatch && collectionMatch[1] !== 'User') {
      const collection = this.collectionFor(collectionMatch[1]!)
      const payload = body as Record<string, unknown>

      // Puerta 5A, causa raíz confirmada contra la instancia real
      // (`gapssa-espocrm-1`, HTTP 400 real, ver
      // `docs/fase4b-puerta5-propuesta-v3.md`): `Meeting.name` es
      // obligatorio en el propio entity def de EspoCRM,
      // INDEPENDIENTEMENTE del ACL de campo del actor — un `Portal GAPSSA
      // API` con `name` en `read:no/edit:no` (bloqueo original) o
      // `read:no/edit:yes` (Puerta 3C) sigue necesitando enviar un valor
      // no vacío. Réplica exacta del cuerpo real:
      // `{"messageTranslation":{"label":"validationFailure","scope":null,"data":{"field":"name","type":"required"}}}`.
      if (collectionMatch[1] === 'Meeting' && (typeof payload.name !== 'string' || payload.name.trim() === '')) {
        send(400, { messageTranslation: { label: 'validationFailure', scope: null, data: { field: 'name', type: 'required' } } })
        return
      }

      // Simula el índice único recomendado (Fase 4B, punto 4) sobre
      // `Meeting.cBookingRequestId` — NO existe todavía en la instancia
      // real (documentado, no aplicado), pero el fake lo enforza para
      // poder probar que `HttpEspoBookingAdapter.createMeeting` se
      // recupera correctamente (busca y adopta) cuando la creación choca
      // con una carrera concurrente, en vez de asumir que nunca ocurre.
      if (collectionMatch[1] === 'Meeting' && typeof payload.cBookingRequestId === 'string') {
        const clash = this.meetings.find((m) => m.cBookingRequestId === payload.cBookingRequestId)
        if (clash) {
          send(409, { message: 'cBookingRequestId ya existe (índice único simulado).' })
          return
        }
      }

      const record: FakeEspoRecord = { id: randomUUID(), ...payload }
      // Puerta 5B-2A: mismo comportamiento real que un ACL de campo
      // `edit:no` — el campo llega en el payload pero EspoCRM nunca lo
      // persiste, sin devolver ningún error (ver `blockGcsExclusionFieldWrites`).
      if (collectionMatch[1] === 'Meeting' && this.blockGcsExclusionFieldWrites) {
        delete record.cExcluirGoogleCalendarSync
      }
      collection.push(record)
      send(200, this.withMeetingNameVisibility(collectionMatch[1]!, record))
      return
    }

    if (method === 'POST' && contactsRelateMatch) {
      const meeting = this.meetings.find((m) => m.id === contactsRelateMatch[1])
      if (!meeting) {
        send(404, { message: 'Not Found' })
        return
      }
      const contactId = (body as { id: string }).id
      const existing = (meeting.contactsIds as string[] | undefined) ?? []
      meeting.contactsIds = existing.includes(contactId) ? existing : [...existing, contactId]
      send(200, { id: contactId })
      return
    }

    if (method === 'PUT' && recordMatch) {
      const collection = this.collectionFor(recordMatch[1]!)
      const record = collection.find((r) => r.id === recordMatch[2])
      if (!record) {
        send(404, { message: 'Not Found' })
        return
      }
      const payload = body as Record<string, unknown>
      // Simula `GuardMeetingDecisionTransition`: el `PUT` genérico nunca
      // puede mover `cEstadoReserva` hacia Confirmed/Canceled — solo la
      // acción atómica `GapssaMeetingDecision` (`handleDecision`) puede.
      // Prueba de contrato: "adaptador HTTP nunca usa PUT genérico para
      // decidir" — si alguna vez lo intentara, el fake lo rechaza igual
      // que lo haría la instancia real.
      if (
        recordMatch[1] === 'Meeting' &&
        typeof payload.cEstadoReserva === 'string' &&
        (payload.cEstadoReserva === 'Confirmed' || payload.cEstadoReserva === 'Canceled') &&
        payload.cEstadoReserva !== record.cEstadoReserva
      ) {
        send(409, { message: 'meeting_decision_requires_atomic_action', reason: 'meeting_decision_requires_atomic_action' })
        return
      }
      Object.assign(record, payload, { modifiedById: 'fake-modifier', modifiedAt: new Date().toISOString() })
      send(200, this.withMeetingNameVisibility(recordMatch[1]!, record))
      return
    }

    send(404, { message: `Ruta no soportada por el fake: ${method} ${path}` })
  }

  /**
   * Réplica del contrato de `PutDecide.php` (validación de
   * decision/resultReason/note, idempotencia por operationKey con
   * comparación de payload, CAS vía `cEstadoReserva === 'PendingCenterApproval'`)
   * — suficientemente fiel para probar el adaptador HTTP sin necesitar la
   * instancia real de EspoCRM. No reproduce el lock de fila real (el fake
   * es de un solo hilo, no hay carrera posible dentro de un mismo proceso
   * Node) ni la transacción SQL — esas garantías se demuestran en el
   * ensayo contra la instancia EspoCRM desechable
   * (`docs/fase4b-decision-flow-final.md` §9), no aquí.
   */
  private handleDecision(
    meetingId: string,
    body: unknown,
    send: (status: number, payload: unknown) => void,
    sendRaw: (status: number, statusReason: string, rawBody: string) => void,
  ): void {
    const payload = (body ?? {}) as { decision?: unknown; resultReason?: unknown; note?: unknown; operationKey?: unknown }
    const { decision, resultReason, note, operationKey } = payload

    if (decision !== 'Confirmed' && decision !== 'Canceled') {
      send(400, { message: 'decision debe ser Confirmed o Canceled.' })
      return
    }
    const compatibleReasons: Record<'Confirmed' | 'Canceled', string[]> = {
      Confirmed: ['Approved'],
      Canceled: ['RejectedByStaff', 'ApprovalExpired'],
    }
    if (typeof resultReason !== 'string' || !compatibleReasons[decision].includes(resultReason)) {
      send(400, { message: 'resultReason incompatible con decision.' })
      return
    }
    if (note !== undefined && typeof note !== 'string') {
      send(400, { message: 'note inválida.' })
      return
    }
    if (resultReason === 'RejectedByStaff' && (typeof note !== 'string' || note.trim() === '')) {
      send(400, { message: 'note obligatoria y no vacía para RejectedByStaff.' })
      return
    }
    if (resultReason === 'ApprovalExpired' && note !== undefined && note !== APPROVAL_EXPIRED_TECHNICAL_NOTE) {
      send(400, { message: 'note inválida para ApprovalExpired — solo la nota técnica prevista o ninguna.' })
      return
    }
    if (typeof operationKey !== 'string' || operationKey === '' || operationKey.length > 128 || !/^[A-Za-z0-9_-]+$/.test(operationKey)) {
      send(400, { message: 'operationKey requerida (alfanumérica, guiones/guion bajo, hasta 128 caracteres).' })
      return
    }

    const payloadHash = JSON.stringify({ meetingId, decision, resultReason, note: note ?? null })
    const existingOperation = this.decisionOperations.get(operationKey)
    if (existingOperation) {
      if (existingOperation.payloadHash !== payloadHash) {
        // Réplica fiel del wire format real (ver `sendRaw` más arriba):
        // cuerpo de texto plano `idempotency_key_reused`, nunca JSON.
        sendRaw(409, 'operationKey ya usada con un payload distinto.', 'idempotency_key_reused')
        return
      }
      // Misma clave, mismo payload — replay del resultado ya confirmado,
      // sin volver a tocar el Meeting.
      send(existingOperation.resultHttpStatus, existingOperation.resultBody)
      return
    }

    const meeting = this.meetings.find((m) => m.id === meetingId)
    if (!meeting) {
      send(404, { message: 'Not Found' })
      return
    }

    if (meeting.cEstadoReserva !== 'PendingCenterApproval') {
      const responseBody = {
        status: 'conflict',
        reason: 'meeting_decision_conflict',
        meetingId,
        existingCEstadoReserva: meeting.cEstadoReserva,
      }
      this.decisionOperations.set(operationKey, { payloadHash, resultHttpStatus: 409, resultBody: responseBody })
      send(409, responseBody)
      return
    }

    meeting.cEstadoReserva = decision
    meeting.cMotivoResolucionReserva = resultReason
    meeting.status = decision === 'Confirmed' ? 'Planned' : 'Not Held'
    if (note !== undefined) {
      meeting.description = note
    }
    meeting.modifiedById = 'fake-modifier'
    meeting.modifiedAt = new Date().toISOString()

    const responseBody = {
      status: 'confirmed',
      meetingId,
      cEstadoReserva: meeting.cEstadoReserva,
      cMotivoResolucionReserva: meeting.cMotivoResolucionReserva,
      meetingStatus: meeting.status,
      modifiedById: meeting.modifiedById,
      modifiedAt: meeting.modifiedAt,
    }
    this.decisionOperations.set(operationKey, { payloadHash, resultHttpStatus: 200, resultBody: responseBody })
    send(200, responseBody)
  }

  /**
   * `Meeting.name` con `read:no` (bloqueo original y Puerta 3C, ambos):
   * EspoCRM nunca lo incluye en ninguna respuesta para `Portal GAPSSA
   * API`, aunque el valor sí exista en la fila real (`this.meetings`
   * conserva `name` sin cambios — esto solo afecta lo que se envía por
   * HTTP). No muta el registro almacenado.
   */
  private withMeetingNameVisibility(entity: string, record: FakeEspoRecord): FakeEspoRecord {
    if (entity !== 'Meeting' || !this.hideMeetingNameInResponses) {
      return record
    }
    const { name: _name, ...withoutName } = record
    return withoutName as FakeEspoRecord
  }

  private collectionFor(entity: string): FakeEspoRecord[] {
    switch (entity) {
      case 'CTratamiento':
        return this.treatments
      case 'CZonaAtencion':
        return this.zones
      case 'User':
        return this.users
      case 'Contact':
        return this.contacts
      case 'Meeting':
        return this.meetings
      default:
        throw new Error(`Entidad no soportada por el fake: ${entity}`)
    }
  }
}

/** Interpreta el subconjunto de la sintaxis `where[n][...]` de EspoCRM que usa `httpEspoAdapter.ts` — equals/notIn/lessThan/greaterThan. */
function applyWhere(collection: FakeEspoRecord[], query: URLSearchParams): FakeEspoRecord[] {
  const clauses: { type: string; attribute: string; value: string | string[] }[] = []
  let i = 0
  for (;;) {
    const type = query.get(`where[${i}][type]`)
    const attribute = query.get(`where[${i}][attribute]`)
    if (!type || !attribute) break
    const multi0 = query.get(`where[${i}][value][0]`)
    if (multi0 !== null) {
      const values: string[] = []
      let j = 0
      for (;;) {
        const v = query.get(`where[${i}][value][${j}]`)
        if (v === null) break
        values.push(v)
        j++
      }
      clauses.push({ type, attribute, value: values })
    } else {
      clauses.push({ type, attribute, value: query.get(`where[${i}][value]`) ?? '' })
    }
    i++
  }

  return collection.filter((record) =>
    clauses.every((clause) => {
      const fieldValue = record[clause.attribute]
      switch (clause.type) {
        case 'equals':
          return String(fieldValue ?? '') === clause.value
        case 'notIn':
          return !(clause.value as string[]).includes(String(fieldValue ?? ''))
        case 'lessThan':
          return fieldValue !== undefined && new Date(String(fieldValue)).getTime() < new Date(clause.value as string).getTime()
        case 'greaterThan':
          return fieldValue !== undefined && new Date(String(fieldValue)).getTime() > new Date(clause.value as string).getTime()
        default:
          return true
      }
    }),
  )
}
