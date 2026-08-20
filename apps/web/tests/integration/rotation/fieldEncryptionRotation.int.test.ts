import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'

// Mismo motivo que booking.simulatedEspoAdapter.contract.int.test.ts: este
// fichero importa código `server-only` directamente (el módulo de rotación
// y `fieldCrypto`), no a través de un endpoint HTTP.
vi.mock('server-only', () => ({}))

const schema = await import('../../../src/server/booking/db/schema')
const { encryptFieldWithVersion, decryptField, FieldCryptoError } = await import('../../../src/server/crypto/fieldCrypto')
const {
  rotatePendingGuestIdentities,
  rotatePendingAuthenticatedContactDetails,
  countRowsStillOnVersion,
} = await import('../../../src/server/booking/fieldEncryptionRotation')

/**
 * Ensayo efímero de la rotación versionada de `BOOKING_FIELD_ENCRYPTION_KEYS`
 * (incidente de secretos locales, 2026-08-13) — corre exclusivamente contra
 * `gapssa_booking_test_<random>` (efímera, `global-setup.ts`), nunca contra
 * la base real. Requiere que `BOOKING_FIELD_ENCRYPTION_KEYS` tenga
 * registradas AMBAS versiones usadas aquí ("v1" y "v2") en el `.env` real
 * que carga `vitest.setup.ts` — si "v2" todavía no existe, este archivo
 * falla con un error claro de `fieldCrypto`, nunca en silencio.
 */

const pool = new Pool({ connectionString: inject('integrationBookingDatabaseUrl') })
const testDb = drizzle(pool, { schema })

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await testDb.delete(schema.pendingAuthenticatedContactDetails)
  await testDb.delete(schema.pendingGuestIdentities)
  await testDb.delete(schema.bookingRequestRecords)
})

async function insertParentBookingRequest(): Promise<string> {
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
      identityFingerprintKeyVersion: 'v1',
    })
    .returning({ id: schema.bookingRequestRecords.id })
  return row!.id
}

