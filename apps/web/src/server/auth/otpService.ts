import 'server-only'
import { randomUUID } from 'node:crypto'

import {
  constantTimeEqual,
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  type OtpPurpose,
  type OtpVerificationResult,
} from '@gapssa/contracts'

import { serverEnv } from '../env'
import { getRedisClient, withKeyPrefix } from '../redis'
import { consumeRateLimit } from './rateLimit'

/**
 * Almacenamiento en Redis del ciclo de vida de un `OtpChallenge`
 * (`packages/contracts/src/otp.ts`) — el código en claro nunca se
 * persiste, solo su HMAC (`codeHash`), con TTL. Cada propósito
 * (`account_email_verification`, `password_reset`, `passwordless_login`,
 * `consent_signature`) usa el mismo mecanismo con `subjectRef` distinto.
 *
 * Dos claves por reto activo:
 * - `otp:challenge:<challengeId>` (hash Redis): el propio `OtpChallenge`.
 * - `otp:current:<purpose>:<subjectRef>` (string): puntero al
 *   `challengeId` vigente — permite verificar sabiendo solo el propósito y
 *   el sujeto (el cliente nunca ve ni envía el `challengeId`). Pedir un
 *   código nuevo para el mismo propósito+sujeto invalida el anterior de
 *   inmediato (se sobreescribe el puntero y se borra el reto viejo): nunca
 *   coexisten dos códigos válidos para el mismo propósito+sujeto.
 */

const CHALLENGE_KEY_PREFIX = 'otp:challenge:'
const CURRENT_POINTER_PREFIX = 'otp:current:'

function challengeKey(challengeId: string): string {
  return withKeyPrefix(`${CHALLENGE_KEY_PREFIX}${challengeId}`)
}

function currentPointerKey(purpose: OtpPurpose, subjectRef: string): string {
  return withKeyPrefix(`${CURRENT_POINTER_PREFIX}${purpose}:${subjectRef}`)
}

interface StoredChallenge {
  id: string
  purpose: OtpPurpose
  subjectRef: string
  codeHash: string
  createdAt: string
  expiresAt: string
  maxAttempts: number
  attemptsUsed: number
  consumedAt: string
  lockedAt: string
  [key: string]: string | number
}

export type OtpRequestOutcome =
  | { outcome: 'issued'; challengeId: string; code: string; expiresAt: string }
  | { outcome: 'rate_limited' }

/**
 * Emite un nuevo código para `purpose`+`subjectRef`. Aplica el límite de
 * solicitudes **por sujeto** (`OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR`) — el
 * límite por IP es responsabilidad del llamante (la ruta API conoce la IP,
 * este servicio no), usando el mismo `consumeRateLimit` con su propia
 * clave (`otp-request:ip:<ip>:<purpose>`).
 *
 * El código en claro se devuelve **solo** para que el llamante lo envíe
 * por correo (`mailer.ts`) — nunca se persiste ni se audita
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §15).
 */
export async function requestOtp(purpose: OtpPurpose, subjectRef: string): Promise<OtpRequestOutcome> {
  const subjectRateLimit = await consumeRateLimit(
    `otp-request:subject:${purpose}:${subjectRef}`,
    serverEnv.OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR,
    3600,
  )
  if (!subjectRateLimit.allowed) {
    return { outcome: 'rate_limited' }
  }

  const client = await getRedisClient()
  const challengeId = randomUUID()
  const code = generateOtpCode()
  const codeHash = await hashOtpCode({ challengeId, purpose, subjectRef }, code, serverEnv.OTP_HMAC_SECRET)

  const now = new Date()
  const expiresAt = new Date(now.getTime() + serverEnv.OTP_TTL_MINUTES * 60_000)
  const ttlSeconds = serverEnv.OTP_TTL_MINUTES * 60

  const stored: StoredChallenge = {
    id: challengeId,
    purpose,
    subjectRef,
    codeHash,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxAttempts: serverEnv.OTP_MAX_ATTEMPTS,
    attemptsUsed: 0,
    consumedAt: '',
    lockedAt: '',
  }

  // Invalida cualquier reto anterior para el mismo propósito+sujeto antes
  // de publicar el nuevo puntero: nunca dos códigos vivos a la vez.
  const previousChallengeId = await client.get(currentPointerKey(purpose, subjectRef))
  const multi = client.multi()
  if (previousChallengeId) {
    multi.del(challengeKey(previousChallengeId))
  }
  multi.hSet(challengeKey(challengeId), stored)
  multi.expire(challengeKey(challengeId), ttlSeconds)
  multi.set(currentPointerKey(purpose, subjectRef), challengeId, { EX: ttlSeconds })
  await multi.exec()

  return { outcome: 'issued', challengeId, code, expiresAt: expiresAt.toISOString() }
}

