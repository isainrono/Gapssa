// Parser compartido del CONTENIDO DESCIFRADO de un backup de
// scripts/secrets-rotation/ (nunca del $SECRETS_FILE real en disco, que
// sigue siendo responsabilidad exclusiva de loadSecretsEnv.mjs y NUNCA
// lleva esta etiqueta).
//
// Cada backup que este toolkit cifra incluye, como PRIMERA línea de su
// contenido en claro (dentro del propio cifrado — nunca en un fichero ni
// metadato sin cifrar aparte), una etiqueta de versión de esquema:
//
//   __GAPSSA_BACKUP_SCHEMA_VERSION__=active
//
// Restaurar un backup nunca "adivina" el formato por qué claves contiene
// — siempre lee esta etiqueta primero y elige el inventario cerrado
// correspondiente. Un backup sin esta línea, con una versión desconocida,
// o con claves fuera del inventario de SU versión declarada, se rechaza.
//
// Dos versiones cerradas hoy:
//   - "active"          — inventario final actual (SECRETS_FILE_KEY_INVENTORY
//                          de loadSecretsEnv.mjs: nombres de booking
//                          plurales/versionados).
//   - "legacy-pre-s7"    — inventario de backups anteriores al rediseño
//                          versionado de S7: nombres de booking singulares
//                          sin versión, y PROHÍBE simultáneamente los
//                          nombres plurales para no dejar ambigüedad sobre
//                          qué variante manda.
// Si en el futuro hace falta un estado de convivencia (durante la propia
// migración S7), se declarará explícitamente como una TERCERA versión
// cerrada — nunca se relaja "active" ni "legacy-pre-s7" para cubrirlo.
//
// El parser que arranca apps/web/S6/S7/S9 (loadSecretsEnv.mjs) NUNCA pasa
// por aquí y nunca acepta esta etiqueta ni el inventario "legacy-pre-s7"
// — solo entiende el formato "active" final, leído directamente de
// $SECRETS_FILE.

import { SECRETS_FILE_KEY_INVENTORY } from './loadSecretsEnv.mjs'

export const SCHEMA_TAG_KEY = '__GAPSSA_BACKUP_SCHEMA_VERSION__'

export const ACTIVE_SCHEMA_VERSION = 'active'
export const LEGACY_PRE_S7_SCHEMA_VERSION = 'legacy-pre-s7'
export const KNOWN_SCHEMA_VERSIONS = [ACTIVE_SCHEMA_VERSION, LEGACY_PRE_S7_SCHEMA_VERSION]

