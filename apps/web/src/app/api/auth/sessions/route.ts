import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { getActiveSessionFromCookies, listActiveSessionsForAccount } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

/** Sesiones activas de la cuenta autenticada, para "sesiones activas y opción de cerrarlas" en `/mi-cuenta`. */
export async function GET() {
  const currentSession = await getActiveSessionFromCookies()
  if (!currentSession) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const sessions = await listActiveSessionsForAccount(currentSession.accountId)

  return jsonResponse({
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      isCurrent: session.id === currentSession.id,
    })),
  })
}
