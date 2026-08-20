import 'server-only'

import { serverEnv } from '../env'
import { SimulatedEspoBookingAdapter, type EspoBookingAdapter } from './espoAdapter'
import { HttpEspoBookingAdapter } from './httpEspoAdapter'

/**
 * Único punto de selección del adaptador de reservas — Fase 4B. Todo
 * llamante (rutas de `app/api/booking/v1/**`, `reconciliation.ts`,
 * `decisionRecovery.ts`) debe pasar por aquí, nunca instanciar
 * `SimulatedEspoBookingAdapter`/`HttpEspoBookingAdapter` directamente:
 * mantiene la selección explícita y en un solo sitio auditable.
 *
 * `ESPO_BOOKING_ADAPTER` por defecto es `"simulated"` (`server/env.ts`) —
 * ningún entorno pasa a `http` por accidente, y `env.ts` ya falla al
 * arrancar el proceso si se pide `http` sin configuración completa (nunca
 * cae de vuelta al simulado en silencio). Las suites de pruebas
 * (unitarias/integración) nunca definen `ESPO_BOOKING_ADAPTER=http` en su
 * entorno — quedan en `simulated` por el mismo default.
 */
export function getEspoBookingAdapter(): EspoBookingAdapter {
  if (serverEnv.ESPO_BOOKING_ADAPTER === 'simulated') {
    return new SimulatedEspoBookingAdapter()
  }

  // env.ts ya garantiza que estos campos existen cuando ESPO_BOOKING_ADAPTER=http.
  return new HttpEspoBookingAdapter({
    baseUrl: serverEnv.ESPOCRM_API_BASE_URL!,
    apiKey: serverEnv.ESPOCRM_API_KEY!,
    timeoutMs: serverEnv.ESPOCRM_API_TIMEOUT_MS,
    maxRetries: serverEnv.ESPOCRM_API_MAX_RETRIES,
    retryBaseDelayMs: serverEnv.ESPOCRM_API_RETRY_BASE_DELAY_MS,
    maxResponseBytes: serverEnv.ESPOCRM_API_MAX_RESPONSE_BYTES,
    professionalUserIds: serverEnv.ESPOCRM_PROFESSIONAL_USER_IDS,
  })
}
