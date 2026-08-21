#!/usr/bin/env node
// Pruebas de lib/loadSecretsEnv.mjs — parseo estricto de $SECRETS_FILE
// (esquema "active", sin cambios) y del esquema TRANSICIONAL nuevo
// (Bloque 8: `allowLegacyPreS7`, `detectSchemaVersionFromKeys`,
// `buildS6CryptoProbeEnv`). Ficheros SINTÉTICOS únicamente — nunca toca
// `.env`/`~/.gapssa-secrets` reales, nunca ejecuta S6/S7 real.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  parseSecretsFile,
  buildChildEnv,
  buildS6ArtifactProbeEnv,
  buildS6CryptoProbeEnv,
  detectSchemaVersionFromKeys,
  SecretsFileParseError,
  SECRETS_FILE_KEY_INVENTORY,
  LEGACY_PRE_S7_KEY_INVENTORY,
  LEGACY_ONLY_KEYS,
  ACTIVE_SCHEMA_VERSION,
  LEGACY_PRE_S7_SCHEMA_VERSION,
} from './loadSecretsEnv.mjs'
import { LEGACY_PRE_S7_KEY_INVENTORY as BACKUP_SCHEMA_LEGACY_INVENTORY, ACTIVE_SCHEMA_VERSION as BACKUP_ACTIVE_VERSION, LEGACY_PRE_S7_SCHEMA_VERSION as BACKUP_LEGACY_VERSION } from './backupSchema.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

function expectThrow(fn) {
  try {
    fn()
    return null
  } catch (err) {
    return err
  }
}

let tmpDir
function writeSecretsFile(name, content) {
  if (!tmpDir) {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gapssa-loadSecretsEnv-test-'))
  }
  const filePath = path.join(tmpDir, name)
  writeFileSync(filePath, content, { mode: 0o600 })
  return filePath
}

