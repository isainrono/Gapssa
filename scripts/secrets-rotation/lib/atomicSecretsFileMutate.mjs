#!/usr/bin/env node
// scripts/secrets-rotation/lib/atomicSecretsFileMutate.mjs — Bloque 9 (S7
// atómico y reanudable)
//
// Generaliza EXACTAMENTE el mismo patrón atómico ya aceptado en
// updateSecretsFileField.mjs (temporal FIJADO en el mismo directorio,
// abierto con O_NOFOLLOW, identidad del fd verificada por fstat contra el
// pin capturado por bash al crearlo, escritura+fsync, revalidación por
// lstat justo antes del rename, rename atómico, verificación del destino,
// fsync del directorio contenedor) para aplicar VARIAS mutaciones de
// campo a $SECRETS_FILE en una única lectura+reescritura — nunca una
// reescritura O_TRUNC separada por campo.
//
// Sustituye TODOS los `python3 - <<PYEOF ... os.O_TRUNC ...` que
// gate_s7() (rotate-all-interactive.sh) y 02-generate-secret.sh usaban
// para: generar+añadir v3 a un mapa versionado, activar v3 como versión
// ACTIVA, y retirar una versión vieja de un mapa — cada uno era una
// reescritura O_TRUNC independiente (sin temporal, sin fsync, sin rename,
// sin fsync de directorio, sin O_NOFOLLOW/fstat), así que una
// interrupción entre dos de esas reescrituras podía dejar el archivo
// truncado a medio escribir, y — bug más severo — invocar de nuevo la
// generación tras una interrupción MINABA UN VALOR v3 NUEVO que
// sustituía en silencio al v3 ya usado para recifrar filas reales de
// Postgres, huérfanas para siempre. Ver `json-map-generate` más abajo.
//
// Uso:
//   node atomicSecretsFileMutate.mjs <secretsFilePath> <tempPath> <dev> <ino> <uid> <modo-octal> <schemaVersion>
//   stdin: un único documento JSON — un array NO VACÍO de mutaciones,
//   cada una un objeto con "op" y, según el tipo:
//
//     {"op":"set-line","key":"K","value":"V"}
//       Sustituye la línea "K=..." por "K=V". <K> DEBE existir ya en el
//       documento (nunca añade una clave nueva). <V> se valida con el
//       contrato general (secretValueContract.mjs::validateSecretValue).
//       Idempotente: si la línea ya vale exactamente V, no se toca.
//
//     {"op":"set-line-generate","key":"K","bytes":N,"format":"hex"|"base64"}
//       Genera N bytes CSPRNG (crypto.randomBytes, EN ESTE PROCESO — el
//       valor nunca sale por stdout/argv/log) y sustituye la línea "K=..."
//       por el resultado. <K> DEBE existir ya. SIEMPRE cambia el valor
//       (rotación real, nunca idempotente por diseño — para un secreto
//       singular sin versión, ej. BOOKING_INTERNAL_API_SECRET, "generar
//       de nuevo" es la operación pedida en sí).
//
//     {"op":"json-map-generate","key":"K","versionKey":"vN","bytes":N,"format":"hex"|"base64"}
//       <K> DEBE existir ya como mapa JSON válido en el documento. Si
//       "vN" YA está presente en ese mapa, esta mutación es un NO-OP
//       (se conserva el valor existente byte a byte) — IDEMPOTENCIA
//       CRÍTICA: relanzar gate_s7 tras una interrupción nunca debe poder
//       sustituir un v3 que ya se usó para recifrar filas reales. Si
//       "vN" está ausente, genera N bytes CSPRNG y los añade al mapa.
//
//     {"op":"json-map-retain","key":"K","versions":["vN", ...]}
//       <K> DEBE existir ya como mapa JSON válido en el documento, y
//       CADA versión listada DEBE estar ya presente en él (nunca
//       "inventa" una versión que no existía). Sustituye el mapa por
//       exactamente esas versiones (las demás se retiran). Idempotente:
//       si el mapa ya contiene exactamente ese conjunto, no se toca.
//
//   Todas las mutaciones de una misma invocación se aplican a UNA sola
//   lectura+reescritura del documento (una única preimagen, un único
//   fsync+rename) — nunca una reescritura por mutación. Como mucho una
//   mutación por <key> (rechazado si se repite).
//
// Códigos de salida (mismo esquema que updateSecretsFileField.mjs, mismos
// números para los casos compartidos):
//   0  = éxito — documento reescrito (al menos una mutación cambió algo)
//   1  = uso incorrecto
//   2  = cuerpo de mutaciones inválido (JSON malformado / forma cerrada
//        incorrecta / <key> ausente o duplicada / versión pedida ausente
//        en json-map-retain / valor JSON existente no es un mapa) o
//        preimagen de $SECRETS_FILE con documento malformado
//   3  = un valor (externo o generado) no cumple el contrato cerrado de
//        valores secretos, o el documento COMPLETO tras aplicar las
//        mutaciones no valida contra el inventario/obligatorias de la
//        versión de esquema activa
//   4  = fallo al escribir o hacer fsync del temporal
//   10 = identidad del temporal no coincide con el pin ANTES de escribir
//   11 = identidad del temporal no coincide con el pin JUSTO ANTES del
//        rename — el rename NUNCA se ejecuta en este caso
//   12 = el propio rename falló
//   13 = el destino tras el rename no corresponde al inodo esperado
//   14 = la preimagen de $SECRETS_FILE no pasó la comprobación de
//        symlink/tipo/propietario/modo — nada se ha escrito
//   20 = NO-OP — todas las mutaciones ya estaban aplicadas (ningún byte
//        habría cambiado). El temporal pre-creado por el llamador NUNCA
//        se consume en este caso (este script termina ANTES de escribir
//        ningún byte en él — permanece exactamente como lo creó
//        `mktemp`, vacío) — es responsabilidad del llamador en bash
//        retirarlo de forma síncrona y determinista contra la identidad
//        ya fijada (ver gapssa_secrets_shred_pinned/
//        gapssa_cleanup_push en lib.sh), nunca de un operador humano.
//
// stdout en éxito (0 o 20): un único documento JSON de resumen — SOLO
// nombres de clave/versión y booleanos, JAMÁS un valor:
//   {"changed":bool,"applied":["K", "K2.v3", ...],"skipped":["K3.v3", ...]}
//
// --- Failpoints de prueba (Bloque 10 — validación dedicada de S7) ---
//
// `GAPSSA_ROTATION_TEST_FAILPOINT` (ausente por defecto — CERO efecto en
// cualquier ejecución real, incluidas todas las de S1-S9): permite a un
// arnés de pruebas demostrar, con una interrupción REAL (SIGKILL de este
// mismo proceso, nunca una salida ordenada — un `process.exit()` no
// demuestra nada sobre qué sobrevive a un corte de corriente/OOM-kill
// real) en un punto EXACTO de la secuencia de escritura, que el archivo
// nunca queda truncado, a medio escribir o con permisos incorrectos.
// Valores cerrados:
//   "before-fsync"               — tras abrir+verificar el temporal y
//                                   escribir los bytes, ANTES de fsync.
//   "after-fsync-before-rename"  — tras fsync, ANTES de renombrar (el
//                                   destino real todavía no se ha
//                                   tocado en ningún caso).
//   "after-rename"               — justo tras el rename atómico, ANTES
//                                   del fsync de directorio/relectura.
// Un valor fuera de este conjunto cerrado aborta (exit 1) — nunca se
// ignora en silencio un failpoint mal escrito.
//
// Exige SIEMPRE, además, `GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL` — debe
// casar con el patrón cerrado de un proyecto Docker DESECHABLE de este
// mismo arnés (`gapssa-*-(rehearsal|tests)-<hex>`, ver
// tests/s1_s9_full_rehearsal.py::Project / tests/disposable-infra.sh).
// Si `GAPSSA_ROTATION_TEST_FAILPOINT` está presente pero la etiqueta
// falta o no casa con el patrón, o si `<secretsFilePath>` resuelve al
// almacén externo REAL por defecto (`$HOME/.gapssa-secrets/.env.gapssa`
// con el `$HOME` real del proceso, nunca uno de prueba), este script
// ABORTA de inmediato (exit 1) SIN aplicar ninguna mutación — fallo
// cerrado, nunca "el failpoint no aplica, sigo normalmente" (eso podría
// enmascarar un arnés de pruebas mal configurado apuntando a un almacén
// real). Ningún failpoint lee, genera ni acepta un valor secreto: solo
// decide CUÁNDO morir, nunca QUÉ escribir.

