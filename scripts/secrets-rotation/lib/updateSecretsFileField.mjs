#!/usr/bin/env node
// scripts/secrets-rotation/lib/updateSecretsFileField.mjs — Bloque 5,
// Revisión 2 (punto 4)
//
// Único punto de todo scripts/secrets-rotation/ que actualiza UN solo
// campo KEY=value de un $SECRETS_FILE PLANO ya existente (nunca lo crea,
// nunca reescribe el resto) — reutiliza EXACTAMENTE el mismo patrón
// atómico aceptado en el Bloque 2 para restaurar un backup completo
// (lib/writeRestorePayload.mjs): temporal FIJADO en el mismo directorio,
// abierto con O_NOFOLLOW, identidad del fd verificada por fstat contra
// el pin capturado por bash al crearlo, escritura+fsync, revalidación
// por lstat justo antes del rename, rename atómico, verificación del
// destino, fsync del directorio contenedor — TODO en este mismo proceso,
// nunca un `mv` de bash por separado.
//
// Diferencia con writeRestorePayload.mjs: aquí no hay una restauración
// completa de backup ni una etiqueta de esquema — se parte del
// $SECRETS_FILE REAL en disco (preimagen), se sustituye EXACTAMENTE una
// línea "KEY=valor" y se preserva el resto BYTE A BYTE (mismo orden,
// mismos comentarios, mismas líneas en blanco, mismo terminador final).
// Nunca usa O_TRUNC directamente sobre $SECRETS_FILE — todo pasa por el
// temporal fijado + rename atómico.
//
// Uso:
//   node updateSecretsFileField.mjs <secretsFilePath> <tempPath> <dev> <ino> <uid> <modo-octal> <KEY_NAME> <schemaVersion> [--json-field <campo>]
//   <schemaVersion> es SIEMPRE explícito (una de
//   lib/backupSchema.mjs::KNOWN_SCHEMA_VERSIONS) — NUNCA se asume
//   "active": S4 (admin/API Key) se ejecuta ANTES que S7 en el orden real
//   S1→S9, así que el documento sigue teniendo forma "legacy-pre-s7"
//   hasta que S7 quede 'done' (bug real, detectado y corregido durante el
//   Bloque 6: la primera versión de este script fijaba "active" a
//   ciegas, lo que habría bloqueado la propia puerta S4 en una ejecución
//   real anterior a S7). El llamador en bash SIEMPRE debe derivarlo de
//   current_secrets_schema_version(), igual que backup_secrets_file().
//   stdin:
//     - sin --json-field: el VALOR nuevo completo, bytes crudos (nunca
//       en argv).
//     - con --json-field <campo>: una respuesta JSON completa (p.ej. la
//       respuesta cruda de POST /api/v1/UserSecurity/apiKey/generate,
//       leída DIRECTAMENTE del pipe de curl — nunca pasa por un fichero
//       regular del host) — se extrae response[campo] como el valor
//       nuevo. Evita el fichero temporal "con la respuesta completa sin
//       registrar" que exigía el diseño anterior.
//
// Códigos de salida (mismo esquema que writeRestorePayload.mjs):
//   0  = éxito — <KEY_NAME> actualizado en <secretsFilePath>
//   1  = uso incorrecto
//   2  = cuerpo de entrada inválido (JSON malformado / campo JSON
//        ausente o vacío/no-string), o preimagen de $SECRETS_FILE con
//        documento malformado, o <KEY_NAME> ausente/duplicada en él
//   3  = el valor nuevo no cumple el contrato cerrado de valores
//        secretos, o el documento COMPLETO tras la sustitución no valida
//        contra el inventario/obligatorias de la versión de esquema activa
//   4  = fallo al escribir o hacer fsync del temporal
//   10 = identidad del temporal no coincide con el pin ANTES de escribir
//        (posible sustitución) — nada se ha escrito
//   11 = identidad del temporal no coincide con el pin JUSTO ANTES del
//        rename (posible sustitución durante la escritura) — el rename
//        NUNCA se ejecuta en este caso
//   12 = el propio rename falló
//   13 = el destino tras el rename no corresponde al inodo esperado
//        (evidencia para el llamador, el rename ya ocurrió)
//   14 = la preimagen de $SECRETS_FILE no pasó la comprobación de
//        symlink/tipo/propietario/modo — nada se ha escrito
//
// Nunca imprime el valor nuevo ni el contenido del documento.

