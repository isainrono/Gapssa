import { z } from 'zod'

import { errorResponse, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { getEspoBookingAdapter } from '@/server/booking/adapterSelector'
import { isValidInternalApiSecret } from '@/server/booking/internalAuth'
import { resolveBookingReview } from '@/server/booking/review'

export const dynamic = 'force-dynamic'

/**
 * Resuelve una revisión manual pendiente (`BookingReviewRecord`) — Fase
 * 4B, revisión 2, punto 3. Un operador autorizado, tras localizar los
 * candidatos reales DENTRO de EspoCRM (nunca a partir de lo que expone
 * esta API), elige de forma inequívoca el `resolutionContactId` correcto.
 * Endpoint interno, protegido por `X-Internal-Api-Secret` — nunca
 * alcanzable desde el navegador ni desde código cliente de `apps/web`.
 * `resolvedBy` identifica al operador (nunca se infiere del secreto
 * compartido, que solo prueba "es un sistema interno autorizado", no
 * quién exactamente).
 */
const bodySchema = z.object({
  resolutionContactId: z.string().min(1),
  resolvedBy: z.string().min(1).max(200),
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

  const adapter = getEspoBookingAdapter()
  const outcome = await resolveBookingReview(adapter, id, parsed.data.resolutionContactId, parsed.data.resolvedBy)

  switch (outcome.outcome) {
    case 'not_found':
      return errorResponse(404, 'not_found', 'No existe ninguna revisión pendiente para ese id.')
    case 'already_closed':
      return errorResponse(409, 'already_closed', 'La revisión ya estaba resuelta, rechazada, caducada o reemplazada.')
    case 'in_progress':
      // Revisión 3, punto 2: otra reanudación tiene el claim vigente —
      // nunca un error del operador, reintentar más tarde (el lease dura
      // pocos minutos).
      return errorResponse(409, 'in_progress', 'Esta revisión ya está siendo reanudada por otra petición — reintenta en unos minutos.')
    case 'invalid_contact_id_format':
      return errorResponse(400, 'invalid_contact_id_format', 'resolutionContactId no tiene un formato válido.')
    case 'contact_not_found':
      return errorResponse(409, 'contact_not_found', 'No existe ningún Contact real con ese id en EspoCRM.')
    case 'contact_not_a_candidate':
      return errorResponse(
        409,
        'contact_not_a_candidate',
        'resolutionContactId no pertenece a los candidatos detectados para esta revisión — nunca se acepta un Contact arbitrario.',
      )
    case 'contact_details_unavailable':
      return errorResponse(
        409,
        'contact_details_unavailable',
        'La identidad del cliente ya no está disponible (purgada o caducada) — no se puede reanudar.',
      )
    case 'incompatible_meeting':
      return errorResponse(
        409,
        'incompatible_meeting',
        'El Meeting ya no es compatible con la solicitud — se abrió una revisión de inconsistencia (meeting_incompatible).',
      )
    case 'transient_failure':
      // Fallo transitorio (p. ej. EspoCRM caído a mitad de la reanudación)
      // — la revisión volvió a `pending`, reclamable de inmediato; nunca se
      // perdió.
      return errorResponse(503, 'transient_failure', 'Fallo transitorio al reanudar — la revisión sigue pendiente, reintenta.')
    case 'review_lease_lost':
      // Revisión 4, punto 1: esta llamada dejó de ser propietaria de la
      // revisión (otro worker la reclamó, o su lease venció y fue
      // recuperado) antes de completar el cierre/reemplazo — ninguna fila
      // se modificó, ningún Meeting se creó por esta llamada. Nunca un
      // error del operador: la revisión activa sigue en manos de su
      // propietario legítimo.
      return errorResponse(
        409,
        'review_lease_lost',
        'Se perdió la propiedad de esta revisión durante la reanudación — no se modificó nada; dirígete a la revisión activa vigente.',
      )
    case 'still_pending_review':
      // La reanudación misma topó con OTRO conflicto — ya se abrió/
      // reemplazó una revisión nueva; nunca se trata como error del
      // operador ni como éxito silencioso.
      return jsonResponse({ status: 'still_pending_review' })
    case 'resolved':
      return jsonResponse({ status: 'resolved', meetingId: outcome.meetingId })
    case 'resolved_review_reconciliation_pending':
      // Revisión 4, punto 3: la reserva es un éxito real (Meeting creado,
      // solicitud confirmada `pending_approval`), pero el cierre de la
      // revisión no pudo confirmarse con este claim y, al releerla, sigue
      // activa bajo otro propietario — nunca se afirma que está resuelta
      // si no lo está; el barrido de conciliación la cerrará.
      return jsonResponse({ status: 'resolved', meetingId: outcome.meetingId, reviewReconciliationPending: true })
  }
}
