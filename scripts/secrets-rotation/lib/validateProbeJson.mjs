#!/usr/bin/env node
// scripts/secrets-rotation/lib/validateProbeJson.mjs — validador de
// contrato JSON cerrado para las sondas permanentes de S6/S7
// (scripts/secrets-rotation/probes/*.mts).
//
// Uso desde bash: node validateProbeJson.mjs <schemaName>  (lee stdin)
//
// Exige que stdin sea exactamente un único documento JSON (se admite
// como mucho un salto de línea final — cualquier otro byte antes, byte
// después, línea adicional, o mezcla con salida de diagnóstico se
// rechaza), lo valida contra una de las schemas cerradas de abajo
// (conjunto EXACTO de claves, tipo exacto de cada campo — nunca un campo
// de más, nunca uno de menos, nunca un tipo distinto), y:
//   - éxito: reemite `JSON.stringify(parsed)` canónico a stdout (una
//     sola línea), exit 0;
//   - fallo: mensaje a stderr que cita SOLO el nombre del campo o la
//     naturaleza del fallo — nunca el valor —, exit 1.
//
// La lógica de validación en sí (`validateProbeJsonText`) es una función
// pura, sin E/S, para poder probarla directamente sin child_process —
// ver validateProbeJson.test.mjs.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SCHEMAS = {
  's6-pre': {
    prepared: 'boolean',
    artifactCreated: 'boolean',
    artifactSchemaVersion: 'number',
  },
  's6-post': {
    otpOldInvalidated: 'boolean',
    otpNewWorks: 'boolean',
    rateLimitFreshCounterOk: 'boolean',
    payloadOldInvalidated: 'boolean',
    payloadNewWorks: 'boolean',
  },
  's6-artifact-inspect': {
    status: { enum: ['absent', 'valid', 'invalid'] },
  },
  's6-artifact-remove': {
    removed: 'boolean',
  },
  's7-migrate': {
    allowlistOk: 'boolean',
    allowlistUnlisted: 'string[]',
    allowlistMissing: 'string[]',
    aesRemainingV1: 'number',
    aesRemainingV2: 'number',
    aesDecryptOk: 'boolean',
    emailLookupRemainingV1: 'number',
    fingerprintRemaining: 'number',
    accessTokenRemaining: 'number',
  },
  's7-internal-check': {
    newAccepted: 'boolean',
    oldRejected: 'boolean',
    absentRejected: 'boolean',
  },
  's7-schema-preflight': {
    ready: 'boolean',
    appliedMigrations: 'number',
    expectedMigrations: 'number',
    missingMigrationTags: 'string[]',
    missingColumns: 'string[]',
    missingEnumValues: 'string[]',
  },
  's7a-apply': {
    applied: 'boolean',
  },
  's7a-verify': {
    guestAccessTokenBackfillMissing: 'number',
    authenticatedAccessTokenVersionShouldBeNull: 'number',
    emailLookupKeyVersionNullCount: 'number',
    invariantsOk: 'boolean',
  },
}

function fieldMatchesType(value, typeSpec) {
  if (typeof typeSpec === 'object' && typeSpec !== null && Array.isArray(typeSpec.enum)) {
    return typeof value === 'string' && typeSpec.enum.includes(value)
  }
  switch (typeSpec) {
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'string[]':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
    default:
      return false
  }
}

/**
 * Valida `rawText` (el stdin crudo, sin procesar) contra la schema
 * `schemaName`. Función pura — nunca imprime, nunca sale del proceso.
 * Devuelve `{ ok: true, value }` (objeto ya parseado y validado) o
 * `{ ok: false, error }` (mensaje sin ningún valor de campo dentro).
 */
export function validateProbeJsonText(schemaName, rawText) {
  if (!Object.prototype.hasOwnProperty.call(SCHEMAS, schemaName ?? '')) {
    return { ok: false, error: `nombre de schema desconocido: "${schemaName ?? ''}".` }
  }
  const schema = SCHEMAS[schemaName]

  if (typeof rawText !== 'string' || rawText.length === 0) {
    return { ok: false, error: 'stdin vacío — se esperaba exactamente un documento JSON.' }
  }
  // Se admite como mucho un único salto de línea final — nunca más.
  const content = rawText.endsWith('\n') ? rawText.slice(0, -1) : rawText
  if (content.includes('\n')) {
    return { ok: false, error: 'la salida contiene más de una línea.' }
  }
  if (content !== content.trim()) {
    return { ok: false, error: 'la salida contiene bytes en blanco adicionales antes o después del documento JSON.' }
  }
  if (content.length === 0) {
    return { ok: false, error: 'la salida no contiene ningún documento JSON.' }
  }

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    return { ok: false, error: 'la salida no es JSON válido.' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'el documento JSON no es un objeto.' }
  }

  const expectedKeys = Object.keys(schema)
  const actualKeys = Object.keys(parsed)
  const expectedSet = new Set(expectedKeys)
  const actualSet = new Set(actualKeys)

  for (const key of actualKeys) {
    if (!expectedSet.has(key)) {
      return { ok: false, error: `campo inesperado "${key}".` }
    }
  }
  for (const key of expectedKeys) {
    if (!actualSet.has(key)) {
      return { ok: false, error: `falta el campo "${key}".` }
    }
  }
  for (const key of expectedKeys) {
    if (!fieldMatchesType(parsed[key], schema[key])) {
      return { ok: false, error: `campo "${key}" tiene tipo o valor inesperado.` }
    }
  }

  return { ok: true, value: parsed }
}

function readAllStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

async function runCli() {
  const schemaName = process.argv[2]
  const raw = await readAllStdin()
  const result = validateProbeJsonText(schemaName, raw)
  if (!result.ok) {
    console.error(`ERROR validateProbeJson: ${result.error}`)
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(result.value) + '\n')
}

// Comparación de "¿soy el módulo de entrada?" resuelta por RUTA REAL
// (nunca por comparación literal de cadenas de `import.meta.url` contra
// `process.argv[1]`) — en macOS, un directorio temporal típico vive bajo
// `/var/folders/...`, que es en sí mismo un symlink a
// `/private/var/folders/...`; Node resuelve `import.meta.url` a la ruta
// canónica pero deja `process.argv[1]` tal cual se invocó, así que una
// comparación literal falla silenciosamente (nunca ejecuta `runCli()`,
// nunca imprime nada, sale con éxito) en cuanto este script se invoca
// desde una ruta con symlinks de por medio — exactamente el caso de los
// escenarios de prueba con directorios temporales.
function resolveIsMain() {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (resolveIsMain()) {
  runCli().catch((err) => {
    console.error(`ERROR validateProbeJson: error interno inesperado (${err instanceof Error ? err.constructor.name : 'error'}).`)
    process.exit(1)
  })
}
