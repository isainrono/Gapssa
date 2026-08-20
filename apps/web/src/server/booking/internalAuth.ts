import 'server-only'
import { timingSafeEqual } from 'node:crypto'

import { serverEnv } from '../env'

/**
 * Autenticación mínima para los endpoints internos de reservas (barrido de
 * conciliación, decisión de aprobación simulada de EspoCRM) — cabecera
 * `X-Internal-Api-Secret` comparada en tiempo constante contra
 * `BOOKING_INTERNAL_API_SECRET`. Sustituye, en esta fase, al mecanismo real
 * de autenticación interna/cron que se decida más adelante (nunca expuesto
 * al navegador, nunca usado desde `apps/web` del lado cliente).
 */
export function isValidInternalApiSecret(request: Request): boolean {
  const provided = request.headers.get('x-internal-api-secret')
  if (!provided) {
    return false
  }

  const expectedBuffer = Buffer.from(serverEnv.BOOKING_INTERNAL_API_SECRET, 'utf8')
  const providedBuffer = Buffer.from(provided, 'utf8')
  if (providedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, providedBuffer)
}