/**
 * Script Lua: transición de estado atómica (compare-and-swap real, no solo
 * "dentro de una transacción") sobre `consumedAt`/`attemptsUsed`/`lockedAt`.
 * La comparación criptográfica del código (HMAC + comparación en tiempo
 * constante) ya se hizo en Node con `verifyOtpCode`/`constantTimeEqual`
 * (packages/contracts/src/otp.ts) antes de invocar este script — Redis
 * Lua no tiene HMAC-SHA-256 nativo, así que reutiliza la primitiva ya
 * probada en vez de reimplementar el hash aquí. Lo que este script
 * garantiza es que, si dos verificaciones concurrentes llegan con el
 * resultado "coincide" a la vez, como mucho una gana la transición a
 * "verified" — la segunda encuentra `consumedAt` ya escrito y no la
 * duplica, sin una condición de carrera entre leer y escribir.
 */
const VERIFY_TRANSITION_SCRIPT = `
local key = KEYS[1]
local matched = ARGV[1]
local now = ARGV[2]

local consumedAt = redis.call('HGET', key, 'consumedAt')
if consumedAt == false then
  return 'missing'
end
if consumedAt ~= '' then
  return 'already_consumed'
end

local lockedAt = redis.call('HGET', key, 'lockedAt')
if lockedAt ~= '' then
  return 'locked'
end

local expiresAt = redis.call('HGET', key, 'expiresAt')
if now >= expiresAt then
  return 'expired'
end

if matched == '1' then
  redis.call('HSET', key, 'consumedAt', now)
  return 'verified'
end

local attemptsUsed = tonumber(redis.call('HGET', key, 'attemptsUsed')) + 1
local maxAttempts = tonumber(redis.call('HGET', key, 'maxAttempts'))
redis.call('HSET', key, 'attemptsUsed', attemptsUsed)

if attemptsUsed >= maxAttempts then
  redis.call('HSET', key, 'lockedAt', now)
  return 'locked'
end

return 'invalid_code:' .. tostring(maxAttempts - attemptsUsed)
`

export async function verifyOtp(
  purpose: OtpPurpose,
  subjectRef: string,
  code: string,
): Promise<OtpVerificationResult> {
  const client = await getRedisClient()

  const challengeId = await client.get(currentPointerKey(purpose, subjectRef))
  if (!challengeId) {
    return { outcome: 'expired' }
  }

  const key = challengeKey(challengeId)
  const record = await client.hGetAll(key)
  if (!record || Object.keys(record).length === 0) {
    return { outcome: 'expired' }
  }

  const storedCodeHash = record['codeHash'] ?? ''
  const providedHash = await hashOtpCode({ challengeId, purpose, subjectRef }, code, serverEnv.OTP_HMAC_SECRET)
  const matched =
    (await verifyOtpCode({ challengeId, purpose, subjectRef }, code, serverEnv.OTP_HMAC_SECRET, storedCodeHash)) &&
    constantTimeEqual(providedHash, storedCodeHash)

  const now = new Date().toISOString()

  const result = (await client.eval(VERIFY_TRANSITION_SCRIPT, {
    keys: [key],
    arguments: [matched ? '1' : '0', now],
  })) as string

  if (result === 'verified') {
    return { outcome: 'verified', challengeId }
  }
  if (result === 'already_consumed') {
    // `matched` ya se calculó arriba, ANTES de invocar el script Lua —
    // dice si el código recién enviado es criptográficamente el correcto
    // para este reto, incluso aunque el reto ya estuviera consumido por un
    // intento anterior. El llamante lo usa para distinguir "reintento
    // legítimo del mismo código correcto" (recuperación posible) de
    // "alguien prueba un código cualquiera contra un reto ya gastado"
    // (nunca debe autorizar nada).
    return { outcome: 'already_consumed', challengeId, codeMatchesConsumedChallenge: matched }
  }
  if (result === 'locked') {
    return { outcome: 'locked' }
  }
  if (result === 'expired' || result === 'missing') {
    return { outcome: 'expired' }
  }
  if (result.startsWith('invalid_code:')) {
    const attemptsRemaining = Number.parseInt(result.split(':')[1] ?? '0', 10)
    return { outcome: 'invalid_code', attemptsRemaining }
  }

  return { outcome: 'expired' }
}

/** Descarta el reto vigente para propósito+sujeto sin esperar a que expire — usado al cancelar un flujo (p. ej. una solicitud de registro abandonada). */
export async function discardOtp(purpose: OtpPurpose, subjectRef: string): Promise<void> {
  const client = await getRedisClient()
  const pointerKey = currentPointerKey(purpose, subjectRef)
  const challengeId = await client.get(pointerKey)
  const multi = client.multi()
  if (challengeId) {
    multi.del(challengeKey(challengeId))
  }
  multi.del(pointerKey)
  await multi.exec()
}
