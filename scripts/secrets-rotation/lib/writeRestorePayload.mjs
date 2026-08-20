#!/usr/bin/env node
// Único punto de todo scripts/secrets-rotation/ que escribe el
// CONTENIDO descifrado de una restauración real y lo coloca en su
// destino final — TODO en este mismo proceso: apertura segura, validación
// completa, escritura, fsync, reverificación y RENAME atómico. Bash NUNCA
// ejecuta un `mv` por separado después de este script — el rename ocurre
// aquí para que no exista una segunda invocación de proceso (y por tanto
// una segunda ventana de tiempo) entre "el contenido ya se validó" y "el
// fichero ya está en su sitio".
//
// Cómo se protege contra sustitución:
//   1. Abre <tempPath> con O_WRONLY|O_NOFOLLOW — el kernel rechaza el
//      open con ELOOP si la ruta es un symlink, nunca lo sigue.
//   2. Valida la IDENTIDAD DEL FD YA ABIERTO (fstat, no stat sobre la
//      ruta) contra el pin device+inode+propietario+modo que bash
//      capturó en el mismo instante en que creó el fichero — un fd ya
//      abierto no puede "convertirse" en otro inodo por mucho que se
//      manipule la ruta después.
//   3. Solo entonces lee/parsea/valida el contenido y escribe.
//   4. Justo ANTES del rename, vuelve a comprobar la ruta con `lstat`
//      (nunca sigue symlinks) contra el MISMO pin — si algo cambió desde
//      el paso 2, aborta sin renombrar.
//   5. Ejecuta el rename atómico él mismo (`renameSync`), y después
//      confirma que el destino resultante es un fichero regular con el
//      inodo esperado.
//
// LÍMITE RESIDUAL HONESTO (no se afirma una garantía más fuerte de la
// que existe): entre el `lstat` del paso 4 y el `renameSync` del paso 5
// sigue habiendo, inevitablemente, una ventana de tiempo — POSIX no
// ofrece un "rename basado en descriptor" portable (Linux tiene trucos
// vía /proc/self/fd + renameat2, pero este código debe funcionar también
// en macOS/APFS, sin esas extensiones). Esta implementación reduce esa
// ventana al mínimo posible (dos llamadas de sistema consecutivas, sin
// ninguna E/S de por medio, dentro del mismo proceso) — NO la elimina.
// El modelo de amenaza que sí queda cubierto: el directorio que contiene
// $SECRETS_FILE está siempre en modo 700 y es propiedad del operador
// (impuesto por gapssa_secrets_abort_if_inside_workspace +
// 01-init-external-store.sh) — bajo permisos POSIX normales, SOLO ese
// mismo usuario (o root) puede crear/sustituir ficheros ahí dentro. Un
// atacante capaz de ganar esa ventana de microsegundos ya tendría que
// estar ejecutando código como ese mismo usuario (o como root) en la
// misma máquina, momento en el que podría leer el secreto en claro por
// vías mucho más directas (ptrace, /proc del propio proceso, etc.) —
// este rename no pretende defender de un atacante YA con esas
// capacidades, solo de una sustitución accidental o de un proceso
// externo sin esos privilegios.
//
// Uso:
//   node writeRestorePayload.mjs <tempPath> <destPath> <dev> <ino> <uid> <modo-octal>
//   stdin: bytes descifrados completos (etiqueta de esquema + cuerpo)
//
// Códigos de salida:
//   0  = éxito — renombrado a <destPath>, stdout = versión de esquema
//   1  = uso incorrecto
//   2  = error de parseo del contenido descifrado
//   3  = contenido no válido para el inventario/obligatorias de su esquema
//   4  = fallo al escribir o al hacer fsync del fichero
//   10 = identidad del temporal no coincide con el pin ANTES de escribir
//        (posible sustitución) — nada se ha escrito
//   11 = identidad del temporal no coincide con el pin JUSTO ANTES del
//        rename (posible sustitución durante la escritura) — el rename
//        NUNCA se ejecuta en este caso
//   12 = el propio rename falló
//   13 = el destino tras el rename no corresponde al inodo esperado
//        (evidencia para el llamador, el rename ya ocurrió)
//
// Nunca imprime contenido/valores. Nunca crea el temporal (falla si no
// existe ya) ni sigue un symlink en ningún punto.

import { openSync, closeSync, fstatSync, lstatSync, ftruncateSync, writeSync, fsyncSync, renameSync, constants } from 'node:fs'
import path from 'node:path'
import { parseTaggedPayload, validateEntriesAgainstSchema, BackupSchemaError } from './backupSchema.mjs'

