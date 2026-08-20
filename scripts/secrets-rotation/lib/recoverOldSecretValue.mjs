#!/usr/bin/env node
// Recupera UNA variable de un backup cifrado, coordinando descifrado +
// parseo dentro de ESTE ÚNICO proceso — nunca hay una tubería de bash de
// por medio (openssl se lanza como HIJO de este proceso, su stdout se
// consume enteramente en memoria) y nunca se escribe el contenido
// descifrado a ningún fichero, ni siquiera temporal.
//
// Motivo del diseño de un solo proceso: con una tubería bash
// `openssl | node script.mjs`, capturar el VALOR de salida exige
// envolverla en `$(...)`, y una tubería dentro de una sustitución de
// comando dejaba de exponer el código de salida de CADA etapa por
// separado en el proceso padre (comprobado empíricamente) — la única
// forma de tener AMBAS cosas (valor exacto + código de salida real de
// openssl) sin escribir nada a disco es que un único proceso orqueste
// las dos etapas internamente.
//
// Uso: node recoverOldSecretValue.mjs <backupPath> <passfilePath> <VAR_NAME>
//   stdout: SOLO el valor de VAR_NAME, en el único caso de éxito (exit 0)
//   stderr: mensajes de error — número de línea / nombre de clave / causa
//           de fallo de openssl, NUNCA el valor
//
// Códigos de salida:
//   0 = valor encontrado e impreso
//   1 = uso incorrecto (argv ausente/inválido)
//   2 = error de parseo/esquema del backup descifrado (línea mal formada,
//       clave duplicada, metadata de versión ausente/desconocida, byte NUL)
//   3 = la variable solicitada no está en el backup
//   4 = openssl no pudo descifrar (frase incorrecta o backup corrupto)
//
// El llamador (bash) DEBE hacer `unset` del valor capturado justo
// después de usarlo — este script no puede imponerlo desde fuera de su
// propio proceso.

import { spawn } from 'node:child_process'
import { parseTaggedPayload, BackupSchemaError } from './backupSchema.mjs'

const [, , backupPath, passfilePath, varName] = process.argv

if (!backupPath || !passfilePath || !varName || !/^[A-Z_][A-Z0-9_]*$/.test(varName)) {
  console.error('Uso: recoverOldSecretValue.mjs <backupPath> <passfilePath> <VAR_NAME>')
  process.exit(1)
}

function runOpensslDecrypt() {
  return new Promise((resolve) => {
    const child = spawn(
      'openssl',
      ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', backupPath, '-pass', `file:${passfilePath}`],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.on('error', () => resolve({ code: 1, buffer: Buffer.concat(chunks) }))
    child.on('close', (code) => resolve({ code: code ?? 1, buffer: Buffer.concat(chunks) }))
  })
}

const { code: opensslCode, buffer } = await runOpensslDecrypt()
if (opensslCode !== 0) {
  console.error('No se pudo descifrar el backup (frase de recuperación incorrecta o backup corrupto).')
  process.exit(4)
}

let parsed
try {
  parsed = parseTaggedPayload(buffer)
} catch (err) {
  if (err instanceof BackupSchemaError) {
    console.error(err.message)
    process.exit(2)
  }
  console.error(`ERROR inesperado al parsear el backup descifrado: ${err.message}`)
  process.exit(2)
}

if (!parsed.entries.has(varName)) {
  console.error(`Variable "${varName}" no encontrada en el backup.`)
  process.exit(3)
}

process.stdout.write(parsed.entries.get(varName))
process.exit(0)
