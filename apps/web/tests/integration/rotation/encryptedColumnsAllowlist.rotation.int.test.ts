import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, describe, expect, inject, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const schema = await import('../../../src/server/booking/db/schema')
const { verifyNoUnlistedEncryptedColumns, ENCRYPTED_COLUMNS_ALLOWLIST } = await import('../../../src/server/booking/encryptedColumnsAllowlist')

/**
 * Punto 6 de la tercera revisión: auditoría real contra
 * `information_schema.columns` del Postgres efímero — nunca solo un
 * análisis de nombres sobre `db/schema.ts`. Corre contra las migraciones
 * REALES ya aplicadas por el global-setup desechable.
 */

const pool = new Pool({ connectionString: inject('integrationBookingDatabaseUrl') })
const testDb = drizzle(pool, { schema })

afterAll(async () => {
  await pool.end()
})

describe('verifyNoUnlistedEncryptedColumns', () => {
  it('el esquema REAL (migrado) coincide exactamente con la allowlist cerrada — ni de más ni de menos', async () => {
    const result = await verifyNoUnlistedEncryptedColumns(testDb)
    expect(result.unlisted).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('la allowlist cubre exactamente pending_guest_identities y pending_authenticated_contact_details', () => {
    const tables = ENCRYPTED_COLUMNS_ALLOWLIST.map((e) => e.table).sort()
    expect(tables).toEqual(['pending_authenticated_contact_details', 'pending_guest_identities'])
  })
})