// Valores ficticios COMPLETOS para cada esquema, construidos a partir del
// propio inventario cerrado (nunca una lista mantenida a mano aparte) —
// mismo patrón que backupSchema.test.mjs.
function fictitiousValueFor(key) {
  if (key === 'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION') return 'v1'
  if (key === 'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION') return 'v1'
  if (key === 'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION') return 'v1'
  if (key === 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION') return 'v1'
  if (key === 'BOOKING_FIELD_ENCRYPTION_KEYS') return '{"v1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}'
  if (key === 'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS') return '{"v1":"valor-ficticio-de-al-menos-32-caracteres"}'
  if (key === 'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS') return '{"v1":"valor-ficticio-de-al-menos-32-caracteres"}'
  if (key === 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS') return '{"v1":"valor-ficticio-de-al-menos-32-caracteres"}'
  if (key === 'DATABASE_URL_AUTH' || key === 'DATABASE_URL_BOOKING' || key === 'DATABASE_URL_CMS') return 'postgres://user:pass@localhost:5432/db'
  if (key === 'REDIS_URL') return 'redis://localhost:6379'
  return `valor-ficticio-${key.toLowerCase()}`
}

function fullActiveBody() {
  return SECRETS_FILE_KEY_INVENTORY.map((k) => `${k}=${fictitiousValueFor(k)}`).join('\n') + '\n'
}

function fullLegacyBody() {
  return LEGACY_PRE_S7_KEY_INVENTORY.map((k) => `${k}=${fictitiousValueFor(k)}`).join('\n') + '\n'
}

// --- consistencia entre las dos copias independientes (loadSecretsEnv.mjs / backupSchema.mjs) ---
{
  const a = [...LEGACY_PRE_S7_KEY_INVENTORY].sort()
  const b = [...BACKUP_SCHEMA_LEGACY_INVENTORY].sort()
  ok('LEGACY_PRE_S7_KEY_INVENTORY coincide exactamente entre loadSecretsEnv.mjs y backupSchema.mjs', JSON.stringify(a) === JSON.stringify(b))
  ok('ACTIVE_SCHEMA_VERSION coincide entre los dos módulos', ACTIVE_SCHEMA_VERSION === BACKUP_ACTIVE_VERSION)
  ok('LEGACY_PRE_S7_SCHEMA_VERSION coincide entre los dos módulos', LEGACY_PRE_S7_SCHEMA_VERSION === BACKUP_LEGACY_VERSION)
}

// --- detectSchemaVersionFromKeys: pura ---
{
  ok('detecta "active" con los 2 marcadores plurales presentes', detectSchemaVersionFromKeys(new Set(['BOOKING_EMAIL_LOOKUP_HMAC_SECRETS', 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS'])) === ACTIVE_SCHEMA_VERSION)
  ok('detecta "active" con solo 1 de los 2 marcadores plurales', detectSchemaVersionFromKeys(new Set(['BOOKING_EMAIL_LOOKUP_HMAC_SECRETS'])) === ACTIVE_SCHEMA_VERSION)
  ok('detecta "legacy-pre-s7" con los 2 marcadores singulares presentes', detectSchemaVersionFromKeys(new Set(LEGACY_ONLY_KEYS)) === LEGACY_PRE_S7_SCHEMA_VERSION)
  ok('detecta "legacy-pre-s7" con solo 1 de los 2 marcadores singulares', detectSchemaVersionFromKeys(new Set(['BOOKING_EMAIL_LOOKUP_HMAC_SECRET'])) === LEGACY_PRE_S7_SCHEMA_VERSION)
  ok('sin ningún marcador: por defecto "active"', detectSchemaVersionFromKeys(new Set(['FOO'])) === ACTIVE_SCHEMA_VERSION)
  const err = expectThrow(() => detectSchemaVersionFromKeys(new Set(['BOOKING_EMAIL_LOOKUP_HMAC_SECRETS', 'BOOKING_EMAIL_LOOKUP_HMAC_SECRET'])))
  ok('mezcla plural + singular: rechazada', err instanceof SecretsFileParseError)
}

// --- parseSecretsFile SIN allowLegacyPreS7 (comportamiento POR DEFECTO — S9/start-apps-web.mjs) ---
{
  const filePath = writeSecretsFile('active-strict.env', fullActiveBody())
  const parsed = parseSecretsFile(filePath)
  ok('esquema active completo: parsea sin flag', parsed.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS !== undefined)
}
{
  // Exactamente el escenario reportado: BOOKING_EMAIL_LOOKUP_HMAC_SECRET
  // (legacy, singular) presente, SIN flag -- debe rechazarse igual que
  // siempre (S9 nunca tolera legacy, cero cambio de comportamiento).
  const filePath = writeSecretsFile('legacy-strict-rejected.env', fullLegacyBody())
  const err = expectThrow(() => parseSecretsFile(filePath))
  ok('esquema legacy-pre-s7 SIN flag: rechazado (comportamiento por defecto sin cambios -- S9 exige inventario final sin legacy keys)', err instanceof SecretsFileParseError)
  ok('mensaje de rechazo cita la clave legacy, nunca un valor', /BOOKING_EMAIL_LOOKUP_HMAC_SECRET/.test(err?.message ?? '') && !/valor-ficticio/.test(err?.message ?? ''))
}
{
  const filePath = writeSecretsFile('active-strict-nofn.env', fullActiveBody())
  ok('buildChildEnv SIN options (firma de start-apps-web.mjs): sigue funcionando exactamente igual', buildChildEnv(filePath).BOOKING_EMAIL_LOOKUP_HMAC_SECRETS !== undefined)
}

// --- parseSecretsFile CON allowLegacyPreS7 ---
{
  const filePath = writeSecretsFile('legacy-tolerant.env', fullLegacyBody())
  const parsed = parseSecretsFile(filePath, { allowLegacyPreS7: true })
  ok('esquema legacy-pre-s7 CON flag: parsea, expone las 2 claves legacy', parsed.BOOKING_EMAIL_LOOKUP_HMAC_SECRET !== undefined && parsed.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET !== undefined)
  ok('esquema legacy-pre-s7 CON flag: las claves plurales NO están presentes (esquemas mutuamente excluyentes)', parsed.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS === undefined)
}
{
  const filePath = writeSecretsFile('active-tolerant.env', fullActiveBody())
  const parsed = parseSecretsFile(filePath, { allowLegacyPreS7: true })
  ok('esquema active CON flag: sigue aceptando active con normalidad (flag no relaja nada del lado active)', parsed.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS !== undefined)
}
{
  // Duplicada: la MISMA clave legacy dos veces.
  const body = fullLegacyBody() + 'BOOKING_EMAIL_LOOKUP_HMAC_SECRET=otro-valor\n'
  const filePath = writeSecretsFile('legacy-duplicate.env', body)
  const err = expectThrow(() => parseSecretsFile(filePath, { allowLegacyPreS7: true }))
  ok('clave legacy duplicada: rechazada incluso con el flag activo', err instanceof SecretsFileParseError && /duplicada/.test(err.message))
}
{
  // Clave desconocida: ni en el inventario active ni en el legacy.
  const body = fullLegacyBody() + 'CLAVE_TOTALMENTE_DESCONOCIDA=x\n'
  const filePath = writeSecretsFile('legacy-unknown-key.env', body)
  const err = expectThrow(() => parseSecretsFile(filePath, { allowLegacyPreS7: true }))
  ok('clave desconocida (ni active ni legacy): rechazada', err instanceof SecretsFileParseError && /CLAVE_TOTALMENTE_DESCONOCIDA/.test(err.message))
}
{
  // Falta una de las dos legacy -- el archivo mezclaría "casi legacy" con
  // un hueco: sigue detectándose como legacy-pre-s7 (1 marcador basta) y
  // el inventario cerrado simplemente no incluye la que falta -- el
  // archivo parsea igual (el chequeo de "obligatoria ausente" es
  // responsabilidad de otra capa, backupSchema.mjs, no de este parser).
  const body = LEGACY_PRE_S7_KEY_INVENTORY.filter((k) => k !== 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET')
    .map((k) => `${k}=${fictitiousValueFor(k)}`)
    .join('\n')
  const filePath = writeSecretsFile('legacy-one-missing.env', body + '\n')
  const parsed = parseSecretsFile(filePath, { allowLegacyPreS7: true })
  ok('falta una de las 2 legacy: el parser no la exige (solo valida las presentes) -- sigue siendo legacy-pre-s7 por el marcador restante', parsed.BOOKING_EMAIL_LOOKUP_HMAC_SECRET !== undefined && parsed.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET === undefined)
}
{
  // Mezcla real: plural Y singular del MISMO campo a la vez.
  const body = fullActiveBody() + 'BOOKING_EMAIL_LOOKUP_HMAC_SECRET=valor-legacy\n'
  const filePath = writeSecretsFile('mixed.env', body)
  const err = expectThrow(() => parseSecretsFile(filePath, { allowLegacyPreS7: true }))
  ok('mezcla plural+singular con el flag activo: rechazada, nunca "la más reciente gana"', err instanceof SecretsFileParseError && /mezcla/.test(err.message))
}

// --- buildS6ArtifactProbeEnv: s6ArtifactMaintenance.mts (inspect/remove) no necesita NINGÚN secreto ---
{
  const filePath = writeSecretsFile('legacy-for-s6-artifact.env', fullLegacyBody())
  const env = buildS6ArtifactProbeEnv(filePath)
  ok('buildS6ArtifactProbeEnv sobre legacy-pre-s7: NUNCA lanza', typeof env === 'object' && env !== null)
  ok('buildS6ArtifactProbeEnv: no copia NINGÚN secreto del archivo (ni real ni placeholder)', env.PAYLOAD_SECRET === undefined && env.BOOKING_EMAIL_LOOKUP_HMAC_SECRET === undefined && env.REDIS_KEY_PREFIX === undefined)
  ok('buildS6ArtifactProbeEnv: sí incluye los extraVars explícitos del llamador', buildS6ArtifactProbeEnv(filePath, { NODE_OPTIONS: '--conditions=react-server' }).NODE_OPTIONS === '--conditions=react-server')
}
{
  // Regresión real (Bloque 8): un archivo incompleto (aquí, sin
  // REDIS_KEY_PREFIX -- una clave NO relacionada con legacy/active en
  // absoluto) NUNCA debe bloquear la inspección del artefacto, que se
  // ejecuta ANTES de enter_gate precisamente para poder fallar sin tocar
  // nada -- exigir aquí las mismas claves que sí necesita la sonda
  // criptográfica rompería la inspección ante cualquier archivo
  // incompleto, no solo uno legacy.
  const body = LEGACY_PRE_S7_KEY_INVENTORY.filter((k) => k !== 'REDIS_KEY_PREFIX')
    .map((k) => `${k}=${fictitiousValueFor(k)}`)
    .join('\n')
  const filePath = writeSecretsFile('legacy-missing-redis-prefix.env', body + '\n')
  ok('buildS6ArtifactProbeEnv NUNCA exige REDIS_KEY_PREFIX (a diferencia de buildS6CryptoProbeEnv) -- no bloquea la inspección de artefacto por un archivo incompleto', !expectThrow(() => buildS6ArtifactProbeEnv(filePath)))
}
{
  // Clave desconocida: buildS6ArtifactProbeEnv SÍ debe seguir validando
  // el archivo completo (rechaza lo que no está en ningún inventario
  // cerrado), aunque no propague nada de él.
  const body = fullLegacyBody() + 'CLAVE_DESCONOCIDA=x\n'
  const filePath = writeSecretsFile('legacy-artifact-unknown.env', body)
  const err = expectThrow(() => buildS6ArtifactProbeEnv(filePath))
  ok('buildS6ArtifactProbeEnv sigue validando el archivo completo (clave desconocida rechazada)', err instanceof SecretsFileParseError)
}

// --- buildS6CryptoProbeEnv: proyección mínima ---
{
  const filePath = writeSecretsFile('legacy-for-s6.env', fullLegacyBody())
  const env = buildS6CryptoProbeEnv(filePath)
  ok('buildS6CryptoProbeEnv sobre legacy-pre-s7: NUNCA lanza (S6 no puede exigir el esquema post-S7 antes de que S7 corra)', env.PAYLOAD_SECRET !== undefined)
  ok('proyección S6: incluye PAYLOAD_SECRET/OTP_HMAC_SECRET/AUTH_RATE_LIMIT_HMAC_SECRET reales', env.PAYLOAD_SECRET === fictitiousValueFor('PAYLOAD_SECRET') && env.OTP_HMAC_SECRET === fictitiousValueFor('OTP_HMAC_SECRET') && env.AUTH_RATE_LIMIT_HMAC_SECRET === fictitiousValueFor('AUTH_RATE_LIMIT_HMAC_SECRET'))
  ok('proyección S6: NUNCA incluye el valor legacy real de booking-email/access-token', env.BOOKING_EMAIL_LOOKUP_HMAC_SECRET === undefined && env.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET === undefined)
  ok('proyección S6: los 9 campos de booking que Zod exige llegan como placeholder, con forma válida', typeof env.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS === 'string' && JSON.parse(env.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS)[env.BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION]?.length >= 32)
  ok('proyección S6: el placeholder de BOOKING_INTERNAL_API_SECRET nunca es el valor real del archivo', env.BOOKING_INTERNAL_API_SECRET !== fictitiousValueFor('BOOKING_INTERNAL_API_SECRET'))
}
{
  const filePath = writeSecretsFile('active-for-s6.env', fullActiveBody())
  const env = buildS6CryptoProbeEnv(filePath)
  ok('buildS6CryptoProbeEnv sobre un archivo YA active: también funciona (no depende de qué esquema tenga el archivo)', env.PAYLOAD_SECRET !== undefined)
  ok('proyección S6 sobre active: el mapa REAL de booking-email tampoco se propaga (siempre placeholder, nunca el real ni el legacy)', env.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS !== fictitiousValueFor('BOOKING_EMAIL_LOOKUP_HMAC_SECRETS'))
}
{
  // Dos llamadas -> dos placeholders distintos (CSPRNG, nunca un valor fijo reutilizable).
  const filePath = writeSecretsFile('active-for-s6-random.env', fullActiveBody())
  const envA = buildS6CryptoProbeEnv(filePath)
  const envB = buildS6CryptoProbeEnv(filePath)
  ok('los placeholders de booking son distintos entre invocaciones (CSPRNG, nunca un valor fijo)', envA.BOOKING_INTERNAL_API_SECRET !== envB.BOOKING_INTERNAL_API_SECRET)
}
{
  const body = LEGACY_PRE_S7_KEY_INVENTORY.filter((k) => k !== 'PAYLOAD_SECRET')
    .map((k) => `${k}=${fictitiousValueFor(k)}`)
    .join('\n')
  const filePath = writeSecretsFile('legacy-missing-payload.env', body + '\n')
  const err = expectThrow(() => buildS6CryptoProbeEnv(filePath))
  ok('buildS6CryptoProbeEnv falla cerrado si falta una clave REAL que sí necesita (PAYLOAD_SECRET)', err instanceof SecretsFileParseError)
}

rmSync(tmpDir, { recursive: true, force: true })

summarizeAndExit()
