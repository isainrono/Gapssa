import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { clearSessionCookies, getActiveSessionFromCookies, revokeSessionById } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

/** Cierra una sesión propia concreta (la actual o cualquier otro dispositivo activo). Idempotente: revocar una sesión ya revocada/inexistente también responde 200. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const currentSession = await getActiveSessionFromCookies()
  if (!currentSession) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const { id: targetSessionId } = await params
  await revokeSessionById(targetSessionId, currentSession.accountId, 'user_revoked_other_session')

  if (targetSessionId === currentSession.id) {
    await clearSessionCookies()
  }

  return jsonResponse({ status: 'ok' })
}