const [, , tempPath, destPath, expectedDevArg, expectedInoArg, expectedUidArg, expectedModeArg] = process.argv

if (!tempPath || !destPath || !expectedDevArg || !expectedInoArg || !expectedUidArg || !expectedModeArg) {
  console.error('Uso: writeRestorePayload.mjs <tempPath> <destPath> <dev> <ino> <uid> <modo-octal>')
  process.exit(1)
}

const expectedDev = Number(expectedDevArg)
const expectedIno = Number(expectedInoArg)
const expectedUid = Number(expectedUidArg)
const expectedMode = parseInt(expectedModeArg, 8)

function matchesPin(st) {
  return st.isFile() && st.dev === expectedDev && st.ino === expectedIno && st.uid === expectedUid && (st.mode & 0o777) === expectedMode
}

let fd
try {
  fd = openSync(tempPath, constants.O_WRONLY | constants.O_NOFOLLOW)
} catch (err) {
  console.error(`ERROR: no se pudo abrir el temporal de restauración (${err.code ?? err.message}).`)
  process.exit(10)
}

try {
  const st = fstatSync(fd)
  if (!matchesPin(st)) {
    console.error('ERROR: el temporal de restauración cambió de identidad (device/inode/propietario/modo no coinciden) — posible sustitución. Nada se ha escrito.')
    process.exit(10)
  }
} catch (err) {
  console.error(`ERROR al verificar la identidad del temporal: ${err.message}`)
  process.exit(10)
}

const chunks = []
try {
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
} catch (err) {
  console.error(`ERROR al leer stdin: ${err.message}`)
  closeSync(fd)
  process.exit(2)
}

const buffer = Buffer.concat(chunks)
let parsed
try {
  parsed = parseTaggedPayload(buffer)
  validateEntriesAgainstSchema(parsed.schemaVersion, parsed.entries)
} catch (err) {
  closeSync(fd)
  if (err instanceof BackupSchemaError) {
    console.error(err.message)
    process.exit(err.message.includes('inventario cerrado') || err.message.includes('obligatoria') || err.message.includes('mezcla') ? 3 : 2)
  }
  console.error(`ERROR inesperado al validar el contenido: ${err.message}`)
  process.exit(2)
}

const body = buffer.subarray(parsed.bodyStartOffset)

try {
  ftruncateSync(fd, 0)
  // Bucle de escritura: writeSync puede escribir MENOS bytes de los
  // pedidos en una sola llamada (escritura parcial) — nunca se asume que
  // una única llamada basta, se sigue escribiendo desde el offset que
  // falta hasta agotar el buffer completo.
  let written = 0
  while (written < body.length) {
    written += writeSync(fd, body, written, body.length - written, written)
  }
  fsyncSync(fd)
} catch (err) {
  console.error(`ERROR al escribir/fsync el temporal de restauración: ${err.message}`)
  closeSync(fd)
  process.exit(4)
}

// Reverificación INMEDIATAMENTE antes del rename — usa `lstat` sobre la
// RUTA (nunca `fstat` del fd, que no puede detectar una sustitución de
// la ruta en sí) y NUNCA sigue un symlink. Ver el límite residual
// documentado arriba: esto reduce la ventana, no la elimina.
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
  renameSync(tempPath, destPath)
} catch (err) {
  console.error(`ERROR: el rename atómico falló: ${err.message}`)
  closeSync(fd)
  process.exit(12)
}

let destOk = false
try {
  const destSt = lstatSync(destPath)
  destOk = destSt.isFile() && destSt.dev === expectedDev && destSt.ino === expectedIno
} catch {
  destOk = false
}
closeSync(fd)
if (!destOk) {
  console.error('AVISO: el rename se ejecutó pero el destino no corresponde al inodo esperado al reverificarlo — trátalo como evidencia de posible interferencia externa.')
  process.exit(13)
}

// fsync del directorio contenedor — mejor esfuerzo documentado (ver la
// misma limitación de plataforma que lib/fsyncPath.mjs: fiable en Linux,
// sin la misma garantía en macOS/APFS). Un fallo aquí NUNCA deshace el
// rename ya completado.
try {
  const dirFd = openSync(path.dirname(destPath), constants.O_RDONLY)
  try {
    fsyncSync(dirFd)
  } finally {
    closeSync(dirFd)
  }
} catch {
  // Mejor esfuerzo — el fichero ya está renombrado de forma atómica de
  // todos modos; el llamador decide si avisar de esto como no fatal.
}

process.stdout.write(`${parsed.schemaVersion}\n`)
process.exit(0)