import { openSync, closeSync, fstatSync, lstatSync, readFileSync, ftruncateSync, writeSync, fsyncSync, renameSync, constants } from 'node:fs'
import path from 'node:path'
import { parsePlainEnvEntries, validateEntriesAgainstSchema, BackupSchemaError, KNOWN_SCHEMA_VERSIONS } from './backupSchema.mjs'
import { validateSecretValue } from './secretValueContract.mjs'

const USAGE = 'Uso: updateSecretsFileField.mjs <secretsFilePath> <tempPath> <dev> <ino> <uid> <modo-octal> <KEY_NAME> <schemaVersion> [--json-field <campo>]'

const args = process.argv.slice(2)
const [secretsFilePath, tempPath, expectedDevArg, expectedInoArg, expectedUidArg, expectedModeArg, keyName, schemaVersion, jsonFieldFlag, jsonField] = args

if (!secretsFilePath || !tempPath || !expectedDevArg || !expectedInoArg || !expectedUidArg || !expectedModeArg || !keyName || !schemaVersion) {
  console.error(USAGE)
  process.exit(1)
}
if (!/^[A-Z_][A-Z0-9_]*$/.test(keyName)) {
  console.error('ERROR: <KEY_NAME> debe ser MAYUSCULA_CON_GUIONES_BAJOS.')
  process.exit(1)
}
if (!KNOWN_SCHEMA_VERSIONS.includes(schemaVersion)) {
  console.error(`ERROR: <schemaVersion> desconocida: "${schemaVersion}".`)
  process.exit(1)
}
let extractJsonField = null
if (jsonFieldFlag !== undefined) {
  if (jsonFieldFlag !== '--json-field' || !jsonField) {
    console.error(USAGE)
    process.exit(1)
  }
  extractJsonField = jsonField
}

const expectedDev = Number(expectedDevArg)
const expectedIno = Number(expectedInoArg)
const expectedUid = Number(expectedUidArg)
const expectedMode = parseInt(expectedModeArg, 8)

function matchesPin(st) {
  return st.isFile() && st.dev === expectedDev && st.ino === expectedIno && st.uid === expectedUid && (st.mode & 0o777) === expectedMode
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

// --- 2. Valida la PREIMAGEN de $SECRETS_FILE (nunca sigue un symlink,
//        exige fichero regular, modo 600, propiedad del proceso actual)
//        — antes de leer su contenido. ---
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

// --- 3. Lee el valor nuevo por stdin (crudo, o extraído de un campo JSON
//        — streaming, nunca un fichero regular con la respuesta
//        completa) y lo valida contra el contrato cerrado. ---
const stdinChunks = []
try {
  for await (const chunk of process.stdin) stdinChunks.push(chunk)
} catch (err) {
  console.error(`ERROR al leer stdin: ${err.message}`)
  closeSync(fd)
  process.exit(2)
}
const stdinBuffer = Buffer.concat(stdinChunks)

let newValueBuffer
if (extractJsonField) {
  let parsed
  try {
    parsed = JSON.parse(stdinBuffer.toString('utf8'))
  } catch {
    console.error('ERROR: la respuesta por stdin no es JSON válido.')
    closeSync(fd)
    process.exit(2)
  }
  const fieldValue = parsed && typeof parsed === 'object' ? parsed[extractJsonField] : undefined
  if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
    console.error(`ERROR: la respuesta no incluyó un campo "${extractJsonField}" de tipo string no vacío.`)
    closeSync(fd)
    process.exit(2)
  }
  newValueBuffer = Buffer.from(fieldValue, 'utf8')
} else {
  newValueBuffer = stdinBuffer
}

