import 'server-only'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { serverEnv } from '../../env'
import * as schema from './schema'

/**
 * Cliente Drizzle exclusivo de `gapssa_auth` — nunca comparte pool con
 * Payload (`gapssa_cms`, gestionado internamente por
 * `@payloadcms/db-postgres`) ni con el futuro BFF de reservas
 * (`gapssa_booking`, Fase 4). Cada base de datos lógica tiene su propia
 * conexión, igual que exige la separación de `infra/postgres/README.md`.
 *
 * Módulo cacheado por Node entre peticiones (mismo patrón que
 * `server/redis.ts`): un único Pool reutilizado, no una conexión nueva por
 * petición.
 */
let pool: null | Pool = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: serverEnv.DATABASE_URL_AUTH })
  }
  return pool
}

export const authDb = drizzle(getPool(), { schema })

export type AuthDb = typeof authDb

/**
 * Transacción Drizzle activa de `gapssa_auth` — el tipo exacto del `tx` que
 * recibe el callback de `authDb.transaction(async (tx) => ...)`. Exportado
 * para que módulos como `audit.ts`/`outbox.ts` puedan aceptar "o bien el
 * cliente de nivel superior, o bien una transacción ya abierta por el
 * llamante" sin duplicar la firma de Drizzle a mano.
 */
export type AuthTx = Parameters<Parameters<AuthDb['transaction']>[0]>[0]

/** `authDb` o una `AuthTx` activa — ambos exponen `select`/`insert`/`update`/`delete`. */
export type AuthDbClient = AuthDb | AuthTx
