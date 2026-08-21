#!/usr/bin/env node
// scripts/secrets-rotation/lib/migrateLegacySecretsFileToActive.mjs
//
// Único punto del sistema autorizado a leer los dos secretos legacy
// (BOOKING_EMAIL_LOOKUP_HMAC_SECRET / BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET)
// — EXCLUSIVAMENTE para migrarlos. Invocado por `gate_s7()`
// (rotate-all-interactive.sh) ANTES de cualquier sonda que exija el
// esquema "active" completo (s7MigrateAndAudit.mts, que transitivamente
// importa `serverEnv` vía `bookingDb`/`fieldCrypto.ts` y por tanto NUNCA
// puede arrancar contra un archivo todavía en forma legacy-pre-s7 — ver
// Bloque 8, README.md).
//
// El valor legacy se preserva EXACTO bajo la versión "v1" del mapa
// correspondiente — este script NUNCA genera un valor nuevo (esa es tarea
// de gate_s7() más adelante, que activa v3 sobre el mapa ya migrado) — así
// que cualquier HMAC/ciphertext ya calculado con el valor legacy sigue
// siendo verificable bajo esa misma versión "v1": cero pérdida de
// verificabilidad histórica.
//
// Lee $SECRETS_FILE con `parseSecretsFile(..., { allowLegacyPreS7: true })`
// (lib/loadSecretsEnv.mjs) — mismo inventario cerrado, mismo rechazo de
// cualquier clave desconocida o mezcla — transforma en memoria, y
// reescribe el archivo preservando verbatim cualquier otra línea (orden,
// comentarios, blancos): solo las 2 líneas legacy se sustituyen, cada una
// por sus 2 líneas activas equivalentes. Idempotente: si el archivo ya
// está en esquema "active", no escribe nada.
//
// Bloque 9 (S7 atómico y reanudable): la escritura ya NUNCA usa
// `openSync(path, 'w')` (equivalente a O_TRUNC — sin temporal, sin
// fsync, sin rename, sin fsync de directorio) — reutiliza EXACTAMENTE el
// mismo patrón atómico que updateSecretsFileField.mjs/
// atomicSecretsFileMutate.mjs: el llamador en bash crea y fija un
// temporal 600 en el MISMO directorio ANTES de invocar este script
// (gapssa_secrets_mktemp_secure_same_dir), este script lo abre con
// O_NOFOLLOW, verifica su identidad por fstat contra el pin, escribe +
// fsync, revalida por lstat justo antes del rename, hace el rename
// atómico, verifica el destino, hace fsync del directorio contenedor, y
// relee el documento completo para confirmar que lo que quedó en disco
// es exactamente lo escrito.
//
// Uso: node migrateLegacySecretsFileToActive.mjs <secretsFilePath> <tempPath> <dev> <ino> <uid> <modo-octal>
//   exit 0  = migrado con éxito, o el archivo YA estaba en esquema
//             "active" (no-op idempotente — el temporal pre-creado por
//             el llamador NUNCA se consume en este caso; es
//             responsabilidad del llamador en bash retirarlo de forma
//             síncrona y determinista contra la identidad ya fijada,
//             nunca de un operador humano)
//   exit 1  = uso incorrecto
//   exit 2  = el archivo no está en un esquema reconocible para esta
//             operación (mezcla, clave desconocida, legacy incompleta) —
//             rechazado, nunca escrito
//   exit 10 = identidad del temporal no coincide con el pin ANTES de
//             escribir — nada se ha escrito
//   exit 11 = identidad del temporal no coincide con el pin JUSTO ANTES
//             del rename — el rename NUNCA se ejecuta en este caso
//   exit 12 = el propio rename falló
//   exit 13 = el destino tras el rename no corresponde al inodo
//             esperado, o la relectura final no coincide con lo escrito

import { readFileSync, realpathSync, openSync, closeSync, fstatSync, lstatSync, ftruncateSync, writeSync, fsyncSync, renameSync, constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSecretsFile, SecretsFileParseError, LEGACY_ONLY_KEYS } from './loadSecretsEnv.mjs'

const LEGACY_TO_ACTIVE_FIELD = {
  BOOKING_EMAIL_LOOKUP_HMAC_SECRET: {
    mapKey: 'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
    versionKey: 'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION',
  },
  BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET: {
    mapKey: 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
    versionKey: 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION',
  },
}
const PRESERVED_VERSION = 'v1'
const LINE_PATTERN = /^([A-Z_][A-Z0-9_]*)=(.*)$/

