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
import { randomBytes } from 'node:crypto'

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

// ---------------------------------------------------------------------------
// Esquema TRANSICIONAL (Bloque 8) — S1 siempre crea `$SECRETS_FILE` a
// partir de `.env.example`, que ya nace en forma "active" (nombres
// plurales/versionados de booking-email/access-token) — pero un almacén
// externo REAL preexistente de una instalación anterior al rediseño
// versionado de S7 puede llegar todavía en forma "legacy-pre-s7" (nombres
// singulares sin versión). `SECRETS_FILE_KEY_INVENTORY` de arriba es y
// sigue siendo estrictamente "active" — nunca se amplía con las claves
// legacy: ampliarlo indiscriminadamente aceptaría, para SIEMPRE y en
// CUALQUIER proceso (incluida la S9 real vía `start-apps-web.mjs`), un
// archivo que mezcla ambas formas sin que nada lo detecte. En su lugar,
// `parseSecretsFile`/`buildChildEnv` aceptan un flag EXPLÍCITO
// (`allowLegacyPreS7`, por defecto `false`) que activa un SEGUNDO
// inventario cerrado — `LEGACY_PRE_S7_KEY_INVENTORY` — elegido en tiempo
// de parseo según el CONTENIDO real del archivo (nunca por confianza
// ciega): la puerta S6 (que corre siempre ANTES que S7 en el recorrido
// S1..S9, y nunca toca ningún secreto de booking) es la única llamadora
// que pasa `allowLegacyPreS7:true`, y lo hace a través de
// `buildS6CryptoProbeEnv` — una proyección MÍNIMA que nunca reenvía el valor
// legacy real a ningún proceso hijo. `start-apps-web.mjs` (S9) sigue
// llamando a `buildChildEnv`/`parseSecretsFile` SIN este flag — sigue
// exigiendo, sin excepción, el inventario "active" puro.
//
// Los dos nombres de clave "legacy-pre-s7" siguen el mismo patrón de
// duplicación deliberada (nunca importada en vivo) que
// `lib/backupSchema.mjs` ya documenta para `MANDATORY_INFRA_KEYS` — este
// módulo NO importa de `backupSchema.mjs` porque `backupSchema.mjs` ya
// importa de ESTE módulo (`SECRETS_FILE_KEY_INVENTORY`); crear el sentido
// contrario formaría un ciclo. `lib/loadSecretsEnv.test.mjs` prueba que
// ambas copias coinciden exactamente, para detectar cualquier deriva.
export const ACTIVE_SCHEMA_VERSION = 'active'
export const LEGACY_PRE_S7_SCHEMA_VERSION = 'legacy-pre-s7'

