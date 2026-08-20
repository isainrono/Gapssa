import 'server-only'

/**
 * Guarda de seguridad contra el incidente documentado en
 * `docs/fase4b-integracion-http.md` §1 ("Incidente durante la auditoría"):
 * una consulta `GET /User` sin `select=` devolvió, y se imprimió por
 * error en una conversación, nombre/correo/teléfono reales de una
 * profesional. La causa exacta era estructural, no solo un descuido puntual:
 * `HttpEspoBookingAdapter.getById` (usado por `getProfessional`/`getMeetingById`
 * antes de esta revisión) nunca pasaba `select=` en absoluto — cualquier
 * llamada a un endpoint de registro único de EspoCRM devolvía TODOS los
 * campos del registro por defecto, PII incluida.
 *
 * `assertSafeEspoSelect` es la única puerta: se invoca dentro de
 * `HttpEspoBookingAdapter.request` (el punto único de salida HTTP del
 * adaptador, `httpEspoAdapter.ts`), ANTES de `fetch` — nunca después, y
 * nunca como una comprobación opcional que un llamante pueda saltarse.
 * Cualquier consulta a una entidad con PII (`User`/`Contact`) sin
 * `select=` explícito, o con campos fuera de la allowlist de esa entidad,
 * se rechaza sin llegar a la red.
 */

export const PII_ESPO_ENTITIES = ['User', 'Contact'] as const
export type PiiEspoEntity = (typeof PII_ESPO_ENTITIES)[number]

export class EspoPiiQuerySafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EspoPiiQuerySafetyError'
  }
}

/**
 * Allowlist de campos permitidos por entidad con PII — el límite de
 * "auditorías técnicas" que pide la Fase 4B, punto 7: ni siquiera el
 * propio adaptador puede pedir un campo fuera de esta lista para `User`/
 * `Contact`, exista o no un motivo operativo legítimo para ese campo
 * concreto. Añadir un campo nuevo exige tocar esta lista explícitamente,
 * nunca ampliarla implícitamente pasando otro valor de `select`.
 *
 * `Contact` incluye el nombre REAL confirmado del campo de cuenta Gapssa
 * (`CONTACT_GAPSSA_ACCOUNT_ID_FIELD`, `packages/contracts/src/booking.ts`)
 * — nunca el literal `"gapssaAccountId"` repetido aquí.
 */
export function espoPiiSelectAllowlist(contactAccountField: string): Record<PiiEspoEntity, ReadonlySet<string>> {
  return {
    // Solo lo estrictamente necesario para "¿es un profesional reservable
    // activo y cómo se muestra?" (catalog.ts, ProfessionalFixture) — nunca
    // correo/teléfono/tipo de cuenta.
    User: new Set(['id', 'name', 'isActive']),
    // Solo lo estrictamente necesario para el matching/creación de Contact
    // (findOrCreateContact) y la validación de identidad al adoptar un
    // Meeting (evaluateContactAdoption) — nunca más.
    Contact: new Set(['id', 'firstName', 'lastName', 'emailAddress', 'phoneNumber', contactAccountField]),
  }
}

function entityFromPath(path: string): PiiEspoEntity | null {
  // Cubre tanto la colección (`/api/v1/User`) como un registro
  // (`/api/v1/User/<id>`) — el mismo riesgo de sobre-exposición aplica a
  // ambos.
  const match = /^\/api\/v1\/(User|Contact)(?:\/|$)/.exec(path)
  if (!match) {
    return null
  }
  return match[1] as PiiEspoEntity
}

/**
 * Lanza `EspoPiiQuerySafetyError` si `path` apunta a una entidad con PII
 * (`User`/`Contact`) y la consulta no trae un `select` explícito, o trae
 * campos fuera de su allowlist. No-op para cualquier otra entidad
 * (`CTratamiento`/`CZonaAtencion`/`Meeting`) — esas no llevan PII de
 * persona alguna. `select` es, en la API de EspoCRM, un parámetro
 * exclusivo de `GET` (colección o registro único) — nunca aplica a
 * `POST`/`PUT`, así que esta guarda solo actúa sobre `GET` (el propio
 * incidente de PII de Fase 4B fue un `GET /User`). El cuerpo de un
 * `POST`/`PUT` es responsabilidad de quien lo construye, nunca de esta
 * guarda; la respuesta de esas llamadas igualmente nunca se registra (ver
 * cabecera del módulo).
 */
export function assertSafeEspoSelect(
  method: string,
  path: string,
  query: Record<string, string> | undefined,
  allowlist: Record<PiiEspoEntity, ReadonlySet<string>>,
): void {
  if (method !== 'GET') {
    return
  }

  const entity = entityFromPath(path)
  if (!entity) {
    return
  }

  const rawSelect = query?.select
  if (!rawSelect || rawSelect.trim().length === 0) {
    throw new EspoPiiQuerySafetyError(
      `Consulta a ${entity} sin "select" explícito — rechazada antes de llamar a la red (ver docs/fase4b-integracion-http.md §1, incidente de PII).`,
    )
  }

  const requested = rawSelect.split(',').map((field) => field.trim())
  const allowed = allowlist[entity]
  const disallowed = requested.filter((field) => !allowed.has(field))
  if (disallowed.length > 0) {
    throw new EspoPiiQuerySafetyError(
      `Consulta a ${entity} solicita campos fuera de la allowlist permitida: ${disallowed.join(', ')}.`,
    )
  }
}
