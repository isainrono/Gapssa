import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'

import { runBookingMigrations } from '../../../src/server/booking/db/migrate'
import { assertEphemeralTestDatabaseUrl } from '../ephemeralDatabaseGuard'

/**
 * Global-setup EXCLUSIVO de la suite de rotación
 * (`tests/integration/rotation/**`, `vitest.rotation-integration.config.ts`).
 *
 * A propósito NO importa nada de `tests/integration/global-setup.ts` (el
 * normal) — ese arranca un `next dev` real y depende de que
 * `docker compose up -d apps-db redis` ya esté levantado (contenedores
 * REALES de GAPSSA). Este global-setup depende exclusivamente de la
 * infraestructura Docker DESECHABLE de
 * `scripts/secrets-rotation/tests/disposable-infra.sh` — recibe las URLs
 * de conexión vía las variables de entorno
 * `GAPSSA_ROTATION_V3_PG_URL`/`GAPSSA_ROTATION_V3_REDIS_URL` (escritas por
 * `disposable-infra.sh env`, nunca leídas de `.env`), crea su PROPIA base
 * `gapssa_booking_test_<random>` (reutiliza solo la función PURA
 * `runBookingMigrations`, que no depende de Docker/`.env`), la migra, y
 * la destruye al terminar — igual de aislado que el global-setup normal,
 * pero sin ninguna de sus dependencias de infraestructura real.
 */

const APPROVED_PREFIX = 'gapssa_booking_test_'

function generateTestDatabaseName(): string {
  return `${APPROVED_PREFIX}${randomBytes(6).toString('hex')}`
}

async function createDatabase(adminConnectionString: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString: adminConnectionString })
  await client.connect()
  try {
    // CREATE DATABASE no admite parámetros bindeados — el nombre siempre
    // viene de generateTestDatabaseName() (nunca de una entrada externa),
    // mismo principio que tests/integration/global-setup.ts.
    await client.query(`CREATE DATABASE "${databaseName}"`)
  } finally {
    await client.end()
  }
}

async function dropDatabase(adminConnectionString: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString: adminConnectionString })
  await client.connect()
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    )
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  } finally {
    await client.end()
  }
}

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

/**
 * Denylist explícita de los puertos REALES mapeados en `compose.yml`
 * (`POSTGRES_HOST_PORT=5433`, `REDIS_HOST_PORT=6380`) — defensa en
 * profundidad además del sufijo `_test_<random>` que ya exige
 * `assertEphemeralTestDatabaseUrl`: si la URL desechable resolviera, por
 * cualquier fallo de la infra desechable, al mismo puerto que el stack
 * real, esto aborta en vez de continuar.
 */
const REAL_COMPOSE_PORTS = new Set([5433, 6380])

function assertNeverRealComposePort(connectionString: string, label: string): void {
  const url = new URL(connectionString)
  const port = Number.parseInt(url.port, 10)
  if (REAL_COMPOSE_PORTS.has(port)) {
    throw new Error(
      `Guardia de infra desechable: ${label} resuelve al puerto ${port}, que coincide con un puerto REAL de compose.yml — abortado antes de tocar nada.`,
    )
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const pgAdminUrl = process.env.GAPSSA_ROTATION_V3_PG_URL
  const redisUrl = process.env.GAPSSA_ROTATION_V3_REDIS_URL
  if (!pgAdminUrl) {
    throw new Error(
      'Falta GAPSSA_ROTATION_V3_PG_URL — ejecuta scripts/secrets-rotation/tests/disposable-infra.sh (up + env) antes de "npm run test:rotation-integration".',
    )
  }
  assertNeverRealComposePort(pgAdminUrl, 'GAPSSA_ROTATION_V3_PG_URL')
  if (redisUrl) {
    assertNeverRealComposePort(redisUrl, 'GAPSSA_ROTATION_V3_REDIS_URL')
  }

  const testDatabaseName = generateTestDatabaseName()
  const testDatabaseUrl = withDatabaseName(pgAdminUrl, testDatabaseName)
  assertEphemeralTestDatabaseUrl(testDatabaseUrl)

  await createDatabase(pgAdminUrl, testDatabaseName)
  await runBookingMigrations(testDatabaseUrl)

  project.provide('integrationBookingDatabaseUrl', testDatabaseUrl)
  if (redisUrl) {
    project.provide('integrationRotationRedisUrl', redisUrl)
  }

  return async () => {
    await dropDatabase(pgAdminUrl, testDatabaseName)
  }
}
