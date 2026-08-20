import { z } from 'zod'

import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { getActiveSessionFromCookies } from '@/server/auth/session'
import { serverEnv } from '@/server/env'
import { getEspoBookingAdapter } from '@/server/booking/adapterSelector'
import { createAuthenticatedBooking } from '@/server/booking/authenticatedFlow'

export const dynamic = 'force-dynamic'

/**
 * Crea (y completa, síncronamente) una solicitud de reserva de CLIENTE
 * AUTENTICADO — encargo de Fase 4A, punto 7 y punto 9. Requiere sesión
 * activa; nunca reutiliza el flujo de invitado ni su lógica (ambos
 * delegan en las mismas funciones compartidas — ver `authenticatedFlow.ts`).
 */

/**
 * Puerta 5B-2A: exportado únicamente para que las pruebas de contrato
 * (`route.schema.test.ts`) puedan afirmar que un campo homónimo del
 * mecanismo interno de pruebas controladas
 * (`cExcluirGoogleCalendarSync`/`controlledTestExcludeGcs`) enviado por el
 * navegador queda eliminado por `z.object()` — mismo motivo que
 * `requests/route.ts`.
 */
export const bodySchema = z.object({
  idempotencyKey: z.uuid(),
  treatmentId: z.string().min(1).max(200),
  professionalId: z.string().min(1).max(200),
  zoneId: z.string().min(1).max(200),
  startAt: z.iso.datetime({ offset: true }),
  contact: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone: z
      .string()
      .trim()
      .min(6, 'Teléfono demasiado corto.')
      .max(20, 'Teléfono demasiado largo.')
      .regex(/^[+0-9 ()-]+$/, 'Teléfono con caracteres no válidos.'),
  }),
})

export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const session = await getActiveSessionFromCookies()
  if (!session) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(`booking-request-auth:ip:${ip}`, serverEnv.BOOKING_REQUEST_MAX_PER_IP_PER_HOUR, 3600)
  if (!ipLimit.allowed) {
    return errorResponse(429, 'rate_limited', 'Demasiadas solicitudes desde este origen. Inténtalo más tarde.')
  }

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const adapter = getEspoBookingAdapter()
  const outcome = await createAuthenticatedBooking(adapter, session.accountId, parsed.data)

  switch (outcome.outcome) {
    case 'accepted':
      return jsonResponse(
        { requestId: outcome.requestId, meetingId: outcome.meetingId, status: 'pending_approval' },
        { status: 201 },
      )
    case 'contact_review_pending':
      // Igual que el invitado: código correcto / sesión válida, pero el
      // matching de Contact quedó ambiguo (Fase 4B) — el centro debe
      // revisarlo, nunca se expone el detalle al cliente.
      return jsonResponse({ requestId: outcome.requestId, status: 'contact_review_pending' }, { status: 202 })
    case 'idempotency_conflict':
      return errorResponse(409, 'idempotency_conflict', 'Ya existe una solicitud distinta con la misma clave de idempotencia.')
    case 'account_not_active':
      return errorResponse(403, 'account_not_active', 'Tu cuenta no puede realizar reservas en este momento.')
    case 'treatment_not_found':
      return errorResponse(404, 'treatment_not_found', 'Tratamiento no encontrado.')
    case 'zone_not_found':
      return errorResponse(404, 'zone_not_found', 'Zona no encontrada.')
    case 'professional_not_found':
      return errorResponse(404, 'professional_not_found', 'Profesional no encontrada o no disponible.')
    case 'invalid_start_time':
      return errorResponse(400, 'invalid_start_time', 'Fecha/hora de inicio no válida.')
    case 'lead_time_violation':
      return errorResponse(400, 'lead_time_violation', 'La reserva no cumple la antelación mínima requerida.')
    case 'horizon_violation':
      return errorResponse(400, 'horizon_violation', 'La fecha solicitada supera el horizonte máximo de reserva.')
    case 'slot_unavailable':
      return errorResponse(409, 'slot_unavailable', 'El horario solicitado ya no está disponible.')
  }
}
