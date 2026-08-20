import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { isValidInternalApiSecret } from '@/server/booking/internalAuth'
import { getBookingReviewDetailForOperators } from '@/server/booking/review'

export const dynamic = 'force-dynamic'

/**
 * Detalle de UNA revisión manual — revisión 3 de Fase 4B, punto 5. El
 * listado (`GET /internal/reviews`) deliberadamente omite
 * `candidateContactIds`/`candidateMeetingIds`; este endpoint sí los
 * devuelve porque un operador ya identificó QUÉ revisión concreta quiere
 * investigar y necesita esos IDs OPACOS de EspoCRM para localizar las
 * fichas reales dentro de la propia EspoCRM (donde ya tiene permisos y
 * puede comparar los datos). Nunca nombre, correo, teléfono ni datos
 * clínicos — esta API BFF no duplica PII en ningún caso. Endpoint interno,
 * protegido por `X-Internal-Api-Secret`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isValidInternalApiSecret(request)) {
    return errorResponse(401, 'unauthorized', 'Credencial interna inválida o ausente.')
  }

  const { id } = await params
  const review = await getBookingReviewDetailForOperators(id)
  if (!review) {
    return errorResponse(404, 'not_found', 'No existe ninguna revisión con ese id.')
  }

  return jsonResponse({
    review: {
      reviewId: review.id,
      bookingRequestId: review.bookingRequestId,
      conflictType: review.conflictType,
      candidateContactIds: review.candidateContactIds,
      candidateMeetingIds: review.candidateMeetingIds,
      status: review.status,
      createdAt: review.createdAt,
      resolvedAt: review.resolvedAt,
      expiresAt: review.expiresAt,
    },
  })
}
