#!/usr/bin/env node
// Retira UN temporal huérfano ya identificado por scanOrphanRestoreTmp.mjs
// — nunca hace un "check de symlink seguido de una acción por ruta
// aparte" (eso deja una ventana TOCTOU): revalida con `lstat` (nunca
// sigue symlinks) justo antes de actuar y compara contra la identidad
// (tipo+device+inode) que se fijó en el momento del escaneo. Si algo
// cambió, ABORTA sin tocar nada — nunca sobrescribe ni borra un fichero
// cuya identidad ya no coincide con lo esperado.
//
// Uso: node removeOrphanTmp.mjs <path> <expectedType> <expectedDev> <expectedIno>
//   <expectedType> = symlink | regular
//   symlink -> unlink SOLO del enlace (nunca se abre/lee/sigue su destino)
//   regular -> sobrescritura con bytes aleatorios + unlink (mismo
//              "mejor esfuerzo" documentado que gapssa_secrets_shred en
//              lib.sh — nunca una garantía de borrado forense en
//              filesystems copy-on-write como APFS)
//
// Exit codes: 0 = retirado; 1 = uso incorrecto; 2 = la identidad ya no
// coincide (posible sustitución) — nada se ha tocado, evidencia (tipo/
// ruta) va a stderr, nunca contenido.

import { lstatSync, unlinkSync, openSync, fstatSync, writeSync, closeSync, constants } from 'node:fs'
import { randomBytes } from 'node:crypto'

const [, , targetPath, expectedType, expectedDevArg, expectedInoArg] = process.argv

if (!targetPath || !expectedType || !expectedDevArg || !expectedInoArg || !['symlink', 'regular'].includes(expectedType)) {
  console.error('Uso: removeOrphanTmp.mjs <path> <symlink|regular> <dev> <ino>')
  process.exit(1)
}

const expectedDev = Number(expectedDevArg)
const expectedIno = Number(expectedInoArg)

let st
try {
  st = lstatSync(targetPath)
} catch (err) {
  console.error(`ERROR: no se pudo revalidar '${targetPath}' antes de retirarlo (${err.code ?? err.message}) — abortado, nada tocado.`)
  process.exit(2)
}

const actualType = st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'regular' : 'other'
if (actualType !== expectedType || st.dev !== expectedDev || st.ino !== expectedIno) {
  console.error(`ERROR: '${targetPath}' cambió de identidad desde el escaneo (tipo esperado=${expectedType}, real=${actualType}) — posible sustitución, ABORTADO sin tocar nada.`)
  process.exit(2)
}

if (expectedType === 'symlink') {
  // Nunca se abre ni se resuelve el enlace — `unlinkSync` sobre una ruta
  // que es un symlink borra el enlace en sí, nunca su destino.
  unlinkSync(targetPath)
  process.exit(0)
}

// Fichero regular: abrir con O_NOFOLLOW (defensa adicional — aunque ya
// se confirmó con lstat que no es un symlink, este open cierra la misma
// ventana que writeRestorePayload.mjs documenta) y confirmar identidad
// también sobre el fd ya abierto antes de sobrescribir.
let fd
try {
  fd = openSync(targetPath, constants.O_WRONLY | constants.O_NOFOLLOW)
  const fdSt = fstatSync(fd)
  if (!fdSt.isFile() || fdSt.dev !== expectedDev || fdSt.ino !== expectedIno) {
    console.error(`ERROR: '${targetPath}' cambió de identidad justo al abrirlo — ABORTADO sin sobrescribir.`)
    closeSync(fd)
    process.exit(2)
  }
  const size = fdSt.size
  if (size > 0) {
    writeSync(fd, randomBytes(size), 0, size, 0)
  }
  closeSync(fd)
} catch (err) {
  if (fd !== undefined) {
    try {
      closeSync(fd)
    } catch {
      // ya cerrado
    }
  }
  console.error(`ERROR al sobrescribir '${targetPath}': ${err.message}`)
  process.exit(2)
}
unlinkSync(targetPath)
process.exit(0)
