#!/usr/bin/env node
// scripts/secrets-rotation/lib/updateRedisSecrets.mjs — Bloque 8 (S5)
//
// Actualiza REDIS_PASSWORD y REDIS_URL de un $SECRETS_FILE PLANO ya
// existente EN UNA SOLA operación atómica — nunca dos escrituras
// independientes (una para cada campo), nunca O_TRUNC directo sobre
// $SECRETS_FILE. Mismo patrón atómico ya aceptado en el Bloque 2/5
// (lib/writeRestorePayload.mjs, lib/updateSecretsFileField.mjs):
// temporal FIJADO en el mismo directorio, abierto con O_NOFOLLOW,
// identidad del fd verificada por fstat contra el pin capturado por
// bash al crearlo, escritura+fsync, revalidación por lstat justo antes
// del rename, rename atómico, verificación del destino, fsync del
// directorio contenedor — TODO en este mismo proceso.
//
// A diferencia de updateSecretsFileField.mjs (un solo campo, valor
// opaco): aquí el valor nuevo de REDIS_URL NUNCA se construye por
// sustitución de texto (regex) — se PARSEA la REDIS_URL ya existente en
// la preimagen con la clase `URL` nativa (valida esquema/host/puerto de
// verdad; nunca "puede no sustituir nada" en silencio, un fallo de
// parseo aborta ANTES de escribir), se reemplaza ÚNICAMENTE el
// componente `password` (percent-encoding vía la propia clase `URL`,
// nunca a mano), y se releen los caracteres exactos que quedarían
// escritos (URL reconstruida -> reparseada -> decodeURIComponent) para
// confirmar que decodifican EXACTAMENTE a la contraseña nueva antes de
// aceptar el resultado — nunca se imprime ese valor.
//
// Uso:
//   node updateRedisSecrets.mjs <secretsFilePath> <tempPath> <dev> <ino> <uid> <modo-octal> <schemaVersion>
//   stdin: la REDIS_PASSWORD nueva, bytes crudos (nunca por argv).
//
// Códigos de salida (mismo esquema que updateSecretsFileField.mjs):
//   0  = éxito — REDIS_PASSWORD y REDIS_URL actualizados en <secretsFilePath>
//   1  = uso incorrecto
//   2  = cuerpo de entrada inválido, o preimagen de $SECRETS_FILE con
//        documento malformado (líneas mal formadas, CR, NUL, claves
//        duplicadas), o REDIS_PASSWORD/REDIS_URL ausente o duplicada en
//        ella
//   3  = el valor nuevo de REDIS_PASSWORD no cumple el contrato cerrado
//        de secretos GENERADOS por este toolkit (alfabeto hex/base64),
//        o REDIS_URL existente no es una URL válida/no cumple el
//        contrato (esquema "redis:", host no vacío, puerto numérico
//        1-65535), o la relectura obligatoria tras reconstruir la URL
//        no decodifica EXACTAMENTE a la contraseña nueva, o el
//        documento COMPLETO tras la sustitución no valida contra el
//        inventario/obligatorias de la versión de esquema activa
//   4  = fallo al escribir o hacer fsync del temporal
//   10 = identidad del temporal no coincide con el pin ANTES de escribir
//   11 = identidad del temporal no coincide con el pin JUSTO ANTES del
//        rename — el rename NUNCA se ejecuta en este caso
//   12 = el propio rename falló
//   13 = el destino tras el rename no corresponde al inodo esperado
//        (evidencia para el llamador, el rename ya ocurrió)
//   14 = la preimagen de $SECRETS_FILE no pasó la comprobación de
//        symlink/tipo/propietario/modo — nada se ha escrito
//
// Nunca imprime REDIS_PASSWORD, REDIS_URL, ni ningún fragmento de ellos.

