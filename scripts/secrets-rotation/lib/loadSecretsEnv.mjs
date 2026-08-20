// Módulo compartido de scripts/secrets-rotation/ — construye el entorno de
// un proceso hijo (apps/web real en S9, scripts `tsx` desechables de
// S6/S7) SIN heredar `process.env` completo (podría contener un secreto
// filtrado de una sesión anterior) y SIN pasar nunca un secreto por argv.
//
// Dos piezas:
//   1. BASE_ENV_ALLOWLIST — variables no sensibles del propio operador que
//      sí se heredan (rutas, locale, terminal).
//   2. parseSecretsFile()  — parser estricto y literal (nunca `eval`,
//      nunca invoca una shell) de $SECRETS_FILE, con un inventario
//      CERRADO de nombres de variable permitidos — cualquier nombre fuera
//      de esa lista, línea mal formada, clave duplicada o valor con byte
//      NUL hace fallar el arranque en vez de continuar con una duda.
//
// Nunca imprime ni registra ningún valor — solo nombres de variable y
// booleanos/errores.

import { readFileSync } from 'node:fs'

/** Variables del entorno del propio operador que SÍ se heredan tal cual — cerrado, nunca `...process.env`. */
export const BASE_ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'NODE_ENV']

/**
 * Inventario cerrado de las claves que `$SECRETS_FILE` puede contener —
 * unión exacta de `.env.example` (raíz del repo) más las claves nuevas
 * introducidas por el rediseño versionado de email-lookup/access-token
 * (BOOKING_EMAIL_LOOKUP_HMAC_SECRETS/_ACTIVE_KEY_VERSION,
 * BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS/_ACTIVE_KEY_VERSION,
 * sustituyendo a las variantes sin versión). Cualquier variable ausente
 * de esta lista hace fallar el parseo — nunca se ignora en silencio.
 */
export const SECRETS_FILE_KEY_INVENTORY = [
  'COMPOSE_PROJECT_NAME',
  'ESPOCRM_IMAGE',
  'ESPOCRM_HTTP_PORT',
  'ESPOCRM_WEBSOCKET_PORT',
  'ESPOCRM_SITE_URL',
  'ESPOCRM_ADMIN_USERNAME',
  'ESPOCRM_ADMIN_PASSWORD',
  'ESPOCRM_DB_IMAGE',
  'ESPOCRM_DB_NAME',
  'ESPOCRM_DB_USER',
  'ESPOCRM_DB_PASSWORD',
  'ESPOCRM_DB_ROOT_PASSWORD',
  'POSTGRES_IMAGE',
  'POSTGRES_HOST_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_AUTH_DB',
  'POSTGRES_BOOKING_DB',
  'DATABASE_URL_CMS',
  'DATABASE_URL_AUTH',
  'DATABASE_URL_BOOKING',
  'REDIS_IMAGE',
  'REDIS_HOST_PORT',
  'REDIS_PASSWORD',
  'REDIS_KEY_PREFIX',
  'REDIS_URL',
  'PAYLOAD_SECRET',
  'NEXT_PUBLIC_SITE_URL',
  'SITE_NOINDEX',
  'NEXT_PUBLIC_UMAMI_WEBSITE_ID',
  'NEXT_PUBLIC_UMAMI_SRC',
  'OTP_HMAC_SECRET',
  'AUTH_RATE_LIMIT_HMAC_SECRET',
  'TRUSTED_PROXY_HOP_COUNT',
  'OTP_TTL_MINUTES',
  'OTP_MAX_ATTEMPTS',
  'OTP_LOCKOUT_MINUTES',
  'OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR',
  'OTP_REQUEST_MAX_PER_IP_PER_HOUR',
  'AUTH_SESSION_ABSOLUTE_TTL_DAYS',
  'AUTH_PASSWORD_RESET_SESSION_MINUTES',
  'AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR',
  'AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR',
  'AUTH_LOGIN_LOCKOUT_MINUTES',
  'ARGON2_MEMORY_COST_KIB',
  'ARGON2_TIME_COST',
  'ARGON2_PARALLELISM',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM_EMAIL',
  'BOOKING_FIELD_ENCRYPTION_KEYS',
  'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION',
  'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
  'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION',
  'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS',
  'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION',
  'BOOKING_INTERNAL_API_SECRET',
  'BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES',
  'BOOKING_BUSINESS_DAYS',
  'BOOKING_OPEN_TIME',
  'BOOKING_CLOSE_TIME',
  'BOOKING_SLOT_GRANULARITY_MINUTES',
  'BOOKING_MAX_SLOTS_PER_QUERY',
  'BOOKING_REQUEST_MAX_PER_IP_PER_HOUR',
  'BOOKING_VERIFY_MAX_PER_IP_PER_HOUR',
  'BOOKING_AVAILABILITY_MAX_PER_IP_PER_HOUR',
  'ESPO_BOOKING_ADAPTER',
  'ESPOCRM_API_BASE_URL',
  'ESPOCRM_API_KEY',
  'ESPOCRM_API_TIMEOUT_MS',
  'ESPOCRM_API_MAX_RETRIES',
  'ESPOCRM_API_RETRY_BASE_DELAY_MS',
  'ESPOCRM_API_MAX_RESPONSE_BYTES',
  'ESPOCRM_PROFESSIONAL_USER_IDS',
]

