import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest'

// Mismo motivo que fieldEncryptionRotation.int.test.ts: este fichero
// importa código `server-only` directamente (el módulo de comprobaciones
// de seguridad de rotación), no a través de un endpoint HTTP.
vi.mock('server-only', () => ({}))

const schema = await import('../../../src/server/booking/db/schema')
const {
  assertRotationEnvironmentAllowed,
  countLiveBookingRequests,
  countLiveBookingRequestsReferencingFingerprintVersions,
  countActivePendingGuestIdentities,
} = await import('../../../src/server/booking/rotationSafetyChecks')

/**
 * Ensayo efímero de las comprobaciones de seguridad de la puerta S7
 * (`scripts/secrets-rotation/rotate-all-interactive.sh`) — corre
 * exclusivamente contra `gapssa_booking_test_<random>` (efímera,
 * `global-setup.ts`), nunca contra la base real. Cada prueba comprueba
 * que el conteo objetivo distingue correctamente "vivo" de "resuelto" /
 * "activo" de "purgado", que es exactamente lo que decide si S7 puede
 * sustituir o retirar un secreto sin dejar datos huérfanos.
 */

const pool = new Pool({ connectionString: inject('integrationBookingDatabaseUrl') })
const testDb = drizzle(pool, { schema })

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await testDb.delete(schema.pendingGuestIdentities)
  await testDb.delete(schema.bookingRequestRecords)
})

async function insertBookingRequest(options: { status: (typeof schema.bookingRequestStatusEnum.enumValues)[number]; identityFingerprintKeyVersion: string }) {
  const now = new Date()
  const [row] = await testDb
    .insert(schema.bookingRequestRecords)
    .values({
      treatmentId: 'treatment-fixture',
      professionalId: 'professional-fixture',
      zoneId: 'zone-fixture',
      startAt: now,
      endAt: new Date(now.getTime() + 60 * 60 * 1000),
      verificationExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      idempotencyKey: randomUUID(),
      payloadHash: 'fixture-hash',
      status: options.status,
      identityFingerprintKeyVersion: options.identityFingerprintKeyVersion,
      resolvedAt: options.status === 'resolved' ? now : undefined,
      resolution: options.status === 'resolved' ? 'confirmed' : undefined,
    })
    .returning({ id: schema.bookingRequestRecords.id })
  return row!.id
}

async function insertGuestIdentity(bookingRequestId: string, status: (typeof schema.pendingGuestIdentityStatusEnum.enumValues)[number]) {
  await testDb.insert(schema.pendingGuestIdentities).values({
    bookingRequestId,
    firstNameCiphertext: 'c',
    firstNameNonce: 'n',
    firstNameKeyVersion: 'v1',
    lastNameCiphertext: 'c',
    lastNameNonce: 'n',
    lastNameKeyVersion: 'v1',
    emailCiphertext: 'c',
    emailNonce: 'n',
    emailKeyVersion: 'v1',
    phoneCiphertext: 'c',
    phoneNonce: 'n',
    phoneKeyVersion: 'v1',
    emailLookupHmac: 'fixture-hmac',
    emailLookupHmacKeyVersion: 'v1',
    status,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
}

describe('assertRotationEnvironmentAllowed', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not throw outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ALLOW_PRODUCTION_ROTATION', '')
    expect(() => assertRotationEnvironmentAllowed()).not.toThrow()
  })

  it('throws in production without the explicit override', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_PRODUCTION_ROTATION', '')
    expect(() => assertRotationEnvironmentAllowed()).toThrow(/NODE_ENV=production/)
  })

  it('does not throw in production WITH the exact override value', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_PRODUCTION_ROTATION', 'yes-i-am-sure')
    expect(() => assertRotationEnvironmentAllowed()).not.toThrow()
  })

  it('still throws in production with a near-miss override value', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_PRODUCTION_ROTATION', 'yes')
    expect(() => assertRotationEnvironmentAllowed()).toThrow(/NODE_ENV=production/)
  })
})

describe('countLiveBookingRequests — ensayo efímero', () => {
  it('counts non-resolved requests and excludes resolved ones', async () => {
    await insertBookingRequest({ status: 'pending_verification', identityFingerprintKeyVersion: 'v1' })
    await insertBookingRequest({ status: 'pending_approval', identityFingerprintKeyVersion: 'v1' })
    await insertBookingRequest({ status: 'resolved', identityFingerprintKeyVersion: 'v1' })

    await expect(countLiveBookingRequests(testDb)).resolves.toBe(2)
  })

  it('reports zero when every request is resolved', async () => {
    await insertBookingRequest({ status: 'resolved', identityFingerprintKeyVersion: 'v1' })

    await expect(countLiveBookingRequests(testDb)).resolves.toBe(0)
  })
})

describe('countLiveBookingRequestsReferencingFingerprintVersions — ensayo efímero', () => {
  it('counts only non-resolved rows referencing one of the given versions', async () => {
    await insertBookingRequest({ status: 'pending_verification', identityFingerprintKeyVersion: 'v1' })
    await insertBookingRequest({ status: 'pending_approval', identityFingerprintKeyVersion: 'v2' })
    // No cuenta: versión distinta.
    await insertBookingRequest({ status: 'pending_verification', identityFingerprintKeyVersion: 'v3' })
    // No cuenta: resuelta, aunque referencie v1.
    await insertBookingRequest({ status: 'resolved', identityFingerprintKeyVersion: 'v1' })

    await expect(countLiveBookingRequestsReferencingFingerprintVersions(testDb, ['v1', 'v2'])).resolves.toBe(2)
  })

  it('returns zero for an empty version list without querying', async () => {
    await insertBookingRequest({ status: 'pending_verification', identityFingerprintKeyVersion: 'v1' })

    await expect(countLiveBookingRequestsReferencingFingerprintVersions(testDb, [])).resolves.toBe(0)
  })

  it('is the objective signal that a version is safe to retire (drops to zero once requests resolve)', async () => {
    const id = await insertBookingRequest({ status: 'pending_approval', identityFingerprintKeyVersion: 'v1' })
    await expect(countLiveBookingRequestsReferencingFingerprintVersions(testDb, ['v1'])).resolves.toBe(1)

    await testDb
      .update(schema.bookingRequestRecords)
      .set({ status: 'resolved', resolution: 'confirmed', resolvedAt: new Date() })
      .where(eq(schema.bookingRequestRecords.id, id))

    await expect(countLiveBookingRequestsReferencingFingerprintVersions(testDb, ['v1'])).resolves.toBe(0)
  })
})

describe('countActivePendingGuestIdentities — ensayo efímero', () => {
  it('counts only active identities, never discarded/consumed ones', async () => {
    const liveRequest = await insertBookingRequest({ status: 'pending_verification', identityFingerprintKeyVersion: 'v1' })
    const discardedRequest = await insertBookingRequest({ status: 'resolved', identityFingerprintKeyVersion: 'v1' })
    await insertGuestIdentity(liveRequest, 'active')
    await insertGuestIdentity(discardedRequest, 'discarded')

    await expect(countActivePendingGuestIdentities(testDb)).resolves.toBe(1)
  })

  it('reports zero on an empty table (matches the documented 2026-08-13 state)', async () => {
    await expect(countActivePendingGuestIdentities(testDb)).resolves.toBe(0)
  })
})
