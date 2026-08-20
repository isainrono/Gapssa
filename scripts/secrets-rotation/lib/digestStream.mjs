#!/usr/bin/env node
// Digest SHA-256 de un flujo por stdin — nunca escribe ni lee ningún
// fichero, nunca imprime nada salvo el propio digest (hexadecimal, una
// línea) en éxito. Único punto de verdad del algoritmo/formato de digest
// de todo scripts/secrets-rotation/, usado tanto para el digest del
// $SECRETS_FILE original (lib.sh::gapssa_secrets_digest_of_file, en
// proceso) como para el digest del backup descifrado en streaming
// (rotate-all-interactive.sh::backup_secrets_file) — así ambos lados de
// la comparación del ensayo de restauración usan exactamente la misma
// implementación, sin depender de qué herramienta de digest (sha256sum/
// shasum/openssl dgst) esté disponible en cada plataforma.
//
// Uso: node digestStream.mjs   (lee stdin completo, imprime el digest)

import { createHash } from 'node:crypto'

const hash = createHash('sha256')

try {
  for await (const chunk of process.stdin) {
    hash.update(chunk)
  }
  process.stdout.write(`${hash.digest('hex')}\n`)
  process.exit(0)
} catch (err) {
  console.error(`ERROR al calcular el digest: ${err.message}`)
  process.exit(1)
}
