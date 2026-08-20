import { jsonResponse } from '@/server/auth/httpHelpers'
import { getEspoBookingAdapter } from '@/server/booking/adapterSelector'

export const dynamic = 'force-dynamic'

/** Catálogo de tratamientos activos — usado por la interfaz mínima de reserva (encargo de Fase 4A, punto 9) para poblar el selector. Lectura pública, sin datos personales. */
export async function GET() {
  const adapter = getEspoBookingAdapter()
  const treatments = await adapter.listTreatments()
  return jsonResponse({ treatments })
}