/** Las dos claves EXACTAS y CONOCIDAS de la forma anterior a S7 — cerrado, nunca una tercera. */
export const LEGACY_ONLY_KEYS = ['BOOKING_EMAIL_LOOKUP_HMAC_SECRET', 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET']

/** Las claves "active" que las de arriba sustituyen — nunca conviven con ellas en el mismo archivo. */
const ACTIVE_ONLY_KEYS_REPLACED_BY_LEGACY = [
  'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
  'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION',
]

/** Inventario cerrado "legacy-pre-s7": el activo menos esas 4 claves, más las 2 legacy singulares — nunca ambas formas a la vez. */
export const LEGACY_PRE_S7_KEY_INVENTORY = [
  ...SECRETS_FILE_KEY_INVENTORY.filter((k) => !ACTIVE_ONLY_KEYS_REPLACED_BY_LEGACY.includes(k)),
  ...LEGACY_ONLY_KEYS,
]

/**
 * Clasificación cerrada de las 2 claves legacy — SEPARADA de
 * `SECRET_KEY_CLASSIFICATION` (que sigue cubriendo EXACTAMENTE las 80
 * claves "active", sin cambios: el escáner de fugas de S9 nunca debería
 * ver una clave legacy, porque S9 exige el inventario final sin ellas).
 * Existe únicamente para que quede constancia explícita de que, cuando
 * SÍ se aceptan (bajo `allowLegacyPreS7`), se tratan como material
 * secreto — nunca como configuración no sensible.
 */
export const LEGACY_KEY_CLASSIFICATION = Object.freeze({
  BOOKING_EMAIL_LOOKUP_HMAC_SECRET: SECRET_CLASS.SECRET,
  BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET: SECRET_CLASS.SECRET,
})

const ACTIVE_MARKER_KEYS = ['BOOKING_EMAIL_LOOKUP_HMAC_SECRETS', 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS']
const LEGACY_MARKER_KEYS = LEGACY_ONLY_KEYS

/**
 * Función pura: dado el conjunto de claves PRESENTES en un archivo (ya
 * tokenizado, nunca valores), decide a qué esquema pertenece mirando
 * ÚNICAMENTE los 2 pares de claves marcador (booking-email/access-token
 * plural vs. singular) — mismo criterio que
 * `lib/detectSecretsSchemaVersion.mjs` usa sobre el `$SECRETS_FILE` real
 * completo (duplicado deliberadamente, no importado, por la misma razón
 * de ciclo de arriba). Lanza `SecretsFileParseError` si el archivo mezcla
 * ambas formas a la vez — nunca "adivina" cuál manda. Si no encuentra
 * NINGÚN marcador (archivo incompleto/inválido), devuelve `active` por
 * defecto — el propio inventario "active" seguirá rechazando cualquier
 * otra clave desconocida, y la comprobación de obligatorias aguas abajo
 * (fuera de este módulo) sigue siendo quien detecta la ausencia real.
 */
export function detectSchemaVersionFromKeys(presentKeys) {
  const keys = presentKeys instanceof Set ? presentKeys : new Set(presentKeys)
  const hasActive = ACTIVE_MARKER_KEYS.some((k) => keys.has(k))
  const hasLegacy = LEGACY_MARKER_KEYS.some((k) => keys.has(k))
  if (hasActive && hasLegacy) {
    throw new SecretsFileParseError(
      'El archivo externo mezcla claves de booking-email/access-token plurales Y singulares a la vez — estado ambiguo, rechazado.',
    )
  }
  return hasLegacy ? LEGACY_PRE_S7_SCHEMA_VERSION : ACTIVE_SCHEMA_VERSION
}

/**
 * Tokeniza `lines` en pares `KEY=VALUE` — SOLO las comprobaciones de
 * FORMATO que no dependen de qué inventario aplica (línea mal formada,
 * clave duplicada, byte NUL): la comprobación de "¿está esta clave en el
 * inventario cerrado?" vive en `parseSecretsFile`, una vez decidido QUÉ
 * inventario usar. El valor se toma siempre LITERAL — nunca se interpola/
 * evalúa, así que `$(...)`/backticks/comillas son inertes por
 * construcción, no por escape.
 */
function tokenizeSecretsFileLines(lines) {
  const seen = new Set()
  const tokens = []

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
    if (value.includes('\0')) {
      throw new SecretsFileParseError(`El valor de "${key}" (línea ${lineNumber}) contiene un byte NUL — rechazado.`)
    }
    seen.add(key)
    tokens.push({ key, value, lineNumber })
  })

  return tokens
}

/**
 * Parsea `secretsFilePath` como pares `KEY=VALUE` estrictos. Por defecto
 * (`allowLegacyPreS7` ausente/`false` — TODOS los llamadores existentes,
 * incluida `start-apps-web.mjs` de S9, sin ningún cambio de
 * comportamiento) exige el inventario "active" puro, exactamente como
 * antes. Con `{ allowLegacyPreS7: true }` (solo `buildS6CryptoProbeEnv`, más
 * abajo), detecta primero el esquema real del archivo
 * (`detectSchemaVersionFromKeys`) y valida contra el inventario cerrado
 * correspondiente — nunca contra una unión de ambos. Lanza
 * `SecretsFileParseError` (nunca continúa "por si acaso") ante: línea mal
 * formada, clave duplicada, clave fuera del inventario cerrado elegido,
 * mezcla legacy/active, o valor con byte NUL. Los mensajes de error nunca
 * incluyen el valor — como mucho el número de línea y el nombre de la
 * clave.
 */
