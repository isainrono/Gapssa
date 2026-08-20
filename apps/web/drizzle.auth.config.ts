import { defineConfig } from 'drizzle-kit'

/**
 * Configuración de drizzle-kit exclusiva de `gapssa_auth` (Fase 3). Un
 * archivo de config por base de datos lógica — la futura `gapssa_booking`
 * (Fase 4) tendrá el suyo, `drizzle.booking.config.ts`, nunca comparten
 * carpeta de migraciones ni de metadatos. No se usa un `drizzle.config.ts`
 * genérico a propósito: forzaría un solo esquema/una sola URL de conexión,
 * incompatible con tener varias bases lógicas en el mismo servidor
 * Postgres (`infra/postgres/README.md`).
 *
 * `DATABASE_URL_AUTH` viene de `.env` (raíz del monorepo, cargado por
 * `dotenv-cli` en los scripts `auth:db:*` de `package.json`) — nunca un
 * valor por defecto embebido aquí.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/auth/db/schema.ts',
  out: './drizzle/auth/migrations',
  dbCredentials: {
    url: requireEnv('DATABASE_URL_AUTH'),
  },
  strict: true,
  verbose: true,
})

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} no está definida. Ejecuta los comandos "auth:db:*" desde la raíz del monorepo (dotenv-cli carga .env), o exporta la variable manualmente.`,
    )
  }
  return value
}
