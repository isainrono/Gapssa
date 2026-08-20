import 'server-only'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { serverEnv } from '../../env'
import * as schema from './schema'

/**
 * Cliente Drizzle exclusivo de `gapssa_booking` — nunca comparte pool con
 * `gapssa_cms` (Payload) ni con `gapssa_auth` (server/auth/db/client.ts).
 * Mismo patrón: un único Pool cacheado por Node entre peticiones.
 */
let pool: null | Pool = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: serverEnv.DATABASE_URL_BOOKING })
  }
  return pool
}

export const bookingDb = drizzle(getPool(), { schema })

export type BookingDb = typeof bookingDb

/**
 * Transacción Drizzle activa de `gapssa_booking` — mismo propósito que
 * `AuthTx` (server/auth/db/client.ts): permite que módulos como
 * `audit.ts`/`espoAdapter.ts` acepten "el cliente de nivel superior, o una
 * transacción ya abierta por el llamante" sin duplicar la firma de Drizzle.
 */
export type BookingTx = Parameters<Parameters<BookingDb['transaction']>[0]>[0]

export type BookingDbClient = BookingDb | BookingTx
