#!/usr/bin/env node
// fsync de un fichero o de un directorio, vía un fd abierto — bash no
// tiene una forma nativa de forzar esto, así que aquí vive el único
// punto que lo hace en todo scripts/secrets-rotation/.
//
// Uso: node fsyncPath.mjs file <ruta>   — fsync de un fichero REGULAR ya
//                                          existente (nunca sigue un
//                                          symlink: se abre con
//                                          O_NOFOLLOW).
//      node fsyncPath.mjs dir  <ruta>   — fsync de un directorio.
//
// En Linux (ext4/xfs), fsync sobre el fd de un directorio es el modismo
// estándar para dar durabilidad a una entrada de directorio recién
// creada/renombrada (p.ej. tras un mv atómico). En macOS/APFS, la
// llamada se acepta pero NO ofrece la misma garantía documentada — el
// primitivo recomendado por Apple para "de verdad en el disco" es
// F_FULLFSYNC, que además normalmente solo se documenta para ficheros
// regulares, no para directorios, y requiere fcntl (fuera del alcance de
// este helper mínimo). Por eso el fsync de directorio se trata SIEMPRE
// como mejor esfuerzo por el llamador (bash degrada un fallo aquí a un
// AVISO no fatal) — esta es una limitación de plataforma documentada, no
// un fallo silenciado.

import { openSync, fsyncSync, closeSync, fstatSync, constants } from 'node:fs'

const [, , kind, targetPath] = process.argv

if ((kind !== 'file' && kind !== 'dir') || !targetPath) {
  console.error('Uso: fsyncPath.mjs <file|dir> <ruta>')
  process.exit(1)
}

let fd
try {
  const flags = kind === 'file' ? constants.O_RDONLY | constants.O_NOFOLLOW : constants.O_RDONLY
  fd = openSync(targetPath, flags)
  const st = fstatSync(fd)
  if (kind === 'file' && !st.isFile()) {
    console.error('ERROR: la ruta no es un fichero regular (o es un symlink) — fsync rechazado.')
    process.exit(2)
  }
  if (kind === 'dir' && !st.isDirectory()) {
    console.error('ERROR: la ruta no es un directorio — fsync rechazado.')
    process.exit(2)
  }
  fsyncSync(fd)
  process.exit(0)
} catch (err) {
  console.error(`ERROR al hacer fsync de "${kind}": ${err.message}`)
  process.exit(2)
} finally {
  if (fd !== undefined) {
    try {
      closeSync(fd)
    } catch {
      // ya cerrado o inválido — nada más que hacer aquí.
    }
  }
}
