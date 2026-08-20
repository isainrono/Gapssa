import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { isValidInternalApiSecret } from '@/server/booking/internalAuth'
import { listPendingReviewsForOperators } from '@/server/booking/review'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** `NaN`/negativos/fuera de rango se sustituyen por el valor por defecto — nunca se propaga un parámetro de query sin validar hacia la consulta de Postgres. */
function parsePaginationParam(raw: string | null, fallback: number, max: number): number {
  if (raw === null) {
    return fallback
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Math.min(parsed, max)
}

/**
 * Lista revisiones manuales pendientes (`BookingReviewRecord`) — Fase 4B,
 * revisión 2, punto 3; paginación de revisión 3, punto 5. Endpoint interno,
 * protegido por `X-Internal-Api-Secret`, nunca alcanzable desde el
 * navegador ni desde código cliente de `apps/web`. Devuelve SOLO
 * `id`/`bookingRequestId`/`conflictType`/`createdAt`/`expiresAt` — nunca
 * `candidateContactIds`/`candidateMeetingIds` (esos solo en el detalle de
 * UNA revisión, `GET /internal/reviews/{id}`) ni ningún dato personal: el
 * operador localiza los candidatos reales dentro de la propia EspoCRM, no
 * aquí.
 */
export async function GET(request: Request) {
  if (!isValidInternalApiSecret(request)) {
    return errorResponse(401, 'unauthorized', 'Credencial interna inválida o ausente.')
  }

  const url = new URL(request.url)
  const limit = parsePaginationParam(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT)
  const offset = parsePaginationParam(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER)

  const { reviews, total } = await listPendingReviewsForOperators(limit, offset)
  return jsonResponse({ reviews, total, limit, offset })
}