const LEGACY_ONLY_KEYS = ['BOOKING_EMAIL_LOOKUP_HMAC_SECRET', 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET']
const ACTIVE_ONLY_KEYS_REPLACED_BY_LEGACY = [
  'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
  'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION',
]

/** Inventario "legacy-pre-s7": el activo menos las claves versionadas de booking-email/access-token, más sus predecesoras singulares. Cerrado — nunca contiene ambas variantes a la vez. */
export const LEGACY_PRE_S7_KEY_INVENTORY = [
  ...SECRETS_FILE_KEY_INVENTORY.filter((k) => !ACTIVE_ONLY_KEYS_REPLACED_BY_LEGACY.includes(k)),
  ...LEGACY_ONLY_KEYS,
]

export class BackupSchemaError extends Error {}

/** Devuelve el inventario cerrado correspondiente a una versión de esquema conocida. Lanza BackupSchemaError si la versión no es una de las declaradas. */
export function inventoryForSchemaVersion(version) {
  if (version === ACTIVE_SCHEMA_VERSION) return SECRETS_FILE_KEY_INVENTORY
  if (version === LEGACY_PRE_S7_SCHEMA_VERSION) return LEGACY_PRE_S7_KEY_INVENTORY
  throw new BackupSchemaError(`Versión de esquema de backup desconocida: "${version}".`)
}

// ---------------------------------------------------------------------------
// Claves OBLIGATORIAS (presentes y con valor no vacío) por versión de
// esquema — un backup que no las tenga TODAS no sirve para restaurar el
// sistema y se rechaza, aunque por lo demás sea sintácticamente válido
// (backup vacío, backup con solo la etiqueta, o con solo alguna variable
// no crítica, quedan cubiertos por esto).
//
// Clasificación derivada de dos fuentes de verdad existentes (nunca
// inventada aquí, para no crear una tercera lista divergente):
//
//   1. apps/web/src/server/env.ts (Zod, `restEnvSchema`) y
//      apps/web/src/payload.env.ts — TODAS las claves de secretos de la
//      app real que ese esquema exige sin valor por defecto se reflejan
//      aquí como obligatorias: PAYLOAD_SECRET (payload.env.ts),
//      OTP_HMAC_SECRET, AUTH_RATE_LIMIT_HMAC_SECRET,
//      BOOKING_FIELD_ENCRYPTION_KEYS(+_ACTIVE_KEY_VERSION),
//      BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS(+_ACTIVE_KEY_VERSION),
//      BOOKING_INTERNAL_API_SECRET, DATABASE_URL_AUTH,
//      DATABASE_URL_BOOKING, DATABASE_URL_CMS, REDIS_URL — y, solo bajo
//      "active", BOOKING_EMAIL_LOOKUP_HMAC_SECRETS(+_ACTIVE_KEY_VERSION)
//      y BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS(+_ACTIVE_KEY_VERSION)
//      (ese mismo esquema — env.test.ts línea ~221 — confirma que las
//      variantes singulares NUNCA satisfacen el campo plural, de ahí que
//      bajo "legacy-pre-s7" sean esas dos variantes singulares las
//      obligatorias en su lugar).
//      IMPORTANTE: esta lista es una copia sincronizada A MANO de esa
//      fuente (no se importa en vivo — apps/web es un workspace TS
//      /Next.js aparte, sin runtime compartido con estos scripts de
//      bash+Node planos) — si esos ficheros cambian qué es obligatorio,
//      esta lista debe actualizarse junto con ellos.
//      Deliberadamente EXCLUIDO de obligatorio: ESPOCRM_API_KEY — en
//      env.ts es *condicional* (solo obligatorio cuando
//      ESPO_BOOKING_ADAPTER=http; por defecto es "simulated"), así que
//      tratarlo aquí como obligatorio incondicional convertiría en
//      obligatoria una variable que en la app real no siempre lo es.
//
//   2. Credenciales de infraestructura Docker (Postgres/MariaDB/Redis/
//      EspoCRM) que ningún esquema de apps/web valida (son de la capa de
//      infra, no de la app Next.js) pero sin las cuales ninguna puerta
//      S2-S5 puede restaurar disponibilidad real — mismas en ambas
//      versiones de esquema, ya que la migración de S7 solo afecta a los
//      dos secretos de booking-email/access-token.
const MANDATORY_INFRA_KEYS = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'ESPOCRM_DB_USER',
  'ESPOCRM_DB_PASSWORD',
  'ESPOCRM_DB_ROOT_PASSWORD',
  'ESPOCRM_ADMIN_USERNAME',
  'ESPOCRM_ADMIN_PASSWORD',
  'REDIS_PASSWORD',
]

const MANDATORY_APP_RUNTIME_KEYS_COMMON = [
  'DATABASE_URL_AUTH',
  'DATABASE_URL_BOOKING',
  'DATABASE_URL_CMS',
  'REDIS_URL',
  'PAYLOAD_SECRET',
  'OTP_HMAC_SECRET',
  'AUTH_RATE_LIMIT_HMAC_SECRET',
  'BOOKING_FIELD_ENCRYPTION_KEYS',
  'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION',
  'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS',
  'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION',
  'BOOKING_INTERNAL_API_SECRET',
]

export const MANDATORY_KEYS_ACTIVE = [
  ...MANDATORY_INFRA_KEYS,
  ...MANDATORY_APP_RUNTIME_KEYS_COMMON,
  'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
  'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
  'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION',
]

export const MANDATORY_KEYS_LEGACY_PRE_S7 = [...MANDATORY_INFRA_KEYS, ...MANDATORY_APP_RUNTIME_KEYS_COMMON, ...LEGACY_ONLY_KEYS]

