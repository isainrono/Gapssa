import { defineConfig } from 'drizzle-kit'

/**
 * Configuración de drizzle-kit exclusiva de `gapssa_booking` (Fase 4A) —
 * mismo patrón exacto que `drizzle.auth.config.ts` (Fase 3): un archivo de
 * config por base de datos lógica, nunca comparten carpeta de migraciones
 * ni de metadatos.
 *
 * `DATABASE_URL_BOOKING` viene de `.env` (raíz del monorepo, cargado por
 * `dotenv-cli` en los scripts `booking:db:*` de `package.json`).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/booking/db/schema.ts',
  out: './drizzle/booking/migrations',
  dbCredentials: {
    url: requireEnv('DATABASE_URL_BOOKING'),
  },
  strict: true,
  verbose: true,
})

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} no está definida. Ejecuta los comandos "booking:db:*" desde la raíz del monorepo (dotenv-cli carga .env), o exporta la variable manualmente.`,
    )
  }
  return value
}
