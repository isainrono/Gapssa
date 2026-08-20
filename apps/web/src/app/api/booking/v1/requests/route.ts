import { z } from 'zod'

import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { serverEnv } from '@/server/env'
import { getEspoBookingAdapter } from '@/server/booking/adapterSelector'
import { createGuestBooking } from '@/server/booking/guestFlow'

export const dynamic = 'force-dynamic'

/**
 * Crea una solicitud de reserva de INVITADO — encargo de Fase 4A, punto 4
 * y punto 9 ("crear solicitud"). Sin sesión: cualquiera puede llamar a
 * este endpoint, protegido por CSRF (doble envío, mismo mecanismo que
 * Fase 3) y límite de frecuencia por IP — nunca por cuenta, porque no hay
 * cuenta. Toda la lógica de negocio vive en `guestFlow.ts`; esta ruta solo
 * valida entrada y traduce el resultado a HTTP.
 */

const guestContactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .min(6, 'Teléfono demasiado corto.')
    .max(20, 'Teléfono demasiado largo.')
    .regex(/^[+0-9 ()-]+$/, 'Teléfono con caracteres no válidos.'),
  email: z.string().trim().toLowerCase().email().max(254),
})

/**
 * Puerta 5B-2A: exportado únicamente para que las pruebas de contrato
 * (`route.schema.test.ts`) puedan afirmar que un campo homónimo del
 * mecanismo interno de pruebas controladas
 * (`cExcluirGoogleCalendarSync`/`controlledTestExcludeGcs`) enviado por el
 * navegador queda eliminado por `z.object()` (comportamiento por defecto
 * de Zod, sin `.passthrough()`) antes de llegar a `guestFlow.ts` — nunca
 * pensado como API pública del módulo más allá de eso.
 */
export const bodySchema = z.object({
  idempotencyKey: z.uuid(),
  treatmentId: z.string().min(1).max(200),
  professionalId: z.string().min(1).max(200),
  zoneId: z.string().min(1).max(200),
  startAt: z.iso.datetime({ offset: true }),
  guest: guestContactSchema,
})

export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(`booking-request:ip:${ip}`, serverEnv.BOOKING_REQUEST_MAX_PER_IP_PER_HOUR, 3600)
  if (!ipLimit.allowed) {
    return errorResponse(429, 'rate_limited', 'Demasiadas solicitudes desde este origen. Inténtalo más tarde.')
  }

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const adapter = getEspoBookingAdapter()
  const outcome = await createGuestBooking(adapter, parsed.data)

  switch (outcome.outcome) {
    case 'accepted':
      return jsonResponse(
        {
          requestId: outcome.requestId,
          accessToken: outcome.accessToken,
          verificationExpiresAt: outcome.verificationExpiresAt,
          status: 'pending_verification',
        },
        { status: 202 },
      )
    case 'idempotency_conflict':
      return errorResponse(409, 'idempotency_conflict', 'Ya existe una solicitud distinta con la misma clave de idempotencia.')
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
    case 'too_many_pending_requests':
      return errorResponse(429, 'too_many_pending_requests', 'Ya tienes solicitudes pendientes. Complétalas antes de crear otra.')
    case 'otp_rate_limited':
      return errorResponse(429, 'rate_limited', 'Demasiados intentos. Inténtalo más tarde.')
  }
}
