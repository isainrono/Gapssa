import { randomUUID } from 'node:crypto'

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// `global-setup.ts` crea una base `gapssa_booking_test_<random>` efímera y
// SOLO la inyecta en el `env` del `next dev` hijo que arranca para el
// resto de la suite (ver spawn() ahí) — el propio proceso worker de
// Vitest que ejecuta este archivo sigue viendo el `DATABASE_URL_BOOKING`
// original (de arranque, apuntando a la base admin, sin tablas). Esto no
// afecta a la mayoría de la suite porque los demás tests hablan con la
// app real por HTTP (que sí tiene el swap), pero este archivo importa y
// llama directamente a `repository.ts::countActivePendingRequestsByEmailHmacCandidates`,
// que usa el singleton `bookingDb` (`server/booking/db/client.ts`) —
// construido una sola vez, en el primer import, a partir de
// `serverEnv.DATABASE_URL_BOOKING`. Hay que fijar la variable de entorno
// con la URL efímera ANTES de cualquier import que arrastre `server/env.ts`,
// para que ese singleton capture la base correcta. Sin fallback: si
// `inject()` no devuelve nada, `DATABASE_URL_BOOKING` queda tal cual (o
// vacío) y `parseServerEnv` falla cerrado con un mensaje claro, igual que
// para cualquier otra variable ausente.
process.env.DATABASE_URL_BOOKING = inject('integrationBookingDatabaseUrl')

const schema = await import('../../../src/server/booking/db/schema')
const { encryptFieldWithVersion, FieldCryptoError } = await import('../../../src/server/crypto/fieldCrypto')
const { rotateEmailLookupHmac, countRowsStillOnEmailLookupHmacVersion } = await import('../../../src/server/booking/emailLookupHmacRotation')
const { countActivePendingRequestsByEmailHmacCandidates } = await import('../../../src/server/booking/repository')
const { hmacSubjectId } = await import('@gapssa/contracts')
const { serverEnv } = await import('../../../src/server/env')

