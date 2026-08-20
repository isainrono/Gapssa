import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { requestOtp, verifyOtp } = await import('../../../src/server/auth/otpService')
const { consumeRateLimit } = await import('../../../src/server/auth/rateLimit')
const { getRedisClient } = await import('../../../src/server/redis')

/**
 * Punto 12 de la tercera revisión: qué valida REDIS de verdad en esta
 * suite — únicamente OTP y rate-limit (los dos únicos secretos de S6 que
 * tienen estado real en Redis). Ningún otro fichero de esta suite toca
 * Redis. Corre contra el Redis DESECHABLE
 * (`scripts/secrets-rotation/tests/disposable-infra.sh`), nunca el Redis
 * real de GAPSSA.
 *
 * Esto valida el MISMO camino real que
 * `rotate-all-interactive.sh::run_s6_dynamic_verification` ejercita en
 * S9 (reto real, verificación real, límite de frecuencia real) — la
 * propiedad "un HMAC calculado con un secreto ya no coincide si el
 * secreto cambia" es una propiedad criptográfica básica de
 * `packages/contracts/src/otp.ts` (HMAC-SHA-256), no algo que necesite
 * Redis para demostrarse por separado.
 *
 * BLOQUE 3: la lógica que antes generaba `run_s6_dynamic_verification`
 * mediante un heredoc TypeScript dentro de `apps/web/` en tiempo de
 * ejecución ahora vive en el fichero permanente
 * `scripts/secrets-rotation/probes/s6PostRotationVerification.mts`
 * (invocado por `run_s6_dynamic_verification` vía `run-tsx.mjs`) — mismas
 * llamadas a `otpService.ts`/`rateLimit.ts`, solo reubicadas.
 */

afterAll(async () => {
  const client = await getRedisClient()
  await client.quit()
})

describe('OTP real contra Redis desechable', () => {
  it('un reto emitido se verifica con éxito con el código correcto', async () => {
    const subjectRef = `s6-test-${randomUUID()}`
    const issued = await requestOtp('passwordless_login', subjectRef)
    expect(issued.outcome).toBe('issued')
    if (issued.outcome !== 'issued') return

    const result = await verifyOtp('passwordless_login', subjectRef, issued.code)
    expect(result.outcome).toBe('verified')
  })

  it('un código incorrecto se rechaza, nunca verifica', async () => {
    const subjectRef = `s6-test-${randomUUID()}`
    await requestOtp('passwordless_login', subjectRef)
    const result = await verifyOtp('passwordless_login', subjectRef, '000000')
    expect(result.outcome).not.toBe('verified')
  })

  it('dos retos consecutivos para el mismo sujeto invalidan el anterior — nunca dos códigos vivos a la vez', async () => {
    const subjectRef = `s6-test-${randomUUID()}`
    const first = await requestOtp('passwordless_login', subjectRef)
    const second = await requestOtp('passwordless_login', subjectRef)
    expect(first.outcome).toBe('issued')
    expect(second.outcome).toBe('issued')
    if (first.outcome !== 'issued') return

    const oldResult = await verifyOtp('passwordless_login', subjectRef, first.code)
    expect(oldResult.outcome).not.toBe('verified')
  })
})

describe('rate-limit real contra Redis desechable', () => {
  it('un identificador sintético nuevo arranca en el máximo menos uno tras el primer golpe', async () => {
    const key = `s6-test-rl-${randomUUID()}`
    const result = await consumeRateLimit(key, 3, 60)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('el límite se agota tras el número exacto de golpes configurado', async () => {
    const key = `s6-test-rl-${randomUUID()}`
    await consumeRateLimit(key, 2, 60)
    await consumeRateLimit(key, 2, 60)
    const third = await consumeRateLimit(key, 2, 60)
    expect(third.allowed).toBe(false)
  })

  it('identificadores distintos nunca comparten contador', async () => {
    const keyA = `s6-test-rl-${randomUUID()}`
    const keyB = `s6-test-rl-${randomUUID()}`
    await consumeRateLimit(keyA, 1, 60)
    const resultB = await consumeRateLimit(keyB, 1, 60)
    expect(resultB.allowed).toBe(true)
  })
})