export class LegacyMigrationError extends Error {}

/**
 * Función pura: dado el TEXTO crudo de $SECRETS_FILE y sus `entries` ya
 * parseadas/validadas (`parseSecretsFile(..., { allowLegacyPreS7: true })`),
 * decide si hace falta migrar y devuelve el texto completo resultante —
 * mismo orden/comentarios/líneas en blanco que el original, verbatim;
 * SOLO las 2 líneas legacy se sustituyen (cada una por 2 líneas nuevas).
 * Nunca escribe nada — eso es responsabilidad exclusiva del CLI, más
 * abajo. Exige que las DOS legacy estén presentes y no vacías — nunca
 * migra una sola dejando la otra a medias.
 */
export function migrateSecretsFileText(rawText, entries) {
  const presentKeys = new Set(Object.keys(entries))
  const hasAnyLegacy = LEGACY_ONLY_KEYS.some((k) => presentKeys.has(k))
  if (!hasAnyLegacy) {
    return { changed: false, text: rawText }
  }
  for (const legacyKey of LEGACY_ONLY_KEYS) {
    if (!presentKeys.has(legacyKey)) {
      throw new LegacyMigrationError(`Falta la clave legacy "${legacyKey}" — migración parcial rechazada (las dos deben migrarse a la vez).`)
    }
    if (entries[legacyKey] === '') {
      throw new LegacyMigrationError(`La clave legacy "${legacyKey}" está vacía — no se puede migrar un valor vacío.`)
    }
  }

  const lines = rawText.split('\n')
  const out = []
  for (const line of lines) {
    const match = LINE_PATTERN.exec(line)
    const key = match ? match[1] : null
    if (key && Object.prototype.hasOwnProperty.call(LEGACY_TO_ACTIVE_FIELD, key)) {
      const { mapKey, versionKey } = LEGACY_TO_ACTIVE_FIELD[key]
      const value = entries[key]
      out.push(`${mapKey}=${JSON.stringify({ [PRESERVED_VERSION]: value })}`)
      out.push(`${versionKey}=${PRESERVED_VERSION}`)
      continue
    }
    out.push(line)
  }
  return { changed: true, text: out.join('\n') }
}

function readAndValidate(secretsFilePath) {
  const rawText = readFileSync(secretsFilePath, 'utf8')
  const entries = parseSecretsFile(secretsFilePath, { allowLegacyPreS7: true })
  return { rawText, entries }
}

function matchesPinFactory(expectedDev, expectedIno, expectedUid, expectedMode) {
  return (st) => st.isFile() && st.dev === expectedDev && st.ino === expectedIno && st.uid === expectedUid && (st.mode & 0o777) === expectedMode
}

/**
 * Escribe `text` en `secretsFilePath` con el patrón atómico completo
 * (temporal ya pinneado por el llamador -> fsync -> revalidar -> rename
 * -> verificar destino -> fsync de directorio -> relectura). Termina el
 * proceso con el código de salida correspondiente en cualquier fallo —
 * nunca deja el temporal a medio escribir ni el destino sin verificar.
 */