import { randomBytes } from 'node:crypto'
import { openSync, closeSync, fstatSync, lstatSync, readFileSync, ftruncateSync, writeSync, fsyncSync, renameSync, realpathSync, constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePlainEnvEntries, validateEntriesAgainstSchema, BackupSchemaError, KNOWN_SCHEMA_VERSIONS } from './backupSchema.mjs'
import { validateSecretValue, validateGeneratedSecretValue } from './secretValueContract.mjs'

const USAGE = 'Uso: atomicSecretsFileMutate.mjs <secretsFilePath> <tempPath> <dev> <ino> <uid> <modo-octal> <schemaVersion>  (mutaciones JSON por stdin)'
const LINE_PATTERN = /^([A-Z_][A-Z0-9_]*)=(.*)$/
const VALID_FORMATS = new Set(['hex', 'base64'])
const KEY_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/
const VERSION_KEY_PATTERN = /^v[0-9]+$/

class MutationValidationError extends Error {}
class MutationApplyError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

function formatBytes(buf, format) {
  return format === 'hex' ? buf.toString('hex') : buf.toString('base64')
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Valida la forma cerrada de UNA mutación. Nunca valida su efecto contra
 * el documento (eso ocurre al aplicarla, con el documento ya en mano).
 */
function validateMutationShape(m, idx) {
  const p = `mutations[${idx}]`
  if (!isPlainObject(m)) throw new MutationValidationError(`${p}: no es un objeto`)
  const allowedOps = ['set-line', 'set-line-generate', 'json-map-generate', 'json-map-retain']
  if (!allowedOps.includes(m.op)) throw new MutationValidationError(`${p}.op: desconocido`)
  if (typeof m.key !== 'string' || !KEY_NAME_PATTERN.test(m.key)) throw new MutationValidationError(`${p}.key: inválida`)

  const commonKeys = ['op', 'key']
  switch (m.op) {
    case 'set-line': {
      if (typeof m.value !== 'string' || m.value.length === 0) throw new MutationValidationError(`${p}.value: inválido`)
      for (const k of Object.keys(m)) if (!['value', ...commonKeys].includes(k)) throw new MutationValidationError(`${p}.${k}: clave inesperada`)
      break
    }
    case 'set-line-generate':
    case 'json-map-generate': {
      if (!Number.isInteger(m.bytes) || m.bytes < 16 || m.bytes > 256) throw new MutationValidationError(`${p}.bytes: inválido`)
      if (typeof m.format !== 'string' || !VALID_FORMATS.has(m.format)) throw new MutationValidationError(`${p}.format: inválido`)
      const extra = m.op === 'json-map-generate' ? ['versionKey'] : []
      if (m.op === 'json-map-generate' && (typeof m.versionKey !== 'string' || !VERSION_KEY_PATTERN.test(m.versionKey))) {
        throw new MutationValidationError(`${p}.versionKey: inválida`)
      }
      for (const k of Object.keys(m)) if (!['bytes', 'format', ...extra, ...commonKeys].includes(k)) throw new MutationValidationError(`${p}.${k}: clave inesperada`)
      break
    }
    case 'json-map-retain': {
      if (!Array.isArray(m.versions) || m.versions.length === 0 || !m.versions.every((v) => typeof v === 'string' && VERSION_KEY_PATTERN.test(v))) {
        throw new MutationValidationError(`${p}.versions: inválido`)
      }
      if (new Set(m.versions).size !== m.versions.length) throw new MutationValidationError(`${p}.versions: duplicadas`)
      for (const k of Object.keys(m)) if (!['versions', ...commonKeys].includes(k)) throw new MutationValidationError(`${p}.${k}: clave inesperada`)
      break
    }
  }
}

/**
 * Valida el array completo de mutaciones: forma cerrada de cada una, y
 * como mucho una mutación por <key> en toda la invocación.
 */
export function validateMutationsList(mutations) {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    throw new MutationValidationError('mutations: debe ser un array no vacío')
  }
  const seenKeys = new Set()
  mutations.forEach((m, idx) => {
    validateMutationShape(m, idx)
    if (seenKeys.has(m.key)) throw new MutationValidationError(`mutations[${idx}].key: "${m.key}" ya tiene otra mutación en esta misma invocación`)
    seenKeys.add(m.key)
  })
}