/**
 * Los tres valores posibles de clasificación de una clave de
 * `SECRETS_FILE_KEY_INVENTORY` (Bloque 6). Cerrado -- cualquier otro
 * string es un error de programación, nunca un valor válido.
 */
export const SECRET_CLASS = Object.freeze({
  SECRET: 'secret',
  SENSITIVE_CONNECTION_STRING: 'sensitive-connection-string',
  NON_SECRET_CONFIGURATION: 'non-secret-configuration',
})

/**
 * Clasificación CERRADA y EXPLÍCITA (nunca por coincidencia parcial del
 * nombre en runtime) de cada clave de `SECRETS_FILE_KEY_INVENTORY` — la
 * fuente única de verdad de la que se deriva `SECRET_VALUE_KEYS` más
 * abajo. Escanear el inventario completo en busca de fugas produce falsos
 * positivos: parámetros operativos no sensibles (imágenes, puertos, TTLs,
 * límites de tasa, costes de Argon2, horario de negocio...) tienen
 * valores cortos y genéricos ("3", "60") que coinciden por pura
 * casualidad con cualquier log (timestamps, duraciones, puertos) -- un
 * ensayo integral real contra infraestructura desechable lo detectó: la
 * Puerta S9 nunca llegaba a 'done' pese a que ningún secreto real se
 * había filtrado.
 *
 * `secretClassification.test.mjs` exige que este objeto tenga EXACTAMENTE
 * las mismas claves que `SECRETS_FILE_KEY_INVENTORY` (ni de más ni de
 * menos) -- una clave nueva o desconocida hace fallar esa prueba hasta
 * ser clasificada explícitamente aquí. Revísalo antes de aceptar
 * cualquier cambio a `SECRETS_FILE_KEY_INVENTORY`.
 */
export const SECRET_KEY_CLASSIFICATION = Object.freeze({
  COMPOSE_PROJECT_NAME: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_IMAGE: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_HTTP_PORT: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_WEBSOCKET_PORT: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_SITE_URL: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_ADMIN_USERNAME: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_ADMIN_PASSWORD: SECRET_CLASS.SECRET,
  ESPOCRM_DB_IMAGE: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_DB_NAME: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_DB_USER: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_DB_PASSWORD: SECRET_CLASS.SECRET,
  ESPOCRM_DB_ROOT_PASSWORD: SECRET_CLASS.SECRET,
  POSTGRES_IMAGE: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  POSTGRES_HOST_PORT: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  POSTGRES_DB: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  POSTGRES_USER: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  POSTGRES_PASSWORD: SECRET_CLASS.SECRET,
  POSTGRES_AUTH_DB: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  POSTGRES_BOOKING_DB: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  DATABASE_URL_CMS: SECRET_CLASS.SENSITIVE_CONNECTION_STRING,
  DATABASE_URL_AUTH: SECRET_CLASS.SENSITIVE_CONNECTION_STRING,
  DATABASE_URL_BOOKING: SECRET_CLASS.SENSITIVE_CONNECTION_STRING,
  REDIS_IMAGE: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  REDIS_HOST_PORT: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  REDIS_PASSWORD: SECRET_CLASS.SECRET,
  REDIS_KEY_PREFIX: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  REDIS_URL: SECRET_CLASS.SENSITIVE_CONNECTION_STRING,
  PAYLOAD_SECRET: SECRET_CLASS.SECRET,
  NEXT_PUBLIC_SITE_URL: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  SITE_NOINDEX: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  NEXT_PUBLIC_UMAMI_SRC: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  OTP_HMAC_SECRET: SECRET_CLASS.SECRET,
  AUTH_RATE_LIMIT_HMAC_SECRET: SECRET_CLASS.SECRET,
  TRUSTED_PROXY_HOP_COUNT: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  OTP_TTL_MINUTES: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  OTP_MAX_ATTEMPTS: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  OTP_LOCKOUT_MINUTES: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  AUTH_SESSION_ABSOLUTE_TTL_DAYS: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  AUTH_PASSWORD_RESET_SESSION_MINUTES: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  AUTH_LOGIN_LOCKOUT_MINUTES: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ARGON2_MEMORY_COST_KIB: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ARGON2_TIME_COST: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ARGON2_PARALLELISM: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  SMTP_HOST: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  SMTP_PORT: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  SMTP_SECURE: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  SMTP_USER: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  SMTP_PASSWORD: SECRET_CLASS.SECRET,
  SMTP_FROM_EMAIL: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_FIELD_ENCRYPTION_KEYS: SECRET_CLASS.SECRET,
  BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: SECRET_CLASS.SECRET,
  BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: SECRET_CLASS.SECRET,
  BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: SECRET_CLASS.SECRET,
  BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_INTERNAL_API_SECRET: SECRET_CLASS.SECRET,
  BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_BUSINESS_DAYS: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_OPEN_TIME: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_CLOSE_TIME: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_SLOT_GRANULARITY_MINUTES: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_MAX_SLOTS_PER_QUERY: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_REQUEST_MAX_PER_IP_PER_HOUR: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_VERIFY_MAX_PER_IP_PER_HOUR: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  BOOKING_AVAILABILITY_MAX_PER_IP_PER_HOUR: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPO_BOOKING_ADAPTER: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_API_BASE_URL: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_API_KEY: SECRET_CLASS.SECRET,
  ESPOCRM_API_TIMEOUT_MS: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_API_MAX_RETRIES: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_API_RETRY_BASE_DELAY_MS: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  ESPOCRM_API_MAX_RESPONSE_BYTES: SECRET_CLASS.NON_SECRET_CONFIGURATION,
  // IDs internos de EspoCRM -- identificadores, no material de
  // autenticación; no encajan en 'secret' ni en 'sensitive-connection-string'
  // bajo el criterio explícito (contraseñas, API keys, HMAC, claves de
  // cifrado, tokens, DSN y URLs con credenciales).
  ESPOCRM_PROFESSIONAL_USER_IDS: SECRET_CLASS.NON_SECRET_CONFIGURATION,
})

