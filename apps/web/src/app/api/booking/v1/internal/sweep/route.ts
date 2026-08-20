import { errorResponse, jsonResponse } from '@/server/auth/httpHelpers'
import { getEspoBookingAdapter } from '@/server/booking/adapterSelector'
import { isValidInternalApiSecret } from '@/server/booking/internalAuth'
import { runBookingReconciliationSweep } from '@/server/booking/reconciliation'

export const dynamic = 'force-dynamic'

/**
 * Dispara una pasada del barrido de conciliación —
 * `server/booking/reconciliation.ts`, encargo de Fase 4A, punto 6 y punto
 * 10. Endpoint interno, protegido por `X-Internal-Api-Secret`, pensado
 * para invocarse desde un scheduler externo (cron/worker) — el propio
 * scheduler queda fuera de alcance de esta fase, mismo pendiente operativo
 * que el runner del outbox de Fase 3
 * (`docs/fase3-autenticacion.md` §6.2).
 */
export async function POST(request: Request) {
  if (!isValidInternalApiSecret(request)) {
    return errorResponse(401, 'unauthorized', 'Credencial interna inválida o ausente.')
  }

  const adapter = getEspoBookingAdapter()
  const report = await runBookingReconciliationSweep(adapter)

  return jsonResponse(report)
}