/**
 * Aplica el array de mutaciones YA VALIDADO (forma) a `lines` (array de
 * líneas del documento, sin salto de línea final en cada elemento).
 * Función pura — no hace I/O, no genera bytes salvo llamando a
 * `generateBytes` (inyectado, para que las pruebas puedan suministrar
 * generación determinista sin depender de CSPRNG real).
 *
 * @returns {{lines: string[], changed: boolean, applied: string[], skipped: string[]}}
 */
export function applyMutations(lines, mutations, generateBytes) {
  const byKey = new Map()
  for (const line of lines) {
    const match = LINE_PATTERN.exec(line)
    if (match) byKey.set(match[1], true)
  }

  const outLines = [...lines]
  const indexByKey = new Map()
  outLines.forEach((line, idx) => {
    const match = LINE_PATTERN.exec(line)
    if (match) indexByKey.set(match[1], idx)
  })

  let changed = false
  const applied = []
  const skipped = []

  for (const m of mutations) {
    if (!indexByKey.has(m.key)) {
      throw new MutationApplyError(`la clave "${m.key}" no está presente en $SECRETS_FILE — no hay nada que mutar (nunca se añade una clave nueva por esta vía).`, 2)
    }
    const lineIdx = indexByKey.get(m.key)
    const currentLine = outLines[lineIdx]
    const currentValue = currentLine.slice(m.key.length + 1)

    if (m.op === 'set-line') {
      const newBuf = Buffer.from(m.value, 'utf8')
      const result = validateSecretValue(newBuf)
      if (!result.ok) throw new MutationApplyError(`el valor nuevo de "${m.key}" no cumple el contrato cerrado de valores secretos (${result.reason}).`, 3)
      if (currentValue === m.value) {
        skipped.push(m.key)
        continue
      }
      outLines[lineIdx] = `${m.key}=${m.value}`
      applied.push(m.key)
      changed = true
      continue
    }

    if (m.op === 'set-line-generate') {
      const raw = generateBytes(m.bytes)
      const value = formatBytes(raw, m.format)
      const result = validateGeneratedSecretValue(Buffer.from(value, 'utf8'))
      if (!result.ok) throw new MutationApplyError(`el valor generado para "${m.key}" no cumple el contrato cerrado (${result.reason}).`, 3)
      outLines[lineIdx] = `${m.key}=${value}`
      applied.push(m.key)
      changed = true
      continue
    }

    // --- mutaciones sobre mapa JSON versionado ---
    let currentMap
    try {
      currentMap = JSON.parse(currentValue)
    } catch {
      throw new MutationApplyError(`el valor actual de "${m.key}" no es JSON válido — no se puede mutar como mapa.`, 2)
    }
    if (!isPlainObject(currentMap)) {
      throw new MutationApplyError(`el valor actual de "${m.key}" no es un mapa (objeto) JSON.`, 2)
    }

    if (m.op === 'json-map-generate') {
      if (Object.prototype.hasOwnProperty.call(currentMap, m.versionKey)) {
        // Idempotencia crítica — ver comentario de cabecera: nunca
        // regenerar una versión que ya existe, aunque se reintente esta
        // mutación tras una interrupción.
        skipped.push(`${m.key}.${m.versionKey}`)
        continue
      }
      const raw = generateBytes(m.bytes)
      const value = formatBytes(raw, m.format)
      const result = validateGeneratedSecretValue(Buffer.from(value, 'utf8'))
      if (!result.ok) throw new MutationApplyError(`el valor generado para "${m.key}.${m.versionKey}" no cumple el contrato cerrado (${result.reason}).`, 3)
      const newMap = { ...currentMap, [m.versionKey]: value }
      outLines[lineIdx] = `${m.key}=${JSON.stringify(newMap)}`
      applied.push(`${m.key}.${m.versionKey}`)
      changed = true
      continue
    }

    if (m.op === 'json-map-retain') {
      for (const v of m.versions) {
        if (!Object.prototype.hasOwnProperty.call(currentMap, v)) {
          throw new MutationApplyError(`"${m.key}" no contiene la versión "${v}" que se pidió conservar — no se retira nada de este mapa.`, 2)
        }
      }
      const currentKeys = Object.keys(currentMap).sort()
      const wantedKeys = [...m.versions].sort()
      if (currentKeys.length === wantedKeys.length && currentKeys.every((k, i) => k === wantedKeys[i])) {
        skipped.push(m.key)
        continue
      }
      const newMap = {}
      for (const v of m.versions) newMap[v] = currentMap[v]
      outLines[lineIdx] = `${m.key}=${JSON.stringify(newMap)}`
      applied.push(m.key)
      changed = true
      continue
    }
  }

  return { lines: outLines, changed, applied, skipped }
}

