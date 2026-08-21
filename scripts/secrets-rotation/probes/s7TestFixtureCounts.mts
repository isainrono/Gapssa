// scripts/secrets-rotation/probes/s7TestFixtureCounts.mts — Bloque 10
// (validación dedicada de S7 contra Postgres desechable real).
//
// Sonda de SOLO LECTURA — nunca muta nada — que expone directamente los
// mismos conteos EN FRESCO que probes/s7MigrateAndAudit.mts calcula
// internamente (rotationSafetyChecks.ts/fieldEncryptionRotation.ts/
// emailLookupHmacRotation.ts, funciones de producción reales), para que
// un arnés de pruebas pueda comprobar el estado de la base ENTRE pasos
// de gate_s7() (p. ej. tras una interrupción real) sin tener que
// relanzar la migración (que sí muta) solo para leer un conteo.
//
// SOLO EJECUTABLE CONTRA UN PROYECTO DESECHABLE — misma guarda cerrada
// que s7TestFixtureSeed.mts/s7TestFixtureVerify.mts.
//
// Uso: node --import tsx s7TestFixtureCounts.mts   (versiones por stdin,
// resultado JSON por stdout — solo conteos/booleanos).
//
// stdin: { "versions": ["v1", "v2", ...] }
// stdout: { "aesRemaining": {"v1": N, "v2": N, ...},
//           "emailLookupRemaining": {"v1": N, ...},
//           "fingerprintLive": {"v1": N, ...},
//           "accessTokenLive": {"v1": N, ...} }

import { countLiveBookingRequestsReferencingFingerprintVersions, countLiveBookingRequestsReferencingAccessTokenVersions } from '../../../apps/web/src/server/booking/rotationSafetyChecks'
import { countRowsStillOnVersion } from '../../../apps/web/src/server/booking/fieldEncryptionRotation'
import { countRowsStillOnEmailLookupHmacVersion } from '../../../apps/web/src/server/booking/emailLookupHmacRotation'
import { bookingDb } from '../../../apps/web/src/server/booking/db/client'

const DISPOSABLE_LABEL_PATTERN = /^gapssa-[a-z0-9]+(-[a-z0-9]+)*-(rehearsal|tests?)-[0-9a-f]{6,}$/

function assertDisposableContext(): void {
  const label = process.env.GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL
  if (!label || !DISPOSABLE_LABEL_PATTERN.test(label)) {
    console.error('ERROR: falta o no casa GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL — esta sonda de conteos de prueba NUNCA se ejecuta sin esa guarda.')
    process.exit(1)
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  assertDisposableContext()
  const raw = await readAllStdin()
  const parsed = JSON.parse(raw) as { versions: string[] }
  const versions = parsed.versions

  const aesRemaining: Record<string, number> = {}
  const emailLookupRemaining: Record<string, number> = {}
  for (const v of versions) {
    aesRemaining[v] = await countRowsStillOnVersion(bookingDb, v)
    emailLookupRemaining[v] = await countRowsStillOnEmailLookupHmacVersion(bookingDb, v)
  }
  const fingerprintLive: Record<string, number> = {}
  const accessTokenLive: Record<string, number> = {}
  for (const v of versions) {
    fingerprintLive[v] = await countLiveBookingRequestsReferencingFingerprintVersions(bookingDb, [v])
    accessTokenLive[v] = await countLiveBookingRequestsReferencingAccessTokenVersions(bookingDb, [v])
  }

  console.log(JSON.stringify({ aesRemaining, emailLookupRemaining, fingerprintLive, accessTokenLive }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
