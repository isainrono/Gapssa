import { z } from 'zod'

import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { serverEnv } from '@/server/env'
import { verifyBookingRequestAccessToken } from '@/server/booking/accessToken'
import { getEspoBookingAdapter } from '@/server/booking/adapterSelector'
import { verifyGuestBooking } from '@/server/booking/guestFlow'
import { findBookingRequestById } from '@/server/booking/repository'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  code: z.string().min(4).max(12),
})

/**
 * Verifica el código de un solo uso de una solicitud de invitado — encargo
 * de Fase 4A, punto 9. Requiere el `accessToken` opaco devuelto por
 * `POST /api/booking/v1/requests` (cabecera `X-Booking-Access-Token`):
 * sin sesión, es la única forma de que esta ruta compruebe que quien
 * verifica es quien creó la solicitud, no un tercero que adivinó el `id`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const { id } = await params
  // La versión con la que verificar es la que la propia fila guarda
  // (accessTokenKeyVersion) — nunca "probar todas las del mapa" — así que
  // hace falta cargar la fila ANTES de poder verificar el token, a
  // diferencia de la v2 (secreto único, sin versión). Mismo error genérico
  // en ambas ramas de fallo: no revela si el id existe a quien no
  // demuestra conocer el token de acceso.
  const record = await findBookingRequestById(id)
  const accessToken = request.headers.get('x-booking-access-token')
  if (!record || !accessToken || !verifyBookingRequestAccessToken(id, record.accessTokenKeyVersion, accessToken)) {
    return errorResponse(404, 'not_found', 'Solicitud no encontrada.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(`booking-verify:ip:${ip}`, serverEnv.BOOKING_VERIFY_MAX_PER_IP_PER_HOUR, 3600)
  if (!ipLimit.allowed) {
    return errorResponse(429, 'rate_limited', 'Demasiados intentos desde este origen. Inténtalo más tarde.')
  }

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const adapter = getEspoBookingAdapter()
  const outcome = await verifyGuestBooking(adapter, id, parsed.data.code)

  switch (outcome.outcome) {
    case 'verified':
      return jsonResponse({ status: 'pending_approval', meetingId: outcome.meetingId })
    case 'contact_review_pending':
      // El código era correcto, pero el matching de Contact contra EspoCRM
      // real quedó ambiguo (Fase 4B) — no es un error del cliente ni un
      // fallo: el centro debe revisarlo. Nunca se expone el detalle de la
      // ambigüedad (candidateContactIds) al cliente.
      return jsonResponse({ status: 'contact_review_pending' })
    case 'invalid_code':
      return errorResponse(400, 'invalid_code', 'Código incorrecto, caducado o ya utilizado.')
    case 'locked':
      return errorResponse(429, 'locked', 'Demasiados intentos. Solicita una reserva nueva.')
    case 'expired':
      return errorResponse(400, 'expired', 'El código ha caducado. Solicita una reserva nueva.')
    case 'request_not_found':
      return errorResponse(404, 'not_found', 'Solicitud no encontrada.')
  }
}
