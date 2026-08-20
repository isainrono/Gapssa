import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'

// Mismo motivo que el resto de la suite: importa código `server-only`
// directamente, no a través de un endpoint HTTP.
vi.mock('server-only', () => ({}))

const schema = await import('../../../src/server/booking/db/schema')
const { signBookingRequestAccessToken, signBookingRequestAccessTokenWithVersion, verifyBookingRequestAccessToken } = await import(
  '../../../src/server/booking/accessToken'
)
const { countLiveBookingRequestsReferencingAccessTokenVersions } = await import('../../../src/server/booking/rotationSafetyChecks')

/**
 * Punto 1 de la tercera revisión: `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS`
 * versionado — verificar SIEMPRE contra la versión exacta guardada en la
 * fila (`accessTokenKeyVersion`), nunca "probar todas las del mapa", y
 * retirar una versión solo cuando `countLiveBookingRequestsReferencingAccessTokenVersions`
 * para esa versión llega a 0 (mismo criterio real que fingerprint, nunca
 * `countLiveBookingRequests` a secas).
 */

const pool = new Pool({ connectionString: inject('integrationBookingDatabaseUrl') })
const testDb = drizzle(pool, { schema })

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await testDb.delete(schema.bookingRequestRecords)
})

async function insertBookingRequest(options: {
  status: (typeof schema.bookingRequestStatusEnum.enumValues)[number]
  accessTokenKeyVersion: string | null
}) {
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
      identityFingerprintKeyVersion: 'v1',
      accessTokenKeyVersion: options.accessTokenKeyVersion,
      resolvedAt: options.status === 'resolved' ? now : undefined,
      resolution: options.status === 'resolved' ? 'confirmed' : undefined,
    })
    .returning({ id: schema.bookingRequestRecords.id })
  return row!.id
}

describe('signBookingRequestAccessToken / verifyBookingRequestAccessToken — versión exacta, nunca "probar todas"', () => {
  it('un token firmado con la versión activa verifica contra esa misma versión guardada en la fila', () => {
    const id = randomUUID()
    const { token, keyVersion } = signBookingRequestAccessToken(id)
    expect(verifyBookingRequestAccessToken(id, keyVersion, token)).toBe(true)
  })

  it('un token de una fila con accessTokenKeyVersion=null (flujo autenticado) nunca verifica', () => {
    const id = randomUUID()
    const { token } = signBookingRequestAccessToken(id)
    expect(verifyBookingRequestAccessToken(id, null, token)).toBe(false)
  })

  it('signBookingRequestAccessTokenWithVersion reproduce el mismo token para la versión guardada de una fila real', async () => {
    const { keyVersion } = signBookingRequestAccessToken('placeholder')
    const id = await insertBookingRequest({ status: 'pending_verification', accessTokenKeyVersion: keyVersion })
    const [row] = await testDb.select().from(schema.bookingRequestRecords).where(eq(schema.bookingRequestRecords.id, id))
    const reproduced = signBookingRequestAccessTokenWithVersion(id, row!.accessTokenKeyVersion)
    expect(verifyBookingRequestAccessToken(id, row!.accessTokenKeyVersion, reproduced)).toBe(true)
  })

  it('una versión desconocida (retirada prematuramente) lanza un error explícito, nunca acepta en silencio', () => {
    const id = randomUUID()
    const { token } = signBookingRequestAccessToken(id)
    expect(() => verifyBookingRequestAccessToken(id, 'version-jamas-registrada', token)).toThrow()
    expect(() => signBookingRequestAccessTokenWithVersion(id, 'version-jamas-registrada')).toThrow()
  })

  it('un token cruzado (de otra solicitud) siempre se rechaza, sea cual sea la versión', () => {
    const idA = randomUUID()
    const idB = randomUUID()
    const { token, keyVersion } = signBookingRequestAccessToken(idA)
    expect(verifyBookingRequestAccessToken(idB, keyVersion, token)).toBe(false)
  })
})

describe('countLiveBookingRequestsReferencingAccessTokenVersions — criterio real de retirada', () => {
  it('cuenta solo filas NO resueltas cuyo accessTokenKeyVersion coincide', async () => {
    await insertBookingRequest({ status: 'pending_verification', accessTokenKeyVersion: 'v1' })
    await insertBookingRequest({ status: 'verification_processing', accessTokenKeyVersion: 'v1' })
    await insertBookingRequest({ status: 'resolved', accessTokenKeyVersion: 'v1' })
    await insertBookingRequest({ status: 'pending_verification', accessTokenKeyVersion: 'v3' })

    expect(await countLiveBookingRequestsReferencingAccessTokenVersions(testDb, ['v1'])).toBe(2)
    expect(await countLiveBookingRequestsReferencingAccessTokenVersions(testDb, ['v3'])).toBe(1)
    expect(await countLiveBookingRequestsReferencingAccessTokenVersions(testDb, ['v1', 'v3'])).toBe(3)
  })

  it('filas del flujo autenticado (accessTokenKeyVersion=null) nunca cuentan para ninguna versión', async () => {
    await insertBookingRequest({ status: 'pending_verification', accessTokenKeyVersion: null })
    expect(await countLiveBookingRequestsReferencingAccessTokenVersions(testDb, ['v1'])).toBe(0)
  })

  it('la retirada real: el conteo baja a 0 en cuanto la última fila viva se resuelve — nunca antes', async () => {
    const id = await insertBookingRequest({ status: 'pending_verification', accessTokenKeyVersion: 'v1' })
    expect(await countLiveBookingRequestsReferencingAccessTokenVersions(testDb, ['v1'])).toBe(1)

    await testDb
      .update(schema.bookingRequestRecords)
      .set({ status: 'resolved', resolution: 'confirmed', resolvedAt: new Date() })
      .where(eq(schema.bookingRequestRecords.id, id))

    expect(await countLiveBookingRequestsReferencingAccessTokenVersions(testDb, ['v1'])).toBe(0)
  })

  it('lista vacía de versiones siempre cuenta 0 sin consultar', async () => {
    expect(await countLiveBookingRequestsReferencingAccessTokenVersions(testDb, [])).toBe(0)
  })
})
