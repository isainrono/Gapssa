import 'server-only'

/**
 * Vinculación de una cuenta del portal con un `Contact` de EspoCRM.
 *
 * **Alcance de esta fase**: interfaz + adaptador simulado únicamente. Esta
 * fase no realiza ninguna llamada HTTP a la instancia real de EspoCRM — la
 * tarea lo prohíbe explícitamente hasta que el propietario del proyecto
 * apruebe una implementación real. La recomendación concreta (API User,
 * mecanismo de autenticación, permisos mínimos, búsqueda/vinculación
 * idempotente, tratamiento de coincidencias múltiples, reconciliación tras
 * fallos parciales) está en `docs/fase3-autenticacion.md` §6, no en código.
 *
 * Regla de negocio que sí se aplica ya, incluso con el adaptador simulado
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6.3): **ninguna coincidencia, sea única
 * o múltiple, se vincula automáticamente**. Cualquier candidato encontrado
 * deja la cuenta en `espoLinkStatus = "pending_review"`, nunca `"linked"`
 * — pasar a `"linked"` es, por diseño, una acción manual de Gapssa que
 * esta fase ni siquiera expone todavía.
 *
 * Revisión 4 de Fase 3: este módulo ya solo contiene la decisión pura
 * (`decideEspoLinkAction`) y el adaptador — la escritura en
 * `client_accounts`/`auth_audit_log` que antes hacía
 * `evaluateEspoLinkForNewAccount` (una operación Postgres suelta, fuera de
 * cualquier transacción, ejecutada síncronamente justo después de activar
 * la cuenta) vive ahora en `outbox.ts`, como el procesador de un trabajo
 * encolado atómicamente con la activación — ver el razonamiento completo
 * ahí y en `docs/fase3-autenticacion.md` §6/§2.2 (outbox).
 */

export interface EspoContactSearchResult {
  contactId: string
  matchedBy: 'email' | 'phone'
}

export interface EspoLinkAdapter {
  searchCandidateContacts(criteria: { email: string; phone?: string }): Promise<EspoContactSearchResult[]>
}

/**
 * Adaptador simulado. Sin `fixtures`, siempre devuelve "sin candidatos" —
 * refleja honestamente que no hay conectividad real con EspoCRM en esta
 * fase, en vez de fingir una búsqueda. `fixtures` existe únicamente para
 * que las pruebas puedan ejercitar los caminos de 1 y N candidatos sin
 * depender de una instancia real (ver
 * `tests/integration/auth.espoLink.int.test.ts`).
 */
export class SimulatedEspoLinkAdapter implements EspoLinkAdapter {
  constructor(private readonly fixtures: Map<string, EspoContactSearchResult[]> = new Map()) {}

  async searchCandidateContacts(criteria: { email: string }): Promise<EspoContactSearchResult[]> {
    return this.fixtures.get(criteria.email.toLowerCase()) ?? []
  }
}

export type EspoLinkDecision =
  | { kind: 'no_match' }
  | { kind: 'single_match'; contactId: string }
  | { kind: 'ambiguous_match'; contactIds: string[] }

/**
 * Pura, sin efectos: decide qué acción corresponde a un conjunto de
 * candidatos. Nunca devuelve una acción de fusión/vinculación automática.
 */
export function decideEspoLinkAction(candidates: EspoContactSearchResult[]): EspoLinkDecision {
  const uniqueContactIds = [...new Set(candidates.map((candidate) => candidate.contactId))]

  if (uniqueContactIds.length === 0) {
    return { kind: 'no_match' }
  }
  if (uniqueContactIds.length === 1) {
    return { kind: 'single_match', contactId: uniqueContactIds[0] as string }
  }
  return { kind: 'ambiguous_match', contactIds: uniqueContactIds }
}