function matchesPinFactory(expectedDev, expectedIno, expectedUid, expectedMode) {
  return (st) => st.isFile() && st.dev === expectedDev && st.ino === expectedIno && st.uid === expectedUid && (st.mode & 0o777) === expectedMode
}

// --- Failpoints de prueba (Bloque 10) — ver comentario de cabecera. ---
const TEST_FAILPOINTS = ['before-fsync', 'after-fsync-before-rename', 'after-rename']
const DISPOSABLE_LABEL_PATTERN = /^gapssa-[a-z0-9]+(-[a-z0-9]+)*-(rehearsal|tests?)-[0-9a-f]{6,}$/

/**
 * Valida, UNA VEZ al arrancar, que si `GAPSSA_ROTATION_TEST_FAILPOINT`
 * está presente, el entorno completo demuestra ser un contexto
 * desechable de pruebas — nunca "el failpoint no aplica aquí, sigo
 * normalmente". Devuelve el punto solicitado (o null si la variable no
 * está presente — caso normal, cero coste). Aborta (exit 1) si la
 * variable está presente pero el valor no es uno de los 3 cerrados, si
 * falta o no casa la etiqueta de proyecto desechable, o si
 * `secretsFilePath` resuelve al almacén externo REAL por defecto.
 */
function resolveTestFailpoint(secretsFilePath) {
  const requested = process.env.GAPSSA_ROTATION_TEST_FAILPOINT
  if (!requested) return null

  if (!TEST_FAILPOINTS.includes(requested)) {
    console.error(`ERROR: GAPSSA_ROTATION_TEST_FAILPOINT="${requested}" no es uno de los valores cerrados (${TEST_FAILPOINTS.join(', ')}) — abortado, nunca ignorado en silencio.`)
    process.exit(1)
  }

  const label = process.env.GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL
  if (!label || !DISPOSABLE_LABEL_PATTERN.test(label)) {
    console.error('ERROR: GAPSSA_ROTATION_TEST_FAILPOINT está presente sin una GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL válida (patrón de proyecto desechable) — abortado antes de aplicar ninguna mutación.')
    process.exit(1)
  }

  const realDefaultSecretsFile = path.join(os.homedir(), '.gapssa-secrets', '.env.gapssa')
  let resolvedTarget
  try {
    resolvedTarget = path.resolve(secretsFilePath)
  } catch {
    resolvedTarget = secretsFilePath
  }
  if (resolvedTarget === path.resolve(realDefaultSecretsFile)) {
    console.error('ERROR: GAPSSA_ROTATION_TEST_FAILPOINT apunta al almacén externo REAL por defecto ($HOME/.gapssa-secrets/.env.gapssa) — abortado, un failpoint de prueba NUNCA se activa contra un almacén real.')
    process.exit(1)
  }

  return requested
}