import { openSync, closeSync, fstatSync, lstatSync, readFileSync, ftruncateSync, writeSync, fsyncSync, renameSync, constants } from 'node:fs'
import path from 'node:path'
import { parsePlainEnvEntries, validateEntriesAgainstSchema, BackupSchemaError, KNOWN_SCHEMA_VERSIONS } from './backupSchema.mjs'
import { validateSecretValue, validateGeneratedSecretValue } from './secretValueContract.mjs'

const USAGE = 'Uso: updateRedisSecrets.mjs <secretsFilePath> <tempPath> <dev> <ino> <uid> <modo-octal> <schemaVersion>'
const REDIS_PASSWORD_KEY = 'REDIS_PASSWORD'
const REDIS_URL_KEY = 'REDIS_URL'

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

// --- 3. Lee REDIS_PASSWORD nueva por stdin (cruda) y la valida contra
//        el contrato ESTRICTO de secretos generados por este toolkit
//        (hex CSPRNG o base64 estándar — el único alfabeto que
//        gate_s5/openssl rand -base64 produce). ---
const stdinChunks = []
try {
  for await (const chunk of process.stdin) stdinChunks.push(chunk)
} catch (err) {
  console.error(`ERROR al leer stdin: ${err.message}`)
  closeSync(fd)
  process.exit(2)
}
const newPasswordBuffer = Buffer.concat(stdinChunks)
const passwordContract = validateGeneratedSecretValue(newPasswordBuffer)
if (!passwordContract.ok) {
  console.error(`ERROR: la REDIS_PASSWORD nueva no cumple el contrato cerrado de secretos generados (${passwordContract.reason}).`)
  closeSync(fd)
  process.exit(3)
}
const newPasswordText = newPasswordBuffer.toString('utf8')

// --- 4. Tokeniza la preimagen completa (rechaza documento malformado:
//        líneas mal formadas, claves duplicadas, CRLF, NUL) y exige
//        EXACTAMENTE una ocurrencia de REDIS_PASSWORD Y de REDIS_URL. ---
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
for (const key of [REDIS_PASSWORD_KEY, REDIS_URL_KEY]) {
  if (!preimageEntries.has(key)) {
    console.error(`ERROR: la clave "${key}" no está presente en $SECRETS_FILE — no hay nada que actualizar (nunca se añade una clave nueva por esta vía).`)
    closeSync(fd)
    process.exit(2)
  }
}
// parsePlainEnvEntries ya rechaza duplicados de CUALQUIER clave (Map
// construido por tokenizeEnvLines, que aborta ante una clave repetida
// antes de devolver nada) — la comprobación de arriba solo cubre la
// ausencia; la de duplicados ya ocurrió, fail-closed, en el paso 4.

// --- 5. Parsea (nunca regex) la REDIS_URL EXISTENTE y valida su
//        contrato: esquema "redis:" exacto, host no vacío, puerto
//        numérico 1-65535. Reemplaza ÚNICAMENTE el componente
//        `password` (percent-encoding vía la propia clase URL) y relee
//        el resultado para confirmar, sin imprimirlo, que decodifica
//        EXACTAMENTE a la contraseña nueva. ---
const oldRedisUrlText = preimageEntries.get(REDIS_URL_KEY)
const oldUrlContract = validateSecretValue(Buffer.from(oldRedisUrlText, 'utf8'))
if (!oldUrlContract.ok) {
  console.error(`ERROR: la REDIS_URL existente no cumple el contrato general de valores (${oldUrlContract.reason}).`)
  closeSync(fd)
  process.exit(3)
}
let parsedUrl
try {
  parsedUrl = new URL(oldRedisUrlText)
} catch {
  console.error('ERROR: la REDIS_URL existente no es una URL válida — rechazada (nunca se intenta "arreglar" con una sustitución de texto).')
  closeSync(fd)
  process.exit(3)
}
if (parsedUrl.protocol !== 'redis:') {
  console.error(`ERROR: la REDIS_URL existente usa el esquema "${parsedUrl.protocol}", se esperaba "redis:".`)
  closeSync(fd)
  process.exit(3)
}
if (!parsedUrl.hostname) {
  console.error('ERROR: la REDIS_URL existente no tiene host.')
  closeSync(fd)
  process.exit(3)
}
const portNum = parsedUrl.port === '' ? NaN : Number(parsedUrl.port)
if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
  console.error('ERROR: la REDIS_URL existente no tiene un puerto numérico válido (1-65535).')
  closeSync(fd)
  process.exit(3)
}

