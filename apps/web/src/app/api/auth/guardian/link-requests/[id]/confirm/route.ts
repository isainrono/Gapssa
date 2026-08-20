import { confirmGuardianLink } from '@/server/auth/guardian'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { getActiveSessionFromCookies } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

/**
 * Solo el propio menor puede confirmar el vínculo con un tutor — nunca el
 * tutor ni un tercero. La auditoría (`GuardianLinkConfirmed`) se confirma
 * atómicamente con la transición dentro de `confirmGuardianLink`
 * (guardian.ts, revisión 4 de Fase 3) — no se audita aquí, después del
 * commit.
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
  const outcome = await confirmGuardianLink(id, session.accountId, new Date())

  switch (outcome) {
    case 'confirmed':
      return jsonResponse({ status: 'active' })
    case 'not_found':
      return errorResponse(404, 'not_found', 'Solicitud no encontrada.')
    case 'not_pending':
      return errorResponse(409, 'not_pending', 'Esta solicitud ya no está pendiente de confirmación.')
    case 'target_not_eligible':
      return errorResponse(
        409,
        'target_not_eligible',
        'Tu cuenta ya no cumple las condiciones para confirmar este vínculo de tutela.',
      )
  }
}
