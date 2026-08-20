// scripts/secrets-rotation/probes/shared/hs256.mts
//
// Firmar/verificar HS256 minimalista para el JWT de sesión de Payload
// (apps/web/src/payload.config.ts) — no existe un módulo JWT reutilizable
// en apps/web (Payload firma su propio JWT de admin internamente, sin
// exponer una función reutilizable), así que esta es la única
// implementación, extraída verbatim de los heredocs ts_pre/ts_post que
// existían antes en rotate-all-interactive.sh (ts_pre solo definía
// signHs256; ts_post definía ambas) — nunca una reimplementación nueva.
//
// El secreto entra SIEMPRE como parámetro de función interno de Node
// (nunca argv, nunca stdout/stderr) — quien llama a signHs256/verifyHs256
// lo obtiene de serverEnv.PAYLOAD_SECRET, que a su vez viene del entorno
// del proceso hijo ya filtrado por loadSecretsEnv.mjs/run-tsx.mjs.

import { createHmac } from 'node:crypto'

export function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

export function verifyHs256(token: string, secret: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [header, body, sig] = parts
  const expected = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return expected === sig
}