async function insertGuestIdentityEncryptedWithV1(bookingRequestId: string) {
  const firstName = encryptFieldWithVersion('Prueba', 'v1')
  const lastName = encryptFieldWithVersion('Rotación', 'v1')
  const email = encryptFieldWithVersion('fixture-rotation@example.test', 'v1')
  const phone = encryptFieldWithVersion('+34600000000', 'v1')

  await testDb.insert(schema.pendingGuestIdentities).values({
    bookingRequestId,
    firstNameCiphertext: firstName.ciphertext,
    firstNameNonce: firstName.nonce,
    firstNameKeyVersion: firstName.keyVersion,
    lastNameCiphertext: lastName.ciphertext,
    lastNameNonce: lastName.nonce,
    lastNameKeyVersion: lastName.keyVersion,
    emailCiphertext: email.ciphertext,
    emailNonce: email.nonce,
    emailKeyVersion: email.keyVersion,
    phoneCiphertext: phone.ciphertext,
    phoneNonce: phone.nonce,
    phoneKeyVersion: phone.keyVersion,
    emailLookupHmac: 'fixture-hmac',
    emailLookupHmacKeyVersion: 'v1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
}

async function insertAuthenticatedContactEncryptedWithV1(bookingRequestId: string) {
  const firstName = encryptFieldWithVersion('Prueba', 'v1')
  const lastName = encryptFieldWithVersion('Autenticada', 'v1')
  const phone = encryptFieldWithVersion('+34600000001', 'v1')

  await testDb.insert(schema.pendingAuthenticatedContactDetails).values({
    bookingRequestId,
    firstNameCiphertext: firstName.ciphertext,
    firstNameNonce: firstName.nonce,
    firstNameKeyVersion: firstName.keyVersion,
    lastNameCiphertext: lastName.ciphertext,
    lastNameNonce: lastName.nonce,
    lastNameKeyVersion: lastName.keyVersion,
    phoneCiphertext: phone.ciphertext,
    phoneNonce: phone.nonce,
    phoneKeyVersion: phone.keyVersion,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
}

describe('fieldEncryptionRotation — ensayo efímero (rotación v1 -> v2)', () => {
  it('re-encrypts every field of a v1 guest identity row to v2, preserving the plaintext', async () => {
    const bookingRequestId = await insertParentBookingRequest()
    await insertGuestIdentityEncryptedWithV1(bookingRequestId)

    const result = await rotatePendingGuestIdentities(testDb, { fromVersion: 'v1', toVersion: 'v2', dryRun: false })
    expect(result.rowsScanned).toBe(1)
    expect(result.rowsMigrated).toBe(1)
    expect(result.fieldsMigrated).toBe(4)

    const [row] = await testDb
      .select()
      .from(schema.pendingGuestIdentities)
      .where(eq(schema.pendingGuestIdentities.bookingRequestId, bookingRequestId))

    expect(row!.firstNameKeyVersion).toBe('v2')
    expect(row!.lastNameKeyVersion).toBe('v2')
    expect(row!.emailKeyVersion).toBe('v2')
    expect(row!.phoneKeyVersion).toBe('v2')

    expect(decryptField({ ciphertext: row!.firstNameCiphertext, nonce: row!.firstNameNonce, keyVersion: row!.firstNameKeyVersion })).toBe('Prueba')
    expect(decryptField({ ciphertext: row!.emailCiphertext, nonce: row!.emailNonce, keyVersion: row!.emailKeyVersion })).toBe(
      'fixture-rotation@example.test',
    )
  })

  it('is idempotent: re-running after a full migration changes nothing', async () => {
    const bookingRequestId = await insertParentBookingRequest()
    await insertGuestIdentityEncryptedWithV1(bookingRequestId)

    await rotatePendingGuestIdentities(testDb, { fromVersion: 'v1', toVersion: 'v2', dryRun: false })
    const second = await rotatePendingGuestIdentities(testDb, { fromVersion: 'v1', toVersion: 'v2', dryRun: false })

    expect(second.rowsScanned).toBe(0)
    expect(second.rowsMigrated).toBe(0)
  })

  it('resumes correctly when a row was already partially migrated (simulated interruption)', async () => {
    const bookingRequestId = await insertParentBookingRequest()
    await insertGuestIdentityEncryptedWithV1(bookingRequestId)

    // Simula una interrupción a mitad de fila: solo firstName/lastName ya
    // están en v2, email/phone siguen en v1 — el propio flujo de reservas
    // nunca deja una fila así, pero un fallo de proceso a mitad de la
    // migración sí podría.
    const [before] = await testDb.select().from(schema.pendingGuestIdentities)
    const newFirstName = encryptFieldWithVersion(
      decryptField({ ciphertext: before!.firstNameCiphertext, nonce: before!.firstNameNonce, keyVersion: before!.firstNameKeyVersion }),
      'v2',
    )
    await testDb
      .update(schema.pendingGuestIdentities)
      .set({ firstNameCiphertext: newFirstName.ciphertext, firstNameNonce: newFirstName.nonce, firstNameKeyVersion: 'v2' })
      .where(eq(schema.pendingGuestIdentities.bookingRequestId, bookingRequestId))

    const result = await rotatePendingGuestIdentities(testDb, { fromVersion: 'v1', toVersion: 'v2', dryRun: false })
    expect(result.rowsMigrated).toBe(1)
    expect(result.fieldsMigrated).toBe(3) // lastName, email, phone — firstName ya estaba en v2

    const [row] = await testDb.select().from(schema.pendingGuestIdentities)
    expect(row!.firstNameKeyVersion).toBe('v2')
    expect(row!.lastNameKeyVersion).toBe('v2')
    expect(row!.emailKeyVersion).toBe('v2')
    expect(row!.phoneKeyVersion).toBe('v2')
  })

  it('dry-run never persists any change', async () => {
    const bookingRequestId = await insertParentBookingRequest()
    await insertGuestIdentityEncryptedWithV1(bookingRequestId)

    const result = await rotatePendingGuestIdentities(testDb, { fromVersion: 'v1', toVersion: 'v2', dryRun: true })
    expect(result.rowsScanned).toBe(1)
    expect(result.rowsMigrated).toBe(1)

    const [row] = await testDb
      .select()
      .from(schema.pendingGuestIdentities)
      .where(eq(schema.pendingGuestIdentities.bookingRequestId, bookingRequestId))
    expect(row!.firstNameKeyVersion).toBe('v1')
  })

  it('migrates pending_authenticated_contact_details the same way', async () => {
    const bookingRequestId = await insertParentBookingRequest()
    await insertAuthenticatedContactEncryptedWithV1(bookingRequestId)

    const result = await rotatePendingAuthenticatedContactDetails(testDb, { fromVersion: 'v1', toVersion: 'v2', dryRun: false })
    expect(result.rowsMigrated).toBe(1)
    expect(result.fieldsMigrated).toBe(3)

    const [row] = await testDb
      .select()
      .from(schema.pendingAuthenticatedContactDetails)
      .where(eq(schema.pendingAuthenticatedContactDetails.bookingRequestId, bookingRequestId))
    expect(decryptField({ ciphertext: row!.phoneCiphertext, nonce: row!.phoneNonce, keyVersion: row!.phoneKeyVersion })).toBe('+34600000001')
  })

  it('countRowsStillOnVersion reflects zero once every row has been migrated', async () => {
    const bookingRequestId = await insertParentBookingRequest()
    await insertGuestIdentityEncryptedWithV1(bookingRequestId)

    expect(await countRowsStillOnVersion(testDb, 'v1')).toBe(1)
    await rotatePendingGuestIdentities(testDb, { fromVersion: 'v1', toVersion: 'v2', dryRun: false })
    expect(await countRowsStillOnVersion(testDb, 'v1')).toBe(0)
  })

  it('a row already fully on the target version is left untouched (rowsAlreadyOnTarget)', async () => {
    const bookingRequestId = await insertParentBookingRequest()
    await insertGuestIdentityEncryptedWithV1(bookingRequestId)
    await rotatePendingGuestIdentities(testDb, { fromVersion: 'v1', toVersion: 'v2', dryRun: false })

    // Segunda pasada — no debería encontrar nada en v1 (ya cubierto por el
    // test de idempotencia), pero además confirma que un intento de migrar
    // hacia una versión DISTINTA sobre filas ya en v2 tampoco las mueve:
    // fromVersion='v1' sigue sin coincidir con nada.
    const result = await rotatePendingGuestIdentities(testDb, { fromVersion: 'v1', toVersion: 'v3-unused', dryRun: false })
    expect(result.rowsScanned).toBe(0)
    void bookingRequestId
  })

  it('raises FieldCryptoError, never a silent success, if a row references an unregistered key version', async () => {
    const bookingRequestId = await insertParentBookingRequest()
    await insertGuestIdentityEncryptedWithV1(bookingRequestId)
    await testDb
      .update(schema.pendingGuestIdentities)
      .set({ firstNameKeyVersion: 'v999-never-registered' })
      .where(eq(schema.pendingGuestIdentities.bookingRequestId, bookingRequestId))

    await expect(rotatePendingGuestIdentities(testDb, { fromVersion: 'v999-never-registered', toVersion: 'v2', dryRun: false })).rejects.toThrow(
      FieldCryptoError,
    )

    // La transacción de la fila falló entera — ningún campo de esa fila quedó
    // migrado a medias por este intento.
    const [row] = await testDb.select().from(schema.pendingGuestIdentities)
    expect(row!.lastNameKeyVersion).toBe('v1')
  })
})
