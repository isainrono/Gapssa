import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

/**
 * Ejecutor programático de migraciones de `gapssa_booking` — mismo patrón
 * exacto que `server/auth/db/migrate.ts` (Fase 3). Se invoca:
 *
 * - Como script: `npm run booking:db:migrate -w @gapssa/web` (usa
 *   `DATABASE_URL_BOOKING` de `.env`, cargado por `dotenv-cli`).
 * - Programáticamente desde `tests/integration/global-setup.ts`: aplica
 *   las migraciones sobre una base `gapssa_booking_test_<random>` efímera
 *   antes de arrancar el servidor de pruebas, nunca sobre `gapssa_booking`
 *   real.
 */
export async function runBookingMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    const db = drizzle(pool)
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await pool.end()
  }
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../../drizzle/booking/migrations', import.meta.url))

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_BOOKING
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_BOOKING no está definida. Ejecuta "npm run booking:db:migrate -w @gapssa/web" desde la raíz del monorepo.',
    )
  }
  await runBookingMigrations(connectionString)

  console.log('gapssa_booking: migraciones aplicadas.')
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('gapssa_booking: fallo al aplicar migraciones.', error)
    process.exitCode = 1
  })
}
