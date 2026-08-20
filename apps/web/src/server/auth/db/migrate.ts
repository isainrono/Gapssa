import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

/**
 * Ejecutor programático de migraciones de `gapssa_auth`, independiente de
 * `next dev`/`payload migrate` (que solo gestionan `gapssa_cms`). Se
 * invoca:
 *
 * - Como script: `npm run auth:db:migrate -w @gapssa/web` (usa
 *   `DATABASE_URL_AUTH` de `.env`, cargado por `dotenv-cli` desde la raíz).
 * - Programáticamente desde `tests/integration/global-setup.ts` (Fase 3):
 *   aplica las migraciones sobre una base `gapssa_auth_test_<random>`
 *   efímera antes de arrancar el servidor de pruebas, nunca sobre
 *   `gapssa_auth` real.
 *
 * `drizzle-orm` registra las migraciones ya aplicadas en su propia tabla
 * de control (`drizzle.__drizzle_migrations` por defecto) dentro de la
 * misma base de datos — volver a ejecutar este script sobre una base ya
 * migrada es un no-op idempotente, verificado en
 * `tests/integration/authMigrations.int.test.ts`.
 */
export async function runAuthMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    const db = drizzle(pool)
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await pool.end()
  }
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../../drizzle/auth/migrations', import.meta.url))

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_AUTH
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_AUTH no está definida. Ejecuta "npm run auth:db:migrate -w @gapssa/web" desde la raíz del monorepo.',
    )
  }
  await runAuthMigrations(connectionString)

  console.log('gapssa_auth: migraciones aplicadas.')
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('gapssa_auth: fallo al aplicar migraciones.', error)
    process.exitCode = 1
  })
}
