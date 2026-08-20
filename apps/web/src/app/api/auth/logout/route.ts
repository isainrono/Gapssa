import { recordEventAuditEvent } from '@/server/auth/audit'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { clearSessionCookies, getActiveSessionFromCookies, revokeSessionById } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

/** Idempotente: cerrar sesión sin tener una sesión activa también responde 200. */
export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const session = await getActiveSessionFromCookies()

  if (session) {
    await revokeSessionById(session.id, session.accountId, 'user_logout')
    await recordEventAuditEvent({
      entity: 'ClientAccount',
      entityId: session.accountId,
      actor: { type: 'user', id: session.accountId },
      channel: 'web',
      occurredAt: new Date().toISOString(),
      reasonCode: 'LogoutRequested',
    })
  }

  await clearSessionCookies()

  return jsonResponse({ status: 'ok' })
}
