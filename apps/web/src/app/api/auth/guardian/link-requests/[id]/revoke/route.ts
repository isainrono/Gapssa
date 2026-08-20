import { revokeGuardianLink } from '@/server/auth/guardian'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { getActiveSessionFromCookies } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

/**
 * El tutor o el propio menor pueden desvincular — nunca un tercero. La
 * auditoría (`GuardianLinkRevoked`) se confirma atómicamente con la
 * transición dentro de `revokeGuardianLink` (guardian.ts, revisión 4 de
 * Fase 3) — no se audita aquí, después del commit.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const session = await getActiveSessionFromCookies()
  if (!session) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const { id } = await params
  const outcome = await revokeGuardianLink(id, session.accountId, new Date())

  switch (outcome) {
    case 'revoked':
      return jsonResponse({ status: 'revoked' })
    case 'not_found':
      return errorResponse(404, 'not_found', 'Vínculo no encontrado.')
    case 'not_live':
      return errorResponse(409, 'not_live', 'Este vínculo ya no está activo.')
  }
}