/**
 * Simula una interrupción REAL (nunca una salida ordenada) en el punto
 * `point` si coincide con el failpoint activo — SIGKILL de este mismo
 * proceso: ni handlers de salida, ni flush de buffers adicional, ni
 * limpieza. No-op si `activeFailpoint` es null o no coincide con `point`.
 */
function maybeCrashAtFailpoint(activeFailpoint, point) {
  if (activeFailpoint !== point) return
  process.kill(process.pid, 'SIGKILL')
}

async function readAllStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const args = process.argv.slice(2)
  const [secretsFilePath, tempPath, expectedDevArg, expectedInoArg, expectedUidArg, expectedModeArg, schemaVersion] = args
  if (!secretsFilePath || !tempPath || !expectedDevArg || !expectedInoArg || !expectedUidArg || !expectedModeArg || !schemaVersion) {
    console.error(USAGE)
    process.exit(1)
  }
  if (!KNOWN_SCHEMA_VERSIONS.includes(schemaVersion)) {
    console.error(`ERROR: <schemaVersion> desconocida: "${schemaVersion}".`)
    process.exit(1)
  }
  const activeFailpoint = resolveTestFailpoint(secretsFilePath)

  const expectedDev = Number(expectedDevArg)
  const expectedIno = Number(expectedInoArg)
  const expectedUid = Number(expectedUidArg)
  const expectedMode = parseInt(expectedModeArg, 8)
  const matchesPin = matchesPinFactory(expectedDev, expectedIno, expectedUid, expectedMode)

  let mutations
  try {
    const raw = await readAllStdin()
    const parsed = JSON.parse(raw)
    validateMutationsList(parsed)
    mutations = parsed
  } catch (err) {
    console.error(`ERROR: mutaciones inválidas por stdin (${err instanceof Error ? err.message : 'error desconocido'}).`)
    process.exit(2)
  }

  // --- 1. Abre el temporal FIJADO, verifica su identidad por fstat ---
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

  // --- 2. Valida la PREIMAGEN de $SECRETS_FILE ---
  let preimageBuffer
  try {
    const pre = lstatSync(secretsFilePath)
    if (!pre.isFile()) {
      console.error('ERROR: la preimagen de $SECRETS_FILE no es un fichero regular (posible symlink) — rechazado.')
      closeSync(fd)
      process.exit(14)
    }
    if ((pre.mode & 0o777) !== 0o600) {
      console.error('ERROR: la preimagen de $SECRETS_FILE no tiene modo 600 — rechazado.')
      closeSync(fd)
      process.exit(14)
    }
    if (pre.uid !== process.getuid()) {
      console.error('ERROR: la preimagen de $SECRETS_FILE no pertenece al usuario actual — rechazado.')
      closeSync(fd)
      process.exit(14)
    }
    preimageBuffer = readFileSync(secretsFilePath)
  } catch (err) {
    console.error(`ERROR al validar/leer la preimagen de $SECRETS_FILE: ${err.message}`)
    closeSync(fd)
    process.exit(14)
  }

  let preimageEntries
  try {
    preimageEntries = parsePlainEnvEntries(preimageBuffer)
  } catch (err) {
    if (err instanceof BackupSchemaError) {
      console.error(err.message)
      closeSync(fd)
      process.exit(2)
    }
    console.error(`ERROR inesperado al parsear la preimagen: ${err.message}`)
    closeSync(fd)
    process.exit(2)
  }
  void preimageEntries // ya usada para rechazar duplicados/formato — el resto lo hace applyMutations sobre las líneas crudas.

  // --- 3. Aplica las mutaciones en memoria (una sola pasada) ---
  const originalText = preimageBuffer.toString('utf8')
  const endsWithNewline = originalText.endsWith('\n')
  const lines = endsWithNewline ? originalText.slice(0, -1).split('\n') : originalText.split('\n')

  let applyResult
  try {
    applyResult = applyMutations(lines, mutations, (n) => randomBytes(n))
  } catch (err) {
    if (err instanceof MutationApplyError) {
      console.error(`ERROR: ${err.message}`)
      closeSync(fd)
      process.exit(err.code)
    }
    console.error(`ERROR inesperado al aplicar las mutaciones: ${err instanceof Error ? err.message : 'error desconocido'}`)
    closeSync(fd)
    process.exit(2)
  }

  if (!applyResult.changed) {
    closeSync(fd)
    process.stdout.write(JSON.stringify({ changed: false, applied: [], skipped: applyResult.skipped }) + '\n')
    console.error('AVISO: ninguna mutación cambió nada (todas ya estaban aplicadas) — el temporal pre-creado por el llamador queda SIN CONSUMIR (vacío, nunca se escribió en él). El llamador en bash debe retirarlo de forma síncrona contra la identidad fijada.')
    process.exit(20)
  }

  const reconstructedText = applyResult.lines.join('\n') + (endsWithNewline ? '\n' : '')
  const reconstructedBuffer = Buffer.from(reconstructedText, 'utf8')

  // --- 4. Valida el DOCUMENTO COMPLETO reconstruido contra el esquema ---
  try {
    const reconstructedEntries = parsePlainEnvEntries(reconstructedBuffer)
    validateEntriesAgainstSchema(schemaVersion, reconstructedEntries)
  } catch (err) {
    if (err instanceof BackupSchemaError) {
      console.error(err.message)
      closeSync(fd)
      process.exit(3)
    }
    console.error(`ERROR inesperado al validar el documento reconstruido: ${err.message}`)
    closeSync(fd)
    process.exit(3)
  }

  // --- 5. Escribe el documento completo al fd YA ABIERTO Y VERIFICADO ---
  try {
    ftruncateSync(fd, 0)
    let written = 0
    while (written < reconstructedBuffer.length) {
      written += writeSync(fd, reconstructedBuffer, written, reconstructedBuffer.length - written, written)
    }
    maybeCrashAtFailpoint(activeFailpoint, 'before-fsync')
    fsyncSync(fd)
    maybeCrashAtFailpoint(activeFailpoint, 'after-fsync-before-rename')
  } catch (err) {
    console.error(`ERROR al escribir/fsync el temporal: ${err.message}`)
    closeSync(fd)
    process.exit(4)
  }

  // --- 6. Revalidación INMEDIATAMENTE antes del rename ---
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

  // --- 7. Rename atómico + verificación del destino ---
  try {
    renameSync(tempPath, secretsFilePath)
  } catch (err) {
    console.error(`ERROR: el rename atómico falló: ${err.message}`)
    closeSync(fd)
    process.exit(12)
  }
  maybeCrashAtFailpoint(activeFailpoint, 'after-rename')

  let destOk = false
  try {
    const destSt = lstatSync(secretsFilePath)
    destOk = destSt.isFile() && destSt.dev === expectedDev && destSt.ino === expectedIno
  } catch {
    destOk = false
  }
  closeSync(fd)
  if (!destOk) {
    console.error('AVISO: el rename se ejecutó pero el destino no corresponde al inodo esperado al reverificarlo — trátalo como evidencia de posible interferencia externa.')
    process.exit(13)
  }

  // --- 8. fsync del directorio contenedor — mejor esfuerzo ---
  try {
    const dirFd = openSync(path.dirname(secretsFilePath), constants.O_RDONLY)
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
  } catch {
    // Mejor esfuerzo.
  }

  // --- 9. Relectura completa del documento final para confirmar que lo
  //        que quedó en disco es exactamente lo reconstruido y que sigue
  //        siendo válido contra el esquema — nunca se asume que el rename
  //        garantiza el contenido. ---
  try {
    const finalBuffer = readFileSync(secretsFilePath)
    if (!finalBuffer.equals(reconstructedBuffer)) {
      console.error('ERROR: la relectura completa tras el rename no coincide con lo escrito — trátalo como evidencia de interferencia externa.')
      process.exit(13)
    }
    validateEntriesAgainstSchema(schemaVersion, parsePlainEnvEntries(finalBuffer))
  } catch (err) {
    console.error(`ERROR en la relectura/validación final: ${err instanceof Error ? err.message : 'error desconocido'}`)
    process.exit(13)
  }

  process.stdout.write(JSON.stringify({ changed: true, applied: applyResult.applied, skipped: applyResult.skipped }) + '\n')
  process.exit(0)
}

// Comparación de "¿soy el módulo de entrada?" resuelta por RUTA REAL —
// mismo patrón ya establecido en el resto de este directorio (nunca una
// comparación literal de import.meta.url contra process.argv[1], que
// falla en silencio en cuanto hay un symlink de por medio — ver
// verifyEnvExample.mjs, README.md, "Segundo bug real").
function resolveIsMain() {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (resolveIsMain()) {
  main().catch((err) => {
    console.error(`ERROR atomicSecretsFileMutate: error interno inesperado (${err instanceof Error ? err.constructor.name : 'error'}: ${err instanceof Error ? err.message : ''}).`)
    process.exit(1)
  })
}