parsedUrl.password = newPasswordText
const newRedisUrlText = parsedUrl.toString()

// Relectura obligatoria — reparsea la URL RECONSTRUIDA (nunca confía en
// la propia construcción) y confirma que decodeURIComponent(password)
// es EXACTAMENTE la contraseña nueva. Nunca imprime ninguno de los dos
// valores, solo el resultado booleano de la comparación.
let reencodeOk = false
try {
  const reparsed = new URL(newRedisUrlText)
  reencodeOk = reparsed.protocol === 'redis:' && reparsed.hostname === parsedUrl.hostname && reparsed.port === parsedUrl.port && decodeURIComponent(reparsed.password) === newPasswordText
} catch {
  reencodeOk = false
}
if (!reencodeOk) {
  console.error('ERROR: la relectura obligatoria de la REDIS_URL reconstruida no confirmó la contraseña nueva ya codificada — rechazada, nada se ha escrito.')
  closeSync(fd)
  process.exit(3)
}
const newUrlContract = validateSecretValue(Buffer.from(newRedisUrlText, 'utf8'))
if (!newUrlContract.ok) {
  console.error(`ERROR: la REDIS_URL reconstruida no cumple el contrato general de valores (${newUrlContract.reason}).`)
  closeSync(fd)
  process.exit(3)
}

// --- 6. Reconstruye el documento, sustituyendo SOLO las líneas de
//        REDIS_PASSWORD y REDIS_URL, preservando el resto BYTE A BYTE
//        (mismo orden, comentarios, líneas en blanco, terminador final). ---
const originalText = preimageBuffer.toString('utf8')
const endsWithNewline = originalText.endsWith('\n')
const lines = endsWithNewline ? originalText.slice(0, -1).split('\n') : originalText.split('\n')
const replacements = { [REDIS_PASSWORD_KEY]: newPasswordText, [REDIS_URL_KEY]: newRedisUrlText }
const occurrences = { [REDIS_PASSWORD_KEY]: 0, [REDIS_URL_KEY]: 0 }
for (let i = 0; i < lines.length; i++) {
  for (const key of [REDIS_PASSWORD_KEY, REDIS_URL_KEY]) {
    const prefix = `${key}=`
    if (lines[i].startsWith(prefix)) {
      occurrences[key] += 1
      lines[i] = `${prefix}${replacements[key]}`
    }
  }
}
for (const key of [REDIS_PASSWORD_KEY, REDIS_URL_KEY]) {
  if (occurrences[key] !== 1) {
    console.error(
      `ERROR: se esperaba EXACTAMENTE una línea "${key}=..." en $SECRETS_FILE, se encontraron ${occurrences[key]} (documento inconsistente con lo ya validado — abortado por seguridad).`,
    )
    closeSync(fd)
    process.exit(2)
  }
}
const reconstructedText = lines.join('\n') + (endsWithNewline ? '\n' : '')
const reconstructedBuffer = Buffer.from(reconstructedText, 'utf8')

// --- 7. Valida el DOCUMENTO COMPLETO reconstruido contra el inventario
//        cerrado + obligatorias de la versión de esquema activa. ---
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

// --- 8. Escribe el documento completo al fd YA ABIERTO Y VERIFICADO del
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

// --- 9. Revalidación INMEDIATAMENTE antes del rename (lstat sobre la
//        RUTA, nunca sigue un symlink). ---
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

// --- 10. Rename atómico + verificación del destino. ---
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

// --- 11. fsync del directorio contenedor — mejor esfuerzo. ---
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