/** Devuelve el conjunto cerrado de claves OBLIGATORIAS de una versión de esquema conocida. Lanza BackupSchemaError si la versión no es una de las declaradas. */
export function mandatoryKeysForSchemaVersion(version) {
  if (version === ACTIVE_SCHEMA_VERSION) return MANDATORY_KEYS_ACTIVE
  if (version === LEGACY_PRE_S7_SCHEMA_VERSION) return MANDATORY_KEYS_LEGACY_PRE_S7
  throw new BackupSchemaError(`Versión de esquema de backup desconocida: "${version}".`)
}

const LINE_PATTERN = /^([A-Z_][A-Z0-9_]*)=(.*)$/

/**
 * Tokeniza un array de líneas KEY=VALUE (ya separadas por `\n`) — ignora
 * líneas vacías y comentarios (`#`), rechaza CRLF de forma explícita
 * (nunca lo normaliza en silencio — un CR podría ser la huella de un
 * backup/fichero corrupto o truncado), nunca recorta un `#` que aparezca
 * DESPUÉS de un `=` en la misma línea (el valor es siempre literal hasta
 * el final de línea), rechaza claves duplicadas y la clave reservada
 * `reservedKey` si reaparece. Nunca imprime ni incluye un valor en sus
 * mensajes de error — como mucho número de línea y nombre de clave.
 * Compartido por `parseTaggedPayload` (cuerpo tras la etiqueta) y
 * `parsePlainEnvEntries` (fichero llano sin etiqueta), para que las
 * reglas de formato nunca puedan divergir entre las dos rutas.
 */
function tokenizeEnvLines(lines, startLineNumber, reservedKey) {
  const entries = new Map()
  lines.forEach((line, index) => {
    const lineNumber = startLineNumber + index
    if (line === '' || line.startsWith('#')) {
      return
    }
    if (line.endsWith('\r')) {
      throw new BackupSchemaError(`Línea ${lineNumber} contiene retorno de carro (CRLF) — formato no válido, rechazado.`)
    }
    const match = LINE_PATTERN.exec(line)
    if (!match) {
      throw new BackupSchemaError(`Línea ${lineNumber} mal formada (no es KEY=VALUE).`)
    }
    const [, key, value] = match
    if (entries.has(key) || (reservedKey && key === reservedKey)) {
      throw new BackupSchemaError(`Clave duplicada o reservada "${key}" (línea ${lineNumber}).`)
    }
    entries.set(key, value)
  })
  return entries
}

/**
 * Tokeniza el contenido descifrado completo de un backup (Buffer, nunca
 * un fichero) — exige que la PRIMERA línea sea la etiqueta de esquema y
 * delega el resto en `tokenizeEnvLines`. Rechaza byte NUL.
 *
 * Devuelve { schemaVersion, entries: Map<clave,valor>, bodyStartOffset }
 * — bodyStartOffset es el índice de byte, en el Buffer original, del
 * primer byte DESPUÉS del salto de línea que cierra la etiqueta de
 * esquema; el llamador que necesite reescribir el cuerpo verbatim (sin
 * la etiqueta, preservando comentarios/blancos/orden exactos) debe usar
 * ese offset directamente sobre el Buffer original, nunca reconstruir el
 * texto a partir de `entries` (evita cualquier pérdida de fidelidad).
 */
export function parseTaggedPayload(buffer) {
  if (buffer.includes(0)) {
    throw new BackupSchemaError('El contenido contiene un byte NUL — rechazado.')
  }
  const text = buffer.toString('utf8')
  const firstNewline = text.indexOf('\n')
  const firstLineRaw = firstNewline === -1 ? text : text.slice(0, firstNewline)
  if (firstLineRaw.endsWith('\r')) {
    throw new BackupSchemaError('La línea de etiqueta de esquema contiene retorno de carro (CRLF) — formato no válido, rechazado.')
  }
  const tagMatch = LINE_PATTERN.exec(firstLineRaw)
  if (!tagMatch || tagMatch[1] !== SCHEMA_TAG_KEY) {
    throw new BackupSchemaError('Falta la metadata de versión de esquema (primera línea) o está mal formada — backup rechazado.')
  }
  const schemaVersion = tagMatch[2]
  if (!KNOWN_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw new BackupSchemaError(`Versión de esquema de backup desconocida: "${schemaVersion}".`)
  }
  if (firstNewline === -1) {
    return { schemaVersion, entries: new Map(), bodyStartOffset: Buffer.byteLength(text, 'utf8') }
  }
  const bodyStartOffset = Buffer.byteLength(text.slice(0, firstNewline + 1), 'utf8')
  const bodyLines = text.slice(firstNewline + 1).split('\n')
  const entries = tokenizeEnvLines(bodyLines, 2, SCHEMA_TAG_KEY)
  return { schemaVersion, entries, bodyStartOffset }
}

