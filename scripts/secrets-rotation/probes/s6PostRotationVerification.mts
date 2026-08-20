// scripts/secrets-rotation/probes/s6PostRotationVerification.mts
//
// Sustituye al heredoc `ts_post` que antes generaba
// rotate-all-interactive.sh::run_s6_dynamic_verification() (invocada
// SOLO desde gate_s9(), una vez que los tres secretos ya están rotados y
// Redis es el real). Llama directamente a las mismas funciones de
// producción (otpService.ts/rateLimit.ts) contra Redis real, más una
// comprobación JWT pura en memoria para PAYLOAD_SECRET — nunca HTTP,
// nunca un secreto persistido, nunca impreso.
//
// Lee el artefacto de S6 con `readArtifactStrict` (nunca
// `readFileSync`+`JSON.parse` a pelo) — los valores reales solo se usan
// internamente, jamás se exponen por stdout de esta sonda.
//
// Contrato de stdout (schema "s6-post"): exclusivamente los 5 booleanos
// ya existentes — sin cambios de contrato respecto al heredoc original.
//
// Uso: s6PostRotationVerification.mts <artifactPath> <allowedArtifactDir>

import { randomUUID } from 'node:crypto'

import { requestOtp, verifyOtp } from '../../../apps/web/src/server/auth/otpService'
import { consumeRateLimit } from '../../../apps/web/src/server/auth/rateLimit'
import { serverEnv } from '../../../apps/web/src/server/env'
import { getRedisClient, withKeyPrefix } from '../../../apps/web/src/server/redis'
import { signHs256, verifyHs256 } from './shared/hs256.mts'
import { readArtifactStrict } from './shared/secureArtifact.mts'

const ARTIFACT_SCHEMA_VERSION = 1
const ARTIFACT_KEYS = ['subjectRef', 'code', 'payloadJwt'] as const

interface Probe {
  subjectRef: string
  code: string
  payloadJwt: string
}

function asProbe(record: Record<string, unknown>): Probe {
  const { subjectRef, code, payloadJwt } = record
  if (typeof subjectRef !== 'string' || typeof code !== 'string' || typeof payloadJwt !== 'string') {
    throw new Error('DATA_ERROR: campos del artefacto con tipo inesperado.')
  }
  return { subjectRef, code, payloadJwt }
}

async function main() {
  const artifactPath = process.argv[2]
  const allowedDir = process.argv[3]
  if (!artifactPath || !allowedDir) {
    throw new Error('CONFIG_ERROR: faltan argumentos (artifactPath, allowedArtifactDir).')
  }

  const probe = asProbe(readArtifactStrict(artifactPath, allowedDir, ARTIFACT_SCHEMA_VERSION, ARTIFACT_KEYS))

  // 1. El reto OTP creado ANTES de rotar debe fallar ahora (HMAC
  // guardado con el secreto viejo; verifyOtp recalcula con el nuevo).
  const oldResult = await verifyOtp('passwordless_login', probe.subjectRef, probe.code)
  const otpOldInvalidated = oldResult.outcome !== 'verified'

  // Limpieza activa del reto viejo en Redis — nunca depender solo del
  // TTL si se puede borrar ya.
  const client = await getRedisClient()
  await client.del(withKeyPrefix(`otp:current:passwordless_login:${probe.subjectRef}`))

  // 2. Un reto OTP NUEVO, creado y verificado con el secreto activo
  // actual, debe funcionar end-to-end.
  const newSubjectRef = `s6-rotation-probe-new:${randomUUID()}`
  const issued = await requestOtp('passwordless_login', newSubjectRef)
  let otpNewWorks = false
  if (issued.outcome === 'issued') {
    const verified = await verifyOtp('passwordless_login', newSubjectRef, issued.code)
    otpNewWorks = verified.outcome === 'verified'
    await client.del(withKeyPrefix(`otp:current:passwordless_login:${newSubjectRef}`))
  }

  // 3. Rate-limit: un identificador sintético NUEVO debe arrancar en 1
  // (no arrastra ningún contador previo).
  const rl = await consumeRateLimit(`s6-rotation-probe-new:${randomUUID()}`, 3, 3600)
  const rateLimitFreshCounterOk = rl.remaining === 2

  // 4. JWT de Payload: el firmado ANTES de rotar debe dejar de
  // verificar contra el PAYLOAD_SECRET nuevo; uno firmado ahora debe
  // verificar.
  const payloadOldInvalidated = !verifyHs256(probe.payloadJwt, serverEnv.PAYLOAD_SECRET)
  const newJwt = signHs256({ sub: 's6-rotation-probe-new' }, serverEnv.PAYLOAD_SECRET)
  const payloadNewWorks = verifyHs256(newJwt, serverEnv.PAYLOAD_SECRET)

  console.log(
    JSON.stringify({
      otpOldInvalidated,
      otpNewWorks,
      rateLimitFreshCounterOk,
      payloadOldInvalidated,
      payloadNewWorks,
    }),
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
