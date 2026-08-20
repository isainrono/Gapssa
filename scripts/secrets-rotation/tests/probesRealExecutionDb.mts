// scripts/secrets-rotation/tests/probesRealExecutionDb.mts
//
// Ciclo de vida de la base de datos EFÍMERA usada por
// probes_real_execution.sh (Bloque 3) para ejecutar de verdad las 4
// sondas de negocio de S6/S7 contra Postgres/Redis DESECHABLES (nunca
// contenedores/bases reales de GAPSSA). Reutiliza exactamente las mismas
// funciones puras que ya usa
// apps/web/tests/integration/rotation/global-setup.disposable.ts
// (runBookingMigrations, assertEphemeralTestDatabaseUrl) — no duplica
// lógica de migración ni de guardas de seguridad.
//
// Uso:
//   node --import tsx probesRealExecutionDb.mts create <adminPgUrl>
//     -> crea gapssa_booking_test_<random>, la migra, imprime SOLO la
//        URL de conexión efímera resultante por stdout (una línea).
//   node --import tsx probesRealExecutionDb.mts drop <adminPgUrl> <databaseName>
//     -> termina conexiones activas y DROP DATABASE de esa base efímera.

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'

import { runBookingMigrations } from '../../../apps/web/src/server/booking/db/migrate'
import { assertEphemeralTestDatabaseUrl } from '../../../apps/web/tests/integration/ephemeralDatabaseGuard'

const APPROVED_PREFIX = 'gapssa_booking_test_'

function generateTestDatabaseName(): string {
  return `${APPROVED_PREFIX}${randomBytes(6).toString('hex')}`
}

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function createAndMigrate(adminUrl: string): Promise<void> {
  const databaseName = generateTestDatabaseName()
  const testDatabaseUrl = withDatabaseName(adminUrl, databaseName)
  assertEphemeralTestDatabaseUrl(testDatabaseUrl)

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
  } finally {
    await admin.end()
  }

  await runBookingMigrations(testDatabaseUrl)

  console.log(JSON.stringify({ databaseName, testDatabaseUrl }))
}

async function drop(adminUrl: string, databaseName: string): Promise<void> {
  if (!databaseName.startsWith(APPROVED_PREFIX)) {
    throw new Error(`CONFIG_ERROR: nombre de base fuera del prefijo aprobado (${APPROVED_PREFIX}) — retirada abortada.`)
  }
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [databaseName])
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  } finally {
    await admin.end()
  }
  console.log(JSON.stringify({ dropped: true }))
}

async function main() {
  const mode = process.argv[2]
  if (mode === 'create') {
    const adminUrl = process.argv[3]
    if (!adminUrl) throw new Error('CONFIG_ERROR: falta <adminPgUrl>.')
    await createAndMigrate(adminUrl)
    return
  }
  if (mode === 'drop') {
    const adminUrl = process.argv[3]
    const databaseName = process.argv[4]
    if (!adminUrl || !databaseName) throw new Error('CONFIG_ERROR: faltan <adminPgUrl> <databaseName>.')
    await drop(adminUrl, databaseName)
    return
  }
  throw new Error('CONFIG_ERROR: modo desconocido (esperado "create" o "drop").')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