/**
 * Punto 5 de la tercera revisión: reindexado de
 * `BOOKING_EMAIL_LOOKUP_HMAC_SECRETS` desde el correo DESCIFRADO (nunca
 * desde el HMAC anterior — imposible invertirlo). Reanudable/idempotente,
 * salta filas purgadas, falla explícito ante un fallo de descifrado, y el
 * criterio de retirada es el conteo REAL por versión
 * (`countRowsStillOnEmailLookupHmacVersion`), nunca
 * `countActivePendingGuestIdentities` a secas.
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

async function insertGuestIdentityWithEmail(options: {
  email: string
  emailLookupHmacKeyVersion: string
  status: (typeof schema.pendingGuestIdentityStatusEnum.enumValues)[number]
  aesKeyVersion?: string
}) {
  const now = new Date()
  const [request] = await testDb
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
      status: 'pending_verification',
      identityFingerprintKeyVersion: 'v1',
    })
    .returning({ id: schema.bookingRequestRecords.id })

  // La codificación en sí siempre se hace con una versión AES REAL (v1) —
  // options.aesKeyVersion (si se pasa una versión inexistente) solo
  // sustituye la ETIQUETA guardada en la fila, simulando una fila cuya
  // keyVersion quedó inconsistente (p. ej. retirada prematuramente),
  // nunca un fallo del propio cifrado al construir el fixture.
  const encryptedEmail = encryptFieldWithVersion(options.email, 'v1')
  const emailLookupHmac = await hmacSubjectId('booking-guest-email', options.email, serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS[options.emailLookupHmacKeyVersion]!)
  const storedAesVersion = options.aesKeyVersion ?? 'v1'

  const placeholder = encryptFieldWithVersion('placeholder', 'v1')
  await testDb.insert(schema.pendingGuestIdentities).values({
    bookingRequestId: request!.id,
    firstNameCiphertext: placeholder.ciphertext,
    firstNameNonce: placeholder.nonce,
    firstNameKeyVersion: 'v1',
    lastNameCiphertext: placeholder.ciphertext,
    lastNameNonce: placeholder.nonce,
    lastNameKeyVersion: 'v1',
    emailCiphertext: encryptedEmail.ciphertext,
    emailNonce: encryptedEmail.nonce,
    emailKeyVersion: storedAesVersion,
    phoneCiphertext: placeholder.ciphertext,
    phoneNonce: placeholder.nonce,
    phoneKeyVersion: 'v1',
    emailLookupHmac,
    emailLookupHmacKeyVersion: options.emailLookupHmacKeyVersion,
    status: options.status,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  return request!.id
}

describe('rotateEmailLookupHmac — reindexado real desde el correo descifrado', () => {
  it('migra desde una tabla vacía sin error (0 filas escaneadas/migradas)', async () => {
    const result = await rotateEmailLookupHmac(testDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
    expect(result).toEqual({ rowsScanned: 0, rowsMigrated: 0 })
  })

  it('reindexa una fila activa en v1 a v3, con el HMAC correcto del correo descifrado', async () => {
    await insertGuestIdentityWithEmail({ email: 'rotacion@example.test', emailLookupHmacKeyVersion: 'v1', status: 'active' })
    const result = await rotateEmailLookupHmac(testDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
    expect(result.rowsMigrated).toBe(1)

    const [row] = await testDb.select().from(schema.pendingGuestIdentities)
    expect(row!.emailLookupHmacKeyVersion).toBe('v3')
    const expectedHmac = await hmacSubjectId('booking-guest-email', 'rotacion@example.test', serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS.v3!)
    expect(row!.emailLookupHmac).toBe(expectedHmac)
  })

  it('es idempotente: reejecutar tras una migración completa no cambia nada', async () => {
    await insertGuestIdentityWithEmail({ email: 'idempotente@example.test', emailLookupHmacKeyVersion: 'v1', status: 'active' })
    await rotateEmailLookupHmac(testDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
    const second = await rotateEmailLookupHmac(testDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
    expect(second).toEqual({ rowsScanned: 0, rowsMigrated: 0 })
  })

  it('salta (sin error) las filas purgadas/consumidas — no hace falta migrarlas', async () => {
    await insertGuestIdentityWithEmail({ email: 'purgada@example.test', emailLookupHmacKeyVersion: 'v1', status: 'consumed' })
    const result = await rotateEmailLookupHmac(testDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
    expect(result).toEqual({ rowsScanned: 0, rowsMigrated: 0 })
    const [row] = await testDb.select().from(schema.pendingGuestIdentities)
    expect(row!.emailLookupHmacKeyVersion).toBe('v1')
  })

  it('dry-run nunca persiste ningún cambio', async () => {
    await insertGuestIdentityWithEmail({ email: 'dryrun@example.test', emailLookupHmacKeyVersion: 'v1', status: 'active' })
    await rotateEmailLookupHmac(testDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: true })
    const [row] = await testDb.select().from(schema.pendingGuestIdentities)
    expect(row!.emailLookupHmacKeyVersion).toBe('v1')
  })

  it('falla explícito (nunca migra en silencio) si el campo email no es descifrable con el mapa AES actual', async () => {
    await insertGuestIdentityWithEmail({ email: 'no-descifrable@example.test', emailLookupHmacKeyVersion: 'v1', status: 'active', aesKeyVersion: 'version-aes-inexistente' })
    await expect(rotateEmailLookupHmac(testDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })).rejects.toThrow(FieldCryptoError)
    const [row] = await testDb.select().from(schema.pendingGuestIdentities)
    expect(row!.emailLookupHmacKeyVersion).toBe('v1')
  })
})

describe('búsqueda dual durante convivencia — nunca solo la versión activa', () => {
  it('una fila creada con la versión VIEJA sigue contando en el límite mientras la migración no la alcance', async () => {
    const email = 'convivencia@example.test'
    await insertGuestIdentityWithEmail({ email, emailLookupHmacKeyVersion: 'v1', status: 'active' })

    const candidates = await Promise.all(
      Object.values(serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS).map((secret) => hmacSubjectId('booking-guest-email', email, secret)),
    )
    expect(await countActivePendingRequestsByEmailHmacCandidates(candidates)).toBe(1)

    // Solo con el HMAC de la versión ACTIVA (v3) — sin la búsqueda dual se
    // perdería esta fila, que todavía está en v1.
    const onlyActive = [await hmacSubjectId('booking-guest-email', email, serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS.v3!)]
    expect(await countActivePendingRequestsByEmailHmacCandidates(onlyActive)).toBe(0)
  })
})

describe('countRowsStillOnEmailLookupHmacVersion — criterio real de retirada', () => {
  it('cuenta solo filas activas en la versión indicada — baja a 0 tras migrar', async () => {
    await insertGuestIdentityWithEmail({ email: 'retirada@example.test', emailLookupHmacKeyVersion: 'v1', status: 'active' })
    expect(await countRowsStillOnEmailLookupHmacVersion(testDb, 'v1')).toBe(1)
    await rotateEmailLookupHmac(testDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
    expect(await countRowsStillOnEmailLookupHmacVersion(testDb, 'v1')).toBe(0)
  })

  it('una fila purgada en v1 nunca bloquea la retirada de v1', async () => {
    await insertGuestIdentityWithEmail({ email: 'purgada-2@example.test', emailLookupHmacKeyVersion: 'v1', status: 'consumed' })
    expect(await countRowsStillOnEmailLookupHmacVersion(testDb, 'v1')).toBe(0)
  })
})
