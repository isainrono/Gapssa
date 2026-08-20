#!/usr/bin/env node
// scripts/secrets-rotation/lib/secretValueContract.mjs — Bloque 5,
// Revisión 2
//
// Contrato CERRADO de qué bytes puede tener un valor secreto en este
// toolkit — sustituye la afirmación anterior, no verificada, de "soporte
// arbitrario para cualquier byte": el formato KEY=value de $SECRETS_FILE
// (una línea de texto por variable, ver lib/backupSchema.mjs) NUNCA puede
// representar con seguridad un CR, un LF o un byte NUL dentro de un
// valor — así que este contrato los rechaza SIEMPRE, no solo cuando el
// valor va a escribirse en ese formato. Aplicarlo también a un valor que
// solo viaja en memoria (nunca hacia $SECRETS_FILE) es una decisión
// deliberada de mantener una única regla, simple y auditable, en vez de
// dos contratos distintos según el destino.
//
// Dos niveles:
//   - validateSecretValue(buffer)          — el contrato general: no
//     vacío, sin NUL/CR/LF, longitud máxima explícita, UTF-8 válido. Se
//     aplica a CUALQUIER valor que este toolkit vaya a aplicar a un
//     servidor o escribir en $SECRETS_FILE — incluidos los valores
//     HEREDADOS (con puntuación arbitraria: comillas, backslash, `$`,
//     backticks, `;`, `&`, espacios, Unicode válido) — esos se preservan
//     EXACTAMENTE, byte a byte, nunca se normalizan ni se reescriben,
//     mientras cumplan este contrato general.
//   - validateGeneratedSecretValue(buffer) — más estricto: además del
//     contrato general, exige que el valor use el alfabeto CERRADO que
//     este toolkit ya usa para minar secretos nuevos (hexadecimal
//     CSPRNG, vía 02-generate-secret.sh --format hex — o base64
//     estándar, el otro formato que ese mismo script ya emite para
//     secretos que exigen una longitud de bytes exacta, p.ej. la clave
//     AES-256 de BOOKING_FIELD_ENCRYPTION_KEYS). Nunca se aplica a un
//     valor heredado — un valor heredado con puntuación válida sigue
//     pasando solo por validateSecretValue.
//
// Nunca imprime el valor evaluado — ni en el resultado de la función, ni
// en el modo CLI (ver más abajo), ni en ningún mensaje de error.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MAX_SECRET_VALUE_BYTES = 4096

export class SecretValueContractError extends Error {}

const HEX_ALPHABET = /^[0-9a-f]+$/
// Base64 estándar (RFC 4648 §4) tal como lo emite `Buffer#toString('base64')`
// / `base64.b64encode` de Python — alfabeto A-Za-z0-9+/ con como mucho dos
// '=' de relleno al final, nunca en medio.
const BASE64_ALPHABET = /^[A-Za-z0-9+/]+={0,2}$/

function isValidUtf8(buffer) {
  // TextDecoder con fatal:true rechaza cualquier secuencia de bytes que
  // no sea UTF-8 válido (incluidos pares suplentes sueltos, secuencias
  // truncadas o sobrelargas) — a diferencia de Buffer#toString('utf8'),
  // que sustituye en silencio los bytes inválidos por U+FFFD y nunca
  // informa del problema.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

/**
 * Contrato general — aplica a CUALQUIER valor secreto (heredado o nuevo)
 * antes de aplicarlo a un servidor o escribirlo en $SECRETS_FILE.
 * @param {Buffer} buffer
 * @returns {{ok: boolean, reason: string}}
 */
export function validateSecretValue(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('validateSecretValue requiere un Buffer.')
  }
  if (buffer.length === 0) {
    return { ok: false, reason: 'vacío' }
  }
  if (buffer.length > MAX_SECRET_VALUE_BYTES) {
    return { ok: false, reason: `excede la longitud máxima permitida (${MAX_SECRET_VALUE_BYTES} bytes)` }
  }
  if (buffer.includes(0x00)) {
    return { ok: false, reason: 'contiene un byte NUL' }
  }
  if (buffer.includes(0x0d)) {
    return { ok: false, reason: 'contiene un retorno de carro (CR)' }
  }
  if (buffer.includes(0x0a)) {
    return { ok: false, reason: 'contiene un salto de línea (LF)' }
  }
  if (!isValidUtf8(buffer)) {
    return { ok: false, reason: 'no es UTF-8 válido' }
  }
  return { ok: true, reason: '' }
}

/**
 * Contrato estricto para secretos MINADOS por este toolkit — el
 * contrato general, más alfabeto cerrado (hex CSPRNG o base64 estándar).
 * Nunca se aplica a un valor heredado.
 * @param {Buffer} buffer
 * @returns {{ok: boolean, reason: string}}
 */
export function validateGeneratedSecretValue(buffer) {
  const base = validateSecretValue(buffer)
  if (!base.ok) return base
  const text = buffer.toString('utf8')
  if (!HEX_ALPHABET.test(text) && !BASE64_ALPHABET.test(text)) {
    return { ok: false, reason: 'un secreto generado por este toolkit debe usar alfabeto hexadecimal CSPRNG o base64 estándar' }
  }
  return { ok: true, reason: '' }
}

// --- CLI ---
//
// Uso: node secretValueContract.mjs [--generated]
//   stdin: el valor candidato, bytes CRUDOS y completos (sin procesar,
//          sin recorte de salto de línea final — el llamador en bash usa
//          SIEMPRE `printf '%s' "$valor"`, nunca `echo`, para no añadir
//          un LF que el propio contrato rechazaría).
//   stdout: "true" o "false" — NUNCA el valor.
//   stderr: motivo del rechazo (nunca el valor) si stdout fue "false".
//   exit 0 = válido, 1 = rechazado o error de uso.
async function readAllStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function runCli() {
  const mode = process.argv[2] === '--generated' ? 'generated' : process.argv[2] === undefined ? 'plain' : null
  if (mode === null) {
    console.error(`Uso: secretValueContract.mjs [--generated] (argumento no reconocido: "${process.argv[2]}")`)
    process.stdout.write('false')
    process.exit(1)
    return
  }
  const buffer = await readAllStdin()
  const result = mode === 'generated' ? validateGeneratedSecretValue(buffer) : validateSecretValue(buffer)
  if (result.ok) {
    process.stdout.write('true')
    process.exit(0)
  } else {
    process.stdout.write('false')
    console.error(`ERROR secretValueContract: valor rechazado (${result.reason}).`)
    process.exit(1)
  }
}

function resolveIsMain() {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (resolveIsMain()) {
  runCli().catch(() => {
    process.stdout.write('false')
    console.error('ERROR secretValueContract: error interno inesperado.')
    process.exit(1)
  })
}