export function parseSecretsFile(secretsFilePath, options = {}) {
  const allowLegacyPreS7 = options.allowLegacyPreS7 === true
  const raw = readFileSync(secretsFilePath, 'utf8')
  const tokens = tokenizeSecretsFileLines(raw.split('\n'))

  let inventory = SECRETS_FILE_KEY_INVENTORY
  if (allowLegacyPreS7) {
    const presentKeys = new Set(tokens.map((t) => t.key))
    inventory = detectSchemaVersionFromKeys(presentKeys) === LEGACY_PRE_S7_SCHEMA_VERSION ? LEGACY_PRE_S7_KEY_INVENTORY : SECRETS_FILE_KEY_INVENTORY
  }

  const result = {}
  for (const { key, value, lineNumber } of tokens) {
    if (!inventory.includes(key)) {
      throw new SecretsFileParseError(`Clave "${key}" (línea ${lineNumber}) no está en el inventario cerrado — rechazada.`)
    }
    result[key] = value
  }

  return result
}

/**
 * Construye el objeto `env` completo para `child_process.spawn` —
 * allowlist base del propio operador (`BASE_ENV_ALLOWLIST`) + las claves
 * de `$SECRETS_FILE` (ya validadas por `parseSecretsFile`) + los
 * `extraVars` explícitos que el propio orquestador quiera fijar (p. ej.
 * `PORT`/`HOST`) — nunca `...process.env` sin filtrar. `options` se
 * reenvía tal cual a `parseSecretsFile` (ver `allowLegacyPreS7` arriba);
 * ausente, el comportamiento es idéntico al de siempre.
 */
export function buildChildEnv(secretsFilePath, extraVars = {}, options = {}) {
  const secrets = parseSecretsFile(secretsFilePath, options)
  const env = {}
  for (const key of BASE_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]
    }
  }
  Object.assign(env, secrets, extraVars)
  return env
}

/**
 * Entorno del proceso hijo de `probes/s6ArtifactMaintenance.mts`
 * (`inspect`/`remove`, vía `run-tsx.mjs`) — la sonda MÁS mínima de las
 * cuatro de S6: importa ÚNICAMENTE `shared/secureArtifact.mts` (nunca
 * `server/env.ts`, nunca `otpService.ts`/`redis.ts`), así que no necesita
 * NINGÚN secreto — solo la allowlist base del operador. Valida
 * `$SECRETS_FILE` COMPLETO contra el inventario cerrado que corresponda
 * (`allowLegacyPreS7:true` — S6 corre siempre ANTES que S7, nunca puede
 * exigir que S7 ya haya migrado nada), pero no exige que ninguna clave en
 * particular esté presente ni copia nada de su contenido al hijo — a
 * propósito distinta de `buildS6CryptoProbeEnv` (más abajo): exigir aquí las
 * mismas claves "reales" que sí necesitan las sondas criptográficas
 * bloquearía la propia inspección del artefacto (que se ejecuta ANTES de
 * `enter_gate`, precisamente para poder fallar sin tocar nada) ante
 * cualquier archivo incompleto, no solo uno realmente legacy.
 */
export function buildS6ArtifactProbeEnv(secretsFilePath, extraVars = {}) {
  parseSecretsFile(secretsFilePath, { allowLegacyPreS7: true })
  const env = {}
  for (const key of BASE_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]
    }
  }
  Object.assign(env, extraVars)
  return env
}

/**
 * Claves REALES (nunca un placeholder) que las sondas CRIPTOGRÁFICAS de
 * la puerta S6 (`s6PreRotationProbe.mts`/`s6PostRotationVerification.mts`
 * — nunca `s6ArtifactMaintenance.mts`, ver `buildS6ArtifactProbeEnv`
 * arriba) sí necesitan — ver la auditoría de impacto citada en
 * `gate_s6()` (rotate-all-interactive.sh): únicamente
 * PAYLOAD_SECRET/OTP_HMAC_SECRET/AUTH_RATE_LIMIT_HMAC_SECRET, más lo que
 * Redis/Postgres/Payload necesitan para que `server/env.ts` (Zod) pueda
 * resolver un `serverEnv` válido en el proceso hijo. Auditado import por
 * import (`s6PreRotationProbe.mts`/`s6PostRotationVerification.mts` y sus
 * dependencias transitivas, `otpService.ts`/`rateLimit.ts`/`redis.ts`/
 * `payload.env.ts`): NINGUNO importa `server/booking/db/client.ts` ni
 * `server/crypto/fieldCrypto.ts` — ningún secreto de booking se lee ni se
 * usa jamás.
 */