const contractResult = validateSecretValue(newValueBuffer)
if (!contractResult.ok) {
  console.error(`ERROR: el valor nuevo no cumple el contrato cerrado de valores secretos (${contractResult.reason}).`)
  closeSync(fd)
  process.exit(3)
}
const newValueText = newValueBuffer.toString('utf8')

// --- 4. Tokeniza la preimagen completa (rechaza documento malformado:
//        líneas mal formadas, claves duplicadas, CRLF, NUL) y exige
//        EXACTAMENTE una ocurrencia de <KEY_NAME>. ---
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
if (!preimageEntries.has(keyName)) {
  console.error(`ERROR: la clave "${keyName}" no está presente en $SECRETS_FILE — no hay nada que actualizar (nunca se añade una clave nueva por esta vía).`)
  closeSync(fd)
  process.exit(2)
}

// --- 5. Reconstruye el documento, sustituyendo SOLO la línea de
//        <KEY_NAME>, preservando el resto BYTE A BYTE (mismo orden,
//        comentarios, líneas en blanco, y si el original terminaba o no
//        en salto de línea). ---
const originalText = preimageBuffer.toString('utf8')
const endsWithNewline = originalText.endsWith('\n')
const lines = endsWithNewline ? originalText.slice(0, -1).split('\n') : originalText.split('\n')
const targetPrefix = `${keyName}=`
let targetLineIndex = -1
let occurrences = 0
lines.forEach((line, idx) => {
  if (line.startsWith(targetPrefix)) {
    occurrences += 1
    targetLineIndex = idx
  }
})
if (occurrences !== 1) {
  console.error(`ERROR: se esperaba EXACTAMENTE una línea "${keyName}=..." en $SECRETS_FILE, se encontraron ${occurrences} (documento inconsistente con lo ya validado por parsePlainEnvEntries — abortado por seguridad).`)
  closeSync(fd)
  process.exit(2)
}
lines[targetLineIndex] = `${targetPrefix}${newValueText}`
const reconstructedText = lines.join('\n') + (endsWithNewline ? '\n' : '')
const reconstructedBuffer = Buffer.from(reconstructedText, 'utf8')

// --- 6. Valida el DOCUMENTO COMPLETO reconstruido contra el inventario
//        cerrado + obligatorias de la versión de esquema "active" —
//        nunca se asume que sustituir una línea ya conocida es
//        automáticamente seguro para el documento entero. ---
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

// --- 7. Escribe el documento completo al fd YA ABIERTO Y VERIFICADO del
//        temporal, con fsync. ---
try {
  ftruncateSync(fd, 0)
  let written = 0
  while (written < reconstructedBuffer.length) {
    written += writeSync(fd, reconstructedBuffer, written, reconstructedBuffer.length - written, written)
  }
  fsyncSync(fd)
} catch (err) {
  console.error(`ERROR al escribir/fsync el temporal: ${err.message}`)
  closeSync(fd)
  process.exit(4)
}

// --- 8. Revalidación INMEDIATAMENTE antes del rename (lstat sobre la
//        RUTA, nunca sigue un symlink) — mismo límite residual honesto
//        que writeRestorePayload.mjs: reduce la ventana, no la elimina. ---
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

// --- 9. Rename atómico + verificación del destino. ---
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
  destOk = destSt.isFile() && destSt.dev === expectedDev && destSt.ino === expectedIno
} catch {
  destOk = false
}
closeSync(fd)
if (!destOk) {
  console.error('AVISO: el rename se ejecutó pero el destino no corresponde al inodo esperado al reverificarlo — trátalo como evidencia de posible interferencia externa.')
  process.exit(13)
}

// --- 10. fsync del directorio contenedor — mejor esfuerzo (misma
//         limitación de plataforma que writeRestorePayload.mjs). ---
try {
  const dirFd = openSync(path.dirname(secretsFilePath), constants.O_RDONLY)
  try {
    fsyncSync(dirFd)
  } finally {
    closeSync(dirFd)
  }
} catch {
  // Mejor esfuerzo — el fichero ya está renombrado de forma atómica.
}

process.stdout.write('ok\n')
process.exit(0)