function writeInPlaceAtomic(secretsFilePath, tempPath, matchesPin, expectedDev, text) {
  let fd
  try {
    fd = openSync(tempPath, constants.O_WRONLY | constants.O_NOFOLLOW)
  } catch (err) {
    console.error(`ERROR: no se pudo abrir el temporal (${err.code ?? err.message}).`)
    process.exit(10)
  }
  try {
    const st = fstatSync(fd)
    if (!matchesPin(st)) {
      console.error('ERROR: el temporal cambió de identidad (device/inode/propietario/modo no coinciden) — posible sustitución. Nada se ha escrito.')
      closeSync(fd)
      process.exit(10)
    }
  } catch (err) {
    console.error(`ERROR al verificar la identidad del temporal: ${err.message}`)
    closeSync(fd)
    process.exit(10)
  }

  const buffer = Buffer.from(text, 'utf8')
  try {
    ftruncateSync(fd, 0)
    let written = 0
    while (written < buffer.length) {
      written += writeSync(fd, buffer, written, buffer.length - written, written)
    }
    fsyncSync(fd)
  } catch (err) {
    console.error(`ERROR al escribir/fsync el temporal: ${err.message}`)
    closeSync(fd)
    process.exit(4)
  }

  try {
    const st = lstatSync(tempPath)
    if (!matchesPin(st)) {
      console.error('ERROR: el temporal cambió de identidad justo antes del rename (posible sustitución) — rename NUNCA ejecutado.')
      closeSync(fd)
      process.exit(11)
    }
  } catch (err) {
    console.error(`ERROR al revalidar el temporal antes del rename: ${err.message}`)
    closeSync(fd)
    process.exit(11)
  }

  try {
    renameSync(tempPath, secretsFilePath)
  } catch (err) {
    console.error(`ERROR: el rename atómico falló: ${err.message}`)
    closeSync(fd)
    process.exit(12)
  }

  let destOk = false
  try {
    const destSt = lstatSync(secretsFilePath)
    destOk = destSt.isFile() && destSt.dev === expectedDev
  } catch {
    destOk = false
  }
  closeSync(fd)
  if (!destOk) {
    console.error('AVISO: el rename se ejecutó pero el destino no corresponde al dispositivo esperado al reverificarlo — trátalo como evidencia de posible interferencia externa.')
    process.exit(13)
  }

  try {
    const dirFd = openSync(path.dirname(secretsFilePath), constants.O_RDONLY)
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
  } catch {
    // Mejor esfuerzo (misma limitación de plataforma documentada en
    // fsyncPath.mjs — el fichero ya está renombrado de forma atómica).
  }

  try {
    const finalBuffer = readFileSync(secretsFilePath)
    if (!finalBuffer.equals(buffer)) {
      console.error('ERROR: la relectura completa tras el rename no coincide con lo escrito — trátalo como evidencia de interferencia externa.')
      process.exit(13)
    }
  } catch (err) {
    console.error(`ERROR en la relectura final: ${err instanceof Error ? err.message : 'error desconocido'}`)
    process.exit(13)
  }
}

function main() {
  const [, , secretsFilePath, tempPath, expectedDevArg, expectedInoArg, expectedUidArg, expectedModeArg] = process.argv
  if (!secretsFilePath || !tempPath || !expectedDevArg || !expectedInoArg || !expectedUidArg || !expectedModeArg) {
    console.error('Uso: migrateLegacySecretsFileToActive.mjs <secretsFilePath> <tempPath> <dev> <ino> <uid> <modo-octal>')
    process.exit(1)
  }
  const expectedDev = Number(expectedDevArg)
  const expectedIno = Number(expectedInoArg)
  const expectedUid = Number(expectedUidArg)
  const expectedMode = parseInt(expectedModeArg, 8)
  const matchesPin = matchesPinFactory(expectedDev, expectedIno, expectedUid, expectedMode)

  let rawText, entries
  try {
    ;({ rawText, entries } = readAndValidate(secretsFilePath))
  } catch (err) {
    const message = err instanceof SecretsFileParseError || err instanceof Error ? err.message : 'error desconocido'
    console.error(`ERROR al leer/validar el archivo externo: ${message}`)
    process.exit(2)
  }

  let result
  try {
    result = migrateSecretsFileText(rawText, entries)
  } catch (err) {
    const message = err instanceof LegacyMigrationError || err instanceof Error ? err.message : 'error desconocido'
    console.error(`ERROR al migrar el esquema legacy-pre-s7: ${message}`)
    process.exit(2)
  }

  if (!result.changed) {
    console.error('El archivo externo ya está en esquema "active" — nada que migrar (no-op). El temporal pre-creado por el llamador queda SIN CONSUMIR (vacío, nunca se escribió en él). El llamador en bash debe retirarlo de forma síncrona contra la identidad fijada.')
    process.exit(20)
  }

  writeInPlaceAtomic(secretsFilePath, tempPath, matchesPin, expectedDev, result.text)

  console.error('Migración completada: esquema legacy-pre-s7 -> active (v1 = valor legacy preservado, verificabilidad histórica intacta).')
  process.exit(0)
}

// Comparación de "¿soy el módulo de entrada?" resuelta por RUTA REAL —
// mismo patrón que validateProbeJson.mjs/verifyEnvExample.mjs (ver su
// comentario: una comparación literal de import.meta.url contra
// process.argv[1] falla en silencio en cuanto hay un symlink de por
// medio, p. ej. macOS /var -> /private/var).
function resolveIsMain() {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (resolveIsMain()) {
  main()
}
