import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { getActiveSessionFromCookies } from '@/server/auth/session'
import { verifyBookingRequestAccessToken } from '@/server/booking/accessToken'
import { findBookingRequestById } from '@/server/booking/repository'

export const dynamic = 'force-dynamic'

/**
 * Estado opaco de una solicitud de reserva — encargo de Fase 4A, punto 9.
 * Autoriza de dos formas, nunca por el `id` a secas (un UUID visible en la
 * URL no basta):
 *
 * - Sesión activa cuyo `accountId` coincide con `clientAccountId` de la
 *   solicitud (cliente autenticado).
 * - Cabecera `X-Booking-Access-Token` válida para este `id` (invitado, sin
 *   sesión — mismo token que devolvió la creación/verificación).
 *
 * Nunca expone datos personales del invitado (PendingGuestIdentity no se
 * lee aquí en ningún caso) ni el `idempotencyKey`/`otpChallengeId`
 * internos.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const record = await findBookingRequestById(id)
  if (!record) {
    return errorResponse(404, 'not_found', 'Solicitud no encontrada.')
  }

  const session = await getActiveSessionFromCookies()
  const authorizedBySession = session !== null && record.clientAccountId === session.accountId

  const accessToken = request.headers.get('x-booking-access-token')
  const authorizedByToken =
    !record.clientAccountId && accessToken !== null && verifyBookingRequestAccessToken(id, record.accessTokenKeyVersion, accessToken)

  if (!authorizedBySession && !authorizedByToken) {
    return errorResponse(404, 'not_found', 'Solicitud no encontrada.')
  }

  return jsonResponse({
    requestId: record.id,
    status: record.status,
    resolution: record.resolution,
    reasonCode: record.reasonCode,
    treatmentId: record.treatmentId,
    professionalId: record.professionalId,
    zoneId: record.zoneId,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    verificationExpiresAt: record.verificationExpiresAt.toISOString(),
    approvalExpiresAt: record.approvalExpiresAt?.toISOString() ?? null,
  })
}
