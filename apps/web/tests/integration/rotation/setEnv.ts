import { randomBytes } from 'node:crypto'

import { inject } from 'vitest'

/**
 * `setupFiles` de `vitest.rotation-integration.config.ts` — `server/env.ts`
 * valida el esquema COMPLETO de la aplicación en cuanto cualquier módulo
 * lo importa (p. ej. `fieldCrypto.ts` importa `serverEnv`), aunque esta
 * suite solo ejercite código de `booking`. El global-setup normal
 * (`tests/integration/global-setup.ts`) resuelve esto heredando
 * `process.env` de un `next dev` real arrancado con `dotenv -e .env` —
 * esta suite, deliberadamente, nunca toca `.env` ni arranca `next dev`,
 * así que fija aquí valores SINTÉTICOS bien formados para que el esquema
 * valide. Nunca son los secretos reales de nadie — generados de nuevo en
 * cada ejecución, nunca persistidos, nunca los mismos entre ejecuciones.
 *
 * Los ÚNICOS valores que estas pruebas usan de verdad (criptografía real
 * sobre datos reales de la base efímera) son los de `BOOKING_*` — el
 * resto (Payload/Auth/Redis/EspoCRM) nunca se conecta ni se ejercita en
 * esta suite, solo necesita pasar la validación de forma.
 */

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString('base64')
}

function setIfMissing(key: string, value: string): void {
  if (process.env[key] === undefined) {
    process.env[key] = value
  }
}

setIfMissing('COMPOSE_PROJECT_NAME', 'gapssa-rotation-v3-test')
setIfMissing('POSTGRES_DB', 'gapssa_rotation_v3_test')
setIfMissing('POSTGRES_USER', 'gapssa_rotation_v3_test')
setIfMissing('DATABASE_URL_CMS', 'postgresql://gapssa_rotation_v3_test:fixture@127.0.0.1:1/gapssa_rotation_v3_test_cms')
setIfMissing('DATABASE_URL_AUTH', 'postgresql://gapssa_rotation_v3_test:fixture@127.0.0.1:1/gapssa_rotation_v3_test_auth')
// `repository.ts` (código de producción, `guestFlow.ts`) usa siempre el
// singleton `bookingDb` de `db/client.ts`, que lee
// `serverEnv.DATABASE_URL_BOOKING` — a diferencia de los módulos de
// rotación (fieldEncryptionRotation.ts, emailLookupHmacRotation.ts...),
// que aceptan `db` como parámetro explícito. Para que las pruebas que
// ejercitan `repository.ts` (p. ej. la búsqueda dual de email-lookup)
// escriban de verdad en la MISMA base efímera que `inject()` expone,
// `DATABASE_URL_BOOKING` debe apuntar ahí — nunca a un valor ficticio.
setIfMissing('DATABASE_URL_BOOKING', inject('integrationBookingDatabaseUrl') ?? 'postgresql://gapssa_rotation_v3_test:fixture@127.0.0.1:1/gapssa_rotation_v3_test_booking')
setIfMissing('REDIS_KEY_PREFIX', 'gapssa:rotation-v3-test:')
setIfMissing('REDIS_URL', process.env.GAPSSA_ROTATION_V3_REDIS_URL ?? 'redis://:fixture@127.0.0.1:1')
setIfMissing('PAYLOAD_SECRET', randomBase64(32))
setIfMissing('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000')
setIfMissing('SITE_NOINDEX', 'true')
setIfMissing('NEXT_PUBLIC_UMAMI_WEBSITE_ID', '')
setIfMissing('NEXT_PUBLIC_UMAMI_SRC', '')
setIfMissing('OTP_HMAC_SECRET', randomBase64(32))
setIfMissing('AUTH_RATE_LIMIT_HMAC_SECRET', randomBase64(32))
setIfMissing('TRUSTED_PROXY_HOP_COUNT', '0')
setIfMissing('SMTP_HOST', '')
setIfMissing('SMTP_PORT', '587')
setIfMissing('SMTP_SECURE', 'false')
setIfMissing('SMTP_USER', '')
setIfMissing('SMTP_PASSWORD', '')
setIfMissing('SMTP_FROM_EMAIL', 'rotation-v3-test@example.test')

// --- BOOKING_* — estos SÍ se usan de verdad (criptografía real). v1/v2/v3
// presentes en los 4 mapas (cada uno con su propio material, nunca
// reutilizado entre propósitos distintos): las pruebas existentes/nuevas
// ejercitan convivencia y migración v1->v2 y v1/v2->v3 según el caso. ---
function threeVersions(): Record<'v1' | 'v2' | 'v3', string> {
  return { v1: randomBase64(32), v2: randomBase64(32), v3: randomBase64(32) }
}
setIfMissing('BOOKING_FIELD_ENCRYPTION_KEYS', JSON.stringify(threeVersions()))
setIfMissing('BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION', 'v3')
setIfMissing('BOOKING_EMAIL_LOOKUP_HMAC_SECRETS', JSON.stringify(threeVersions()))
setIfMissing('BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION', 'v3')
setIfMissing('BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS', JSON.stringify(threeVersions()))
setIfMissing('BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION', 'v3')
setIfMissing('BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS', JSON.stringify(threeVersions()))
setIfMissing('BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION', 'v3')
setIfMissing('BOOKING_INTERNAL_API_SECRET', randomBase64(32))
setIfMissing('ESPO_BOOKING_ADAPTER', 'simulated')
