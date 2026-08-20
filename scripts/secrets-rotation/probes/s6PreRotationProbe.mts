// scripts/secrets-rotation/probes/s6PreRotationProbe.mts
//
// Sustituye al heredoc `ts_pre` que antes generaba
// rotate-all-interactive.sh::gate_s6() en tiempo de ejecución dentro de
// apps/web/. Crea, ANTES de rotar, un reto OTP real, un golpe de
// rate-limit real, y firma un JWT con el PAYLOAD_SECRET actual — la
// misma prueba de un solo sentido de siempre — pero ahora escribe el
// artefacto reanudable directamente en disco desde este proceso
// (probes/shared/secureArtifact.mts), en vez de imprimirlo por stdout
// para que bash lo capture y lo escriba él mismo.
//
// Contrato de stdout (ver lib/validateProbeJson.mjs, schema "s6-pre"):
// exclusivamente `{ prepared, artifactCreated, artifactSchemaVersion }`
// — ningún identificador de sujeto, código OTP, JWT ni fragmento
// derivado de un secreto sale nunca de este proceso por stdout ni argv.
//
// Uso: s6PreRotationProbe.mts <artifactPath> <allowedArtifactDir>
// (ambos son rutas, nunca secretos).

import { randomUUID } from 'node:crypto'

import { requestOtp } from '../../../apps/web/src/server/auth/otpService'
import { consumeRateLimit } from '../../../apps/web/src/server/auth/rateLimit'
import { serverEnv } from '../../../apps/web/src/server/env'
import { signHs256 } from './shared/hs256.mts'
import { writeArtifactExclusive } from './shared/secureArtifact.mts'

const ARTIFACT_SCHEMA_VERSION = 1

async function main() {
  const artifactPath = process.argv[2]
  const allowedDir = process.argv[3]
  if (!artifactPath || !allowedDir) {
    throw new Error('CONFIG_ERROR: faltan argumentos (artifactPath, allowedArtifactDir).')
  }

  const subjectRef = `s6-rotation-probe:${randomUUID()}`
  const otpResult = await requestOtp('passwordless_login', subjectRef)
  if (otpResult.outcome !== 'issued') {
    throw new Error('MIGRATION_ERROR: no se pudo emitir el reto OTP de prueba (posiblemente límite de frecuencia real ya consumido).')
  }

  await consumeRateLimit(`s6-rotation-probe:${randomUUID()}`, 3, 3600)

  const payloadJwt = signHs256({ sub: 's6-rotation-probe', iat: Math.floor(Date.now() / 1000) }, serverEnv.PAYLOAD_SECRET)

  writeArtifactExclusive(artifactPath, allowedDir, ARTIFACT_SCHEMA_VERSION, {
    subjectRef,
    code: otpResult.code,
    payloadJwt,
  })

  console.log(JSON.stringify({ prepared: true, artifactCreated: true, artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