const S6_PROJECTION_KEYS = [
  'DATABASE_URL_CMS',
  'DATABASE_URL_AUTH',
  'DATABASE_URL_BOOKING',
  'REDIS_URL',
  'REDIS_KEY_PREFIX',
  'PAYLOAD_SECRET',
  'OTP_HMAC_SECRET',
  'AUTH_RATE_LIMIT_HMAC_SECRET',
]

/**
 * Los 9 campos de booking que `server/env.ts` (Zod, `restEnvSchema`)
 * exige SIN valor por defecto — así que importar `serverEnv` (que
 * `otpService.ts`/`redis.ts`/las propias sondas hacen, transitivamente,
 * siempre) falla si faltan, aunque la sonda en cuestión nunca los lea.
 * Placeholders CERRADOS, generados por CSPRNG en memoria en cada
 * llamada — NUNCA derivados de ningún valor real (ni legacy ni activo)
 * del archivo externo, nunca escritos a disco, nunca reenviados fuera
 * del `env` de este único proceso hijo desechable. Solo satisfacen la
 * FORMA que Zod exige (JSON `{"<versión>":"<secreto>"}` con la versión
 * activa presente en el mapa, longitudes mínimas) — ninguna sonda de S6
 * los lee jamás (ver `S6_PROJECTION_KEYS` de arriba, que los excluye a
 * propósito).
 */
function buildS6BookingPlaceholders() {
  const version = 's6-placeholder'
  const aesKey = () => randomBytes(32).toString('base64')
  const hmacSecret = () => randomBytes(32).toString('base64')
  return {
    BOOKING_FIELD_ENCRYPTION_KEYS: JSON.stringify({ [version]: aesKey() }),
    BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: version,
    BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: JSON.stringify({ [version]: hmacSecret() }),
    BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION: version,
    BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: JSON.stringify({ [version]: hmacSecret() }),
    BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION: version,
    BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: JSON.stringify({ [version]: hmacSecret() }),
    BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION: version,
    BOOKING_INTERNAL_API_SECRET: hmacSecret(),
  }
}

/**
 * Entorno del proceso hijo EXCLUSIVO de las sondas de S6
 * (`probes/s6*.mts`, vía `run-tsx.mjs`) — la proyección MÍNIMA que pide
 * el Bloque 8: acepta `$SECRETS_FILE` en esquema "active" O
 * "legacy-pre-s7" (`allowLegacyPreS7:true` — S6 corre siempre ANTES que
 * S7 en el recorrido S1..S9, así que nunca puede exigir que S7 ya haya
 * migrado nada), valida el archivo COMPLETO contra el inventario cerrado
 * que corresponda (rechaza cualquier clave desconocida, igual que
 * siempre), pero SOLO copia al hijo las claves de `S6_PROJECTION_KEYS` —
 * los dos secretos legacy de booking-email/access-token, si están
 * presentes, se VALIDAN pero JAMÁS se propagan a este proceso, que no los
 * necesita. Los 9 campos de booking que Zod exige incondicionalmente se
 * rellenan con placeholders opacos (`buildS6BookingPlaceholders`) — nunca
 * con el valor real, legacy o activo.
 */
export function buildS6CryptoProbeEnv(secretsFilePath, extraVars = {}) {
  const secrets = parseSecretsFile(secretsFilePath, { allowLegacyPreS7: true })
  const env = {}
  for (const key of BASE_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]
    }
  }
  for (const key of S6_PROJECTION_KEYS) {
    if (secrets[key] === undefined) {
      throw new SecretsFileParseError(`Falta la clave obligatoria "${key}" para construir la proyección mínima de S6.`)
    }
    env[key] = secrets[key]
  }
  Object.assign(env, buildS6BookingPlaceholders(), extraVars)
  return env
}
