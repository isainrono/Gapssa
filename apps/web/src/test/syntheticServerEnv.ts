import { randomBytes } from 'node:crypto'

/**
 * Entorno de test unitario completamente sintético y cerrado —
 * `vitest.setup.ts` lo instala ANTES de que Vitest importe cualquier
 * fichero de test (garantía de orden de `setupFiles`), para que
 * `src/server/env.ts` (que valida el esquema completo en tiempo de
 * import, `export const serverEnv = parseServerEnv(process.env)`) nunca
 * vea ni necesite el `.env` real del monorepo.
 *
 * Cero E/S de fichero: no importa `dotenv`, no llama a `readFileSync`, no
 * referencia ninguna ruta `.env`/`.env.example`. Mismo patrón ya usado y
 * probado en `tests/integration/rotation/setEnv.ts` (valores generados de
 * nuevo en cada arranque del proceso, nunca persistidos, nunca los mismos
 * entre ejecuciones) — aquí se reduce a los valores realmente necesarios
 * para pasar la validación de un test unitario (que no conecta a ninguna
 * base de datos ni servicio real).
 */

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString('base64')
}

/**
 * Un único `v1` por mapa, marcado como activo — no un mapa multi-versión
 * de convivencia (eso es responsabilidad de
 * `tests/integration/rotation/setEnv.ts`, que ejercita rotación real
 * contra una base efímera). Varios tests unitarios ya existentes
 * (`fieldCrypto.test.ts`, entre otros) asumen `v1` como versión activa —
 * usar aquí un esquema de rotación distinto rompería esa suposición sin
 * aportar nada a lo que estos tests unitarios comprueban.
 */
function oneVersion(): Record<'v1', string> {
  return { v1: randomBase64(32) }
}

/**
 * Claves que, si estuvieran heredadas del entorno de quien ejecuta la
 * suite (shell del desarrollador, CI con secretos reales inyectados,
 * etc.), filtrarían un secreto o DSN real dentro de los tests unitarios.
 * `installSyntheticServerEnv` las borra explícitamente de `process.env`
 * antes de instalar el fixture — la suite nunca debe depender de lo que
 * tenga el terminal de quien la ejecuta.
 */
export const SENSITIVE_ENV_KEYS = [
  'PAYLOAD_SECRET',
  'DATABASE_URL_CMS',
  'DATABASE_URL_AUTH',
  'DATABASE_URL_BOOKING',
  'REDIS_URL',
  'OTP_HMAC_SECRET',
  'AUTH_RATE_LIMIT_HMAC_SECRET',
  'BOOKING_FIELD_ENCRYPTION_KEYS',
  'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION',
  'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
  'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION',
  'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS',
  'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION',
  'BOOKING_INTERNAL_API_SECRET',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'ESPOCRM_API_KEY',
  'ESPOCRM_API_BASE_URL',
] as const

/**
 * Cubre exactamente las variables OBLIGATORIAS (sin `.default()`) del
 * esquema completo de `src/server/env.ts` + `src/payload.env.ts`, más
 * `ESPO_BOOKING_ADAPTER='simulated'` explícito (nunca dejar que un test
 * unitario active por accidente el adaptador HTTP real). Las variables
 * con valor por defecto en el esquema (SMTP_*, límites de frecuencia,
 * horario de reservas, etc.) se dejan sin fijar — el propio esquema las
 * resuelve.
 */
export function buildSyntheticServerEnv(): Record<string, string> {
  return {
    PAYLOAD_SECRET: randomBase64(32),
    DATABASE_URL_CMS: 'postgresql://gapssa_unit_test:fixture@127.0.0.1:1/gapssa_unit_test_cms',
    DATABASE_URL_AUTH: 'postgresql://gapssa_unit_test:fixture@127.0.0.1:1/gapssa_unit_test_auth',
    DATABASE_URL_BOOKING: 'postgresql://gapssa_unit_test:fixture@127.0.0.1:1/gapssa_unit_test_booking',
    REDIS_URL: 'redis://:fixture@127.0.0.1:1',
    REDIS_KEY_PREFIX: 'gapssa:unit-test:',
    OTP_HMAC_SECRET: randomBase64(32),
    AUTH_RATE_LIMIT_HMAC_SECRET: randomBase64(32),
    BOOKING_FIELD_ENCRYPTION_KEYS: JSON.stringify(oneVersion()),
    BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
    BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: JSON.stringify(oneVersion()),
    BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION: 'v1',
    BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: JSON.stringify(oneVersion()),
    BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION: 'v1',
    BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: JSON.stringify(oneVersion()),
    BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION: 'v1',
    BOOKING_INTERNAL_API_SECRET: randomBase64(32),
    ESPO_BOOKING_ADAPTER: 'simulated',
  }
}

/**
 * Efecto lateral deliberado, invocado una única vez desde
 * `vitest.setup.ts` antes de que Vitest cargue cualquier fichero de test.
 * Nunca lee `.env`/`.env.example` — cero E/S de fichero en esta función.
 */
export function installSyntheticServerEnv(): void {
  for (const key of SENSITIVE_ENV_KEYS) {
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(buildSyntheticServerEnv())) {
    process.env[key] = value
  }
}
