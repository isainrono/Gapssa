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
// reescribe el archivo EN EL SITIO preservando verbatim cualquier otra
// línea (orden, comentarios, blancos): solo las 2 líneas legacy se
// sustituyen, cada una por sus 2 líneas activas equivalentes. Idempotente:
// si el archivo ya está en esquema "active", no escribe nada.
//
// Uso: node migrateLegacySecretsFileToActive.mjs <secretsFilePath>
//   exit 0 = migrado con éxito, o el archivo YA estaba en esquema
//            "active" (no-op idempotente)
//   exit 1 = uso incorrecto
//   exit 2 = el archivo no está en un esquema reconocible para esta
//            operación (mezcla, clave desconocida, legacy incompleta) —
//            rechazado, nunca escrito

import { readFileSync, realpathSync, openSync, writeSync, closeSync, fsyncSync } from 'node:fs'
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

function writeInPlace(secretsFilePath, text) {
  const fd = openSync(secretsFilePath, 'w')
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function main() {
  const [, , secretsFilePath] = process.argv
  if (!secretsFilePath) {
    console.error('Uso: migrateLegacySecretsFileToActive.mjs <secretsFilePath>')
    process.exit(1)
  }

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
    console.error('El archivo externo ya está en esquema "active" — nada que migrar (no-op).')
    process.exit(0)
  }

  try {
    writeInPlace(secretsFilePath, result.text)
  } catch (err) {
    console.error(`ERROR al escribir el archivo externo migrado: ${err instanceof Error ? err.message : 'error desconocido'}`)
    process.exit(2)
  }

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
