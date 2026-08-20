import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { findAccountById, requestAccountDeletion } from '@/server/auth/repository'
import { clearSessionCookies, getActiveSessionFromCookies } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

/**
 * Solicitud de eliminación de cuenta — bloquea el acceso de inmediato
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §15.1). No elimina ni anonimiza nada
 * todavía: Gapssa revisa manualmente qué información debe conservarse
 * legalmente antes de completar la eliminación — eso queda fuera del
 * alcance de esta fase, es trabajo operativo posterior sobre la cuenta ya
 * marcada como `pending_deletion`.
 */
export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const session = await getActiveSessionFromCookies()
  if (!session) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const account = await findAccountById(session.accountId)
  if (!account) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  // Revisión 5 de Fase 3: la transición a `pending_deletion` y la
  // revocación de TODAS las sesiones activas (incluida la actual) se
  // confirman en una única transacción (`requestAccountDeletion`,
  // repository.ts) — nunca una cuenta `pending_deletion` con sesiones
  // antiguas todavía válidas, ni siquiera si el proceso cae justo después
  // de escribir el nuevo estado. Borrar la cookie de este navegador ocurre
  // después del commit, y es en sí mismo idempotente/repetible sin riesgo.
  await requestAccountDeletion(account.id)
  await clearSessionCookies()

  return jsonResponse({ status: 'pending_deletion' })
}
