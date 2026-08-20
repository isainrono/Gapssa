import { z } from 'zod'

import { errorResponse, getClientIp, jsonResponse } from '@/server/auth/httpHelpers'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { serverEnv } from '@/server/env'
import { getEspoBookingAdapter } from '@/server/booking/adapterSelector'
import { computeAvailability } from '@/server/booking/availability'

export const dynamic = 'force-dynamic'

/**
 * Consulta de disponibilidad — encargo de Fase 4A, punto 9. Sin sesión ni
 * CSRF (lectura pura, `GET`, sin efectos secundarios); protegida solo por
 * límite de frecuencia por IP para no habilitar un escaneo masivo de
 * huecos.
 */

const querySchema = z.object({
  treatmentId: z.string().min(1).max(200),
  professionalId: z.string().min(1).max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe tener formato YYYY-MM-DD'),
})

export async function GET(request: Request) {
  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(`booking-availability:ip:${ip}`, serverEnv.BOOKING_AVAILABILITY_MAX_PER_IP_PER_HOUR, 3600)
  if (!ipLimit.allowed) {
    return errorResponse(429, 'rate_limited', 'Demasiadas solicitudes desde este origen. Inténtalo más tarde.')
  }

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    treatmentId: url.searchParams.get('treatmentId') ?? '',
    professionalId: url.searchParams.get('professionalId') ?? undefined,
    date: url.searchParams.get('date') ?? '',
  })
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'Los parámetros de consulta no son válidos.')
  }

  const adapter = getEspoBookingAdapter()
  const result = await computeAvailability(adapter, parsed.data)

  switch (result.outcome) {
    case 'ok':
      return jsonResponse({ slots: result.slots })
    case 'treatment_not_found':
      return errorResponse(404, 'treatment_not_found', 'Tratamiento no encontrado.')
    case 'professional_not_found':
      return errorResponse(404, 'professional_not_found', 'Profesional no encontrada o no disponible.')
    case 'invalid_date':
      return errorResponse(400, 'invalid_date', 'Fecha no válida.')
  }
}