/**
 * Tokeniza un $SECRETS_FILE PLANO (Buffer, sin etiqueta de esquema —
 * exactamente el formato que loadSecretsEnv.mjs lee del archivo externo
 * real) — usada ÚNICAMENTE para validar el contenido ANTES de cifrarlo
 * en un backup nuevo (nunca para leer el propio $SECRETS_FILE en
 * producción, que sigue siendo responsabilidad exclusiva de
 * loadSecretsEnv.mjs). Rechaza byte NUL igual que parseTaggedPayload.
 */
export function parsePlainEnvEntries(buffer) {
  if (buffer.includes(0)) {
    throw new BackupSchemaError('El contenido contiene un byte NUL — rechazado.')
  }
  const text = buffer.toString('utf8')
  return tokenizeEnvLines(text.split('\n'), 1, null)
}

/**
 * Valida `entries` (ya tokenizadas por parseTaggedPayload, o construidas
 * a mano por un llamador que valide el $SECRETS_FILE plano ANTES de
 * cifrarlo) contra el inventario cerrado Y el conjunto de claves
 * OBLIGATORIAS de `schemaVersion`. Rechaza, en este orden:
 *
 *   1. cualquier clave fuera del inventario cerrado de esa versión —
 *      con un mensaje específico si la clave "de más" es exactamente
 *      una de las que pertenecen EN EXCLUSIVA a la otra versión (mezcla
 *      legacy/active), para que el motivo quede claro sin ambigüedad;
 *   2. cualquier clave obligatoria ausente;
 *   3. cualquier clave obligatoria presente pero con valor vacío (una
 *      variable "obligatoria y no admite vacío" — las claves que SÍ
 *      pueden legítimamente estar vacías, p. ej. flags opcionales,
 *      nunca están en el conjunto de obligatorias, así que esta regla
 *      nunca las alcanza).
 *
 * Un cuerpo vacío (backup con solo la etiqueta de esquema, sin ninguna
 * línea más) cae automáticamente en el paso 2 — el conjunto de
 * obligatorias nunca está vacío para ninguna versión declarada.
 */
export function validateEntriesAgainstSchema(schemaVersion, entries) {
  const inventory = inventoryForSchemaVersion(schemaVersion)
  const otherVersion = schemaVersion === ACTIVE_SCHEMA_VERSION ? LEGACY_PRE_S7_SCHEMA_VERSION : ACTIVE_SCHEMA_VERSION
  const otherVersionExclusiveKeys = schemaVersion === ACTIVE_SCHEMA_VERSION ? LEGACY_ONLY_KEYS : ACTIVE_ONLY_KEYS_REPLACED_BY_LEGACY

  for (const key of entries.keys()) {
    if (inventory.includes(key)) continue
    if (otherVersionExclusiveKeys.includes(key)) {
      throw new BackupSchemaError(
        `Clave "${key}" pertenece al esquema "${otherVersion}", no a "${schemaVersion}" — mezcla de nombres legacy/active rechazada.`,
      )
    }
    throw new BackupSchemaError(`Clave "${key}" no está en el inventario cerrado de la versión de esquema "${schemaVersion}" — rechazada.`)
  }

  const mandatory = mandatoryKeysForSchemaVersion(schemaVersion)
  for (const key of mandatory) {
    if (!entries.has(key)) {
      throw new BackupSchemaError(`Falta la clave obligatoria "${key}" para la versión de esquema "${schemaVersion}" — backup incompleto, rechazado.`)
    }
    if (entries.get(key) === '') {
      throw new BackupSchemaError(`La clave obligatoria "${key}" está vacía — no se admite un valor vacío para esta variable.`)
    }
  }
}
