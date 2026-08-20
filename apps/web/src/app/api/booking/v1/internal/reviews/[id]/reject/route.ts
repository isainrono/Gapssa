import { z } from 'zod'

import { errorResponse, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { isValidInternalApiSecret } from '@/server/booking/internalAuth'
import { rejectBookingReview } from '@/server/booking/review'

export const dynamic = 'force-dynamic'

/**
 * Rechaza una revisión manual pendiente — Fase 4B, revisión 2, punto 3:
 * un operador determina que el conflicto NO es resoluble (p. ej. los
 * candidatos corresponden a personas distintas). Terminal: resuelve la
 * `BookingRequestRecord` como `contact_review_rejected` y purga la
 * identidad pendiente (invitado o cliente autenticado) — nunca se reabre.
 * Endpoint interno, protegido por `X-Internal-Api-Secret`.
 */
const bodySchema = z.object({
  rejectedBy: z.string().min(1).max(200),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isValidInternalApiSecret(request)) {
    return errorResponse(401, 'unauthorized', 'Credencial interna inválida o ausente.')
  }

  const { id } = await params
  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const outcome = await rejectBookingReview(id, parsed.data.rejectedBy)

  switch (outcome) {
    case 'not_found':
      return errorResponse(404, 'not_found', 'No existe ninguna revisión pendiente para ese id.')
    case 'already_closed':
      return errorResponse(409, 'already_closed', 'La revisión ya estaba resuelta, rechazada, caducada o reemplazada.')
    case 'in_progress':
      // Revisión 3, punto 2: hay una reanudación en curso (`processing`) —
      // nunca se rechaza una revisión que otra petición tiene reclamada.
      return errorResponse(409, 'in_progress', 'Esta revisión está siendo reanudada por otra petición — reintenta en unos minutos.')
    case 'closed':
      return jsonResponse({ status: 'rejected' })
  }
}