/**
 * Longitud mínima (caracteres) que debe tener el VALOR de una clave
 * clasificada `secret`/`sensitive-connection-string` para que
 * `scan-log-for-secrets` la trate como escaneable con garantías. Todo
 * secreto generado por este sistema usa como mínimo 24 bytes
 * (base64 ~=32 caracteres, hex 64 -- ver `02-generate-secret.sh` /
 * `rotate-all-interactive.sh`); un valor más corto que este umbral no
 * puede alcanzarse por una rotación real y, si aparece, es indistinguible
 * de una coincidencia genérica de log (Bloque 4: fallar cerrado, nunca
 * escanear "por si acaso" un valor demasiado corto para ser fiable).
 */
export const MIN_SECRET_VALUE_LENGTH = 16

/**
 * Subconjunto de `SECRETS_FILE_KEY_INVENTORY` que representa material
 * realmente secreto -- derivado de `SECRET_KEY_CLASSIFICATION`, nunca
 * mantenido por separado (una única fuente de verdad). Úsalo, no el
 * inventario completo, para decidir qué valores vale la pena buscar como
 * fuga en un log.
 */
export const SECRET_VALUE_KEYS = new Set(
  Object.entries(SECRET_KEY_CLASSIFICATION)
    .filter(([, cls]) => cls === SECRET_CLASS.SECRET || cls === SECRET_CLASS.SENSITIVE_CONNECTION_STRING)
    .map(([key]) => key),
)

const LINE_PATTERN = /^([A-Z_][A-Z0-9_]*)=(.*)$/

export class SecretsFileParseError extends Error {}

/**
 * Parsea `secretsFilePath` como pares `KEY=VALUE` estrictos — el valor se
 * toma LITERAL (nunca se interpola/evalúa), así que `$(...)`/backticks/
 * comillas en un valor son inertes por construcción, no por escape.
 * Lanza `SecretsFileParseError` (nunca continúa "por si acaso") ante:
 * línea mal formada, clave duplicada, clave fuera de
 * `SECRETS_FILE_KEY_INVENTORY`, o valor con byte NUL. Los mensajes de
 * error nunca incluyen el valor — como mucho el número de línea y el
 * nombre de la clave.
 */
export function parseSecretsFile(secretsFilePath) {
  const raw = readFileSync(secretsFilePath, 'utf8')
  const lines = raw.split('\n')
  const seen = new Set()
  const result = {}

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    if (line === '' || line.startsWith('#')) {
      return
    }
    const match = LINE_PATTERN.exec(line)
    if (!match) {
      throw new SecretsFileParseError(`Línea ${lineNumber} mal formada (no es KEY=VALUE).`)
    }
    const [, key, value] = match
    if (seen.has(key)) {
      throw new SecretsFileParseError(`Clave duplicada "${key}" (línea ${lineNumber}).`)
    }
    if (!SECRETS_FILE_KEY_INVENTORY.includes(key)) {
      throw new SecretsFileParseError(`Clave "${key}" (línea ${lineNumber}) no está en el inventario cerrado — rechazada.`)
    }
    if (value.includes('\0')) {
      throw new SecretsFileParseError(`El valor de "${key}" (línea ${lineNumber}) contiene un byte NUL — rechazado.`)
    }
    seen.add(key)
    result[key] = value
  })

  return result
}

/**
 * Construye el objeto `env` completo para `child_process.spawn` —
 * allowlist base del propio operador (`BASE_ENV_ALLOWLIST`) + las claves
 * de `$SECRETS_FILE` (ya validadas por `parseSecretsFile`) + los
 * `extraVars` explícitos que el propio orquestador quiera fijar (p. ej.
 * `PORT`/`HOST`) — nunca `...process.env` sin filtrar.
 */
export function buildChildEnv(secretsFilePath, extraVars = {}) {
  const secrets = parseSecretsFile(secretsFilePath)
  const env = {}
  for (const key of BASE_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]
    }
  }
  Object.assign(env, secrets, extraVars)
  return env
}
