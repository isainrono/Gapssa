import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hmacSubjectId, normalizeEmail } from '@gapssa/contracts'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Mismo motivo que el resto de la suite: importa código `server-only`
// directamente (accessToken.ts, repository.ts), no a través de un
// endpoint HTTP.
vi.mock('server-only', () => ({}))

const schema = await import('../../../src/server/booking/db/schema')
const { runBookingMigrations } = await import('../../../src/server/booking/db/migrate')
const { assertEphemeralTestDatabaseUrl } = await import('../ephemeralDatabaseGuard')
const { signBookingRequestAccessToken, signBookingRequestAccessTokenWithVersion, verifyBookingRequestAccessToken } = await import(
  '../../../src/server/booking/accessToken'
)
const { serverEnv } = await import('../../../src/server/env')

/**
 * Bloque de migraciones 0007/0008 (separación de los enums GCS del
 * versionado HMAC + backfill de `access_token_key_version`) — prueba de
 * extremo a extremo contra Postgres 18 DESECHABLE
 * (`scripts/secrets-rotation/tests/disposable-infra.sh`), nunca contra
 * `gapssa_booking` real. Dos bases propias, efímeras, SEPARADAS de la
 * compartida por el resto de la suite (`inject('integrationBookingDatabaseUrl')`,
 * ya migrada por completo por `global-setup.disposable.ts` antes de que
 * cualquier test corra) — aquí necesitamos controlar el estado ANTES de
 * 0007/0008, así que cada test gestiona su propia base desde cero.
 */

const REAL_MIGRATIONS_DIR = fileURLToPath(new URL('../../../drizzle/booking/migrations', import.meta.url))
const APPROVED_PREFIX = 'gapssa_booking_test_'

function generateTestDatabaseName(suffix: string): string {
  return `${APPROVED_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 12)}_${suffix}`
}

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function createDatabase(adminConnectionString: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString: adminConnectionString })
  await client.connect()
  try {
    await client.query(`CREATE DATABASE "${databaseName}"`)
  } finally {
    await client.end()
  }
}

async function dropDatabase(adminConnectionString: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString: adminConnectionString })
  await client.connect()
  try {
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [
      databaseName,
    ])
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  } finally {
    await client.end()
  }
}

/**
 * Copia SOLO las migraciones 0000-0006 (+ journal recortado) a un
 * directorio temporal fuera del repo — nunca toca el directorio real de
 * migraciones. Sirve para reproducir, en una base efímera propia, el
 * estado del esquema tal cual quedó justo ANTES de que existieran 0007/0008,
 * y así poder sembrar datos "históricos" con la forma de tabla de esa
 * época (sin las columnas que 0008 añade).
 */
async function buildPreMigrationFolder(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'gapssa-booking-premigration-'))
  await cp(REAL_MIGRATIONS_DIR, dir, { recursive: true })
  const entries = await readdir(dir)
  for (const entry of entries) {
    if (entry === '0007_gifted_typhoid_mary.sql' || entry === '0008_freezing_matthew_murdock.sql') {
      await rm(path.join(dir, entry))
    }
  }
  await rm(path.join(dir, 'meta', '0007_snapshot.json'), { force: true })
  await rm(path.join(dir, 'meta', '0008_snapshot.json'), { force: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
  journal.entries = journal.entries.filter((entry) => entry.idx <= 6)
  await writeFile(journalPath, JSON.stringify(journal, null, 2))
  return dir
}

const adminUrl = process.env.GAPSSA_ROTATION_V3_PG_URL
if (!adminUrl) {
  throw new Error(
    'Falta GAPSSA_ROTATION_V3_PG_URL — arranca la infra desechable (scripts/secrets-rotation/tests/disposable-infra.sh up/env) antes de correr esta suite.',
  )
}

describe('migración 0007 (enums GCS) + 0008 (versionado HMAC access_token_key_version / email_lookup_hmac_key_version)', () => {
  let preMigrationDir: string
  let historyDbName: string
  let historyDbUrl: string
  let guestRequestId: string
  let authenticatedRequestId: string
  let historicalGuestEmail: string
  let historicalV1Token: string

  beforeAll(async () => {
    preMigrationDir = await buildPreMigrationFolder()

    historyDbName = generateTestDatabaseName('history')
    historyDbUrl = withDatabaseName(adminUrl, historyDbName)
    assertEphemeralTestDatabaseUrl(historyDbUrl)
    await createDatabase(adminUrl, historyDbName)

    // 1) Aplica SOLO 0000-0006 — reproduce el esquema tal cual estaba
    // antes de que 0007/0008 existieran.
    const preMigratePool = new Pool({ connectionString: historyDbUrl })
    try {
      const preDb = drizzle(preMigratePool)
      await migrate(preDb, { migrationsFolder: preMigrationDir })
    } finally {
      await preMigratePool.end()
    }

    // 2) Siembra datos "históricos" con INSERT crudo — a propósito NUNCA
    // vía el objeto `schema` de Drizzle (ese describe la forma POST-migración,
    // con columnas que en este punto todavía no existen en la base).
    const seedClient = new Client({ connectionString: historyDbUrl })
    await seedClient.connect()
    try {
      guestRequestId = randomUUID()
      const now = new Date()
      const startAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000)
      const verificationExpiresAt = new Date(now.getTime() + 10 * 60 * 1000)

      await seedClient.query(
        `INSERT INTO booking_request_records
           (id, treatment_id, professional_id, zone_id, start_at, end_at, status,
            verification_expires_at, idempotency_key, payload_hash, identity_fingerprint_key_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          guestRequestId,
          'treatment-fixture',
          'professional-fixture',
          'zone-fixture',
          startAt,
          endAt,
          'pending_verification',
          verificationExpiresAt,
          randomUUID(),
          'fixture-payload-hash-guest',
          'v1',
        ],
      )

      historicalGuestEmail = `historico-${randomUUID()}@example.test`
      const normalizedEmail = normalizeEmail(historicalGuestEmail)
      const emailLookupHmacV1 = await hmacSubjectId('booking-guest-email', normalizedEmail, serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS.v1!)

      await seedClient.query(
        `INSERT INTO pending_guest_identities
           (id, booking_request_id,
            first_name_ciphertext, first_name_nonce, first_name_key_version,
            last_name_ciphertext, last_name_nonce, last_name_key_version,
            email_ciphertext, email_nonce, email_key_version,
            phone_ciphertext, phone_nonce, phone_key_version,
            email_lookup_hmac, status, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          randomUUID(),
          guestRequestId,
          'fixture-ciphertext',
          'fixture-nonce',
          'v1',
          'fixture-ciphertext',
          'fixture-nonce',
          'v1',
          'fixture-ciphertext',
          'fixture-nonce',
          'v1',
          'fixture-ciphertext',
          'fixture-nonce',
          'v1',
          emailLookupHmacV1,
          'active',
          new Date(now.getTime() + 60 * 60 * 1000),
        ],
      )

      // Fila del flujo AUTENTICADO histórica — client_account_id no nulo,
      // nunca tuvo (ni podía tener) columna de versión de token de acceso.
      authenticatedRequestId = randomUUID()
      await seedClient.query(
        `INSERT INTO booking_request_records
           (id, client_account_id, treatment_id, professional_id, zone_id, start_at, end_at, status,
            verification_expires_at, idempotency_key, payload_hash, identity_fingerprint_key_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          authenticatedRequestId,
          randomUUID(),
          'treatment-fixture',
          'professional-fixture',
          'zone-fixture',
          startAt,
          endAt,
          'verification_processing',
          verificationExpiresAt,
          randomUUID(),
          'fixture-payload-hash-auth',
          'v1',
        ],
      )
    } finally {
      await seedClient.end()
    }

    // El "token histórico": lo que un invitado real habría recibido antes
    // de que existiera el versionado (secreto único, equivalente a v1).
    historicalV1Token = signBookingRequestAccessTokenWithVersion(guestRequestId, 'v1')

    // 3) Aplica el conjunto REAL y completo de migraciones (0000-0008) —
    // como 0000-0006 ya están marcadas aplicadas en esta base (mismos
    // hashes/tags), esto aplica EXCLUSIVAMENTE 0007 y 0008: "migración
    // desde estado previo".
    await runBookingMigrations(historyDbUrl)
  })

  afterAll(async () => {
    await dropDatabase(adminUrl, historyDbName)
    await rm(preMigrationDir, { recursive: true, force: true })
  })

  it('backfillea access_token_key_version=v1 en la solicitud de INVITADO histórica', async () => {
    const pool = new Pool({ connectionString: historyDbUrl })
    try {
      const db = drizzle(pool, { schema })
      const [row] = await db.select().from(schema.bookingRequestRecords).where(eq(schema.bookingRequestRecords.id, guestRequestId))
      expect(row?.accessTokenKeyVersion).toBe('v1')
    } finally {
      await pool.end()
    }
  })

  it('conserva NULL en la solicitud AUTENTICADA histórica (nunca se le asigna versión)', async () => {
    const pool = new Pool({ connectionString: historyDbUrl })
    try {
      const db = drizzle(pool, { schema })
      const [row] = await db
        .select()
        .from(schema.bookingRequestRecords)
        .where(eq(schema.bookingRequestRecords.id, authenticatedRequestId))
      expect(row?.accessTokenKeyVersion).toBeNull()
      expect(row?.clientAccountId).not.toBeNull()
    } finally {
      await pool.end()
    }
  })

  it('el token de acceso histórico (firmado bajo v1) SIGUE verificando tras la migración', () => {
    expect(verifyBookingRequestAccessToken(guestRequestId, 'v1', historicalV1Token)).toBe(true)
  })

  it('la identidad pendiente histórica queda con email_lookup_hmac_key_version=v1', async () => {
    const pool = new Pool({ connectionString: historyDbUrl })
    try {
      const db = drizzle(pool, { schema })
      const [row] = await db
        .select()
        .from(schema.pendingGuestIdentities)
        .where(eq(schema.pendingGuestIdentities.bookingRequestId, guestRequestId))
      expect(row?.emailLookupHmacKeyVersion).toBe('v1')
    } finally {
      await pool.end()
    }
  })

  it('la búsqueda por email sigue encontrando la identidad histórica durante convivencia (candidatos multi-versión)', async () => {
    const normalizedEmail = normalizeEmail(historicalGuestEmail)
    const candidates = await Promise.all(
      Object.values(serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS).map((secret) => hmacSubjectId('booking-guest-email', normalizedEmail, secret)),
    )
    // Esta consulta corre contra bookingDb (el singleton de producción,
    // apuntando a DATABASE_URL_BOOKING = la base COMPARTIDA de la suite,
    // no historyDbUrl) — así que en vez de reutilizar la función de
    // producción aquí, se reproduce la misma consulta contra historyDbUrl
    // para demostrar el comportamiento sobre los datos históricos reales.
    const pool = new Pool({ connectionString: historyDbUrl })
    try {
      const db = drizzle(pool, { schema })
      const rows = await db
        .select({ id: schema.bookingRequestRecords.id })
        .from(schema.pendingGuestIdentities)
        .innerJoin(schema.bookingRequestRecords, eq(schema.bookingRequestRecords.id, schema.pendingGuestIdentities.bookingRequestId))
        .where(inArray(schema.pendingGuestIdentities.emailLookupHmac, candidates))
      expect(rows.some((row) => row.id === guestRequestId)).toBe(true)
    } finally {
      await pool.end()
    }
  })

  it('una solicitud de invitado NUEVA (creada después de la migración) escribe la versión ACTIVA, no v1 a ciegas', async () => {
    const pool = new Pool({ connectionString: historyDbUrl })
    try {
      const db = drizzle(pool, { schema })
      const newId = randomUUID()
      const { token, keyVersion } = signBookingRequestAccessToken(newId)
      const now = new Date()
      await db.insert(schema.bookingRequestRecords).values({
        id: newId,
        treatmentId: 'treatment-fixture',
        professionalId: 'professional-fixture',
        zoneId: 'zone-fixture',
        startAt: now,
        endAt: new Date(now.getTime() + 60 * 60 * 1000),
        verificationExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        idempotencyKey: randomUUID(),
        payloadHash: 'fixture-payload-hash-new-guest',
        identityFingerprintKeyVersion: 'v1',
        accessTokenKeyVersion: keyVersion,
      })
      expect(keyVersion).toBe(serverEnv.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION)
      expect(verifyBookingRequestAccessToken(newId, keyVersion, token)).toBe(true)
    } finally {
      await pool.end()
    }
  })

  it('una solicitud autenticada NUEVA (creada después de la migración) conserva NULL', async () => {
    const pool = new Pool({ connectionString: historyDbUrl })
    try {
      const db = drizzle(pool, { schema })
      const newId = randomUUID()
      const now = new Date()
      const [row] = await db
        .insert(schema.bookingRequestRecords)
        .values({
          id: newId,
          clientAccountId: randomUUID(),
          treatmentId: 'treatment-fixture',
          professionalId: 'professional-fixture',
          zoneId: 'zone-fixture',
          startAt: now,
          endAt: new Date(now.getTime() + 60 * 60 * 1000),
          status: 'verification_processing',
          verificationExpiresAt: now,
          idempotencyKey: randomUUID(),
          payloadHash: 'fixture-payload-hash-new-auth',
          identityFingerprintKeyVersion: 'v1',
        })
        .returning()
      expect(row?.accessTokenKeyVersion).toBeNull()
    } finally {
      await pool.end()
    }
  })

  it('la reaplicación del runner de migraciones es idempotente/segura (no repite el backfill, no falla)', async () => {
    await expect(runBookingMigrations(historyDbUrl)).resolves.toBeUndefined()
    const pool = new Pool({ connectionString: historyDbUrl })
    try {
      const db = drizzle(pool, { schema })
      const [row] = await db.select().from(schema.bookingRequestRecords).where(eq(schema.bookingRequestRecords.id, guestRequestId))
      expect(row?.accessTokenKeyVersion).toBe('v1')
    } finally {
      await pool.end()
    }
  })
})

describe('migración 0007/0008 aplicada desde una base completamente vacía', () => {
  let emptyDbName: string
  let emptyDbUrl: string

  beforeAll(async () => {
    emptyDbName = generateTestDatabaseName('empty')
    emptyDbUrl = withDatabaseName(adminUrl, emptyDbName)
    assertEphemeralTestDatabaseUrl(emptyDbUrl)
    await createDatabase(adminUrl, emptyDbName)
  })

  afterAll(async () => {
    await dropDatabase(adminUrl, emptyDbName)
  })

  it('aplica las 9 migraciones (0000-0008) sin error sobre una base vacía — el backfill afecta 0 filas, no falla', async () => {
    await expect(runBookingMigrations(emptyDbUrl)).resolves.toBeUndefined()
  })

  it('columnas access_token_key_version / email_lookup_hmac_key_version existen con la nulabilidad correcta', async () => {
    const client = new Client({ connectionString: emptyDbUrl })
    await client.connect()
    try {
      const { rows: accessTokenCol } = await client.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'booking_request_records' AND column_name = 'access_token_key_version'`,
      )
      expect(accessTokenCol[0]?.is_nullable).toBe('YES')

      const { rows: emailLookupCol } = await client.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'pending_guest_identities' AND column_name = 'email_lookup_hmac_key_version'`,
      )
      expect(emailLookupCol[0]?.is_nullable).toBe('NO')

      const { rows: enumValues } = await client.query(
        `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'booking_review_conflict_type'::regtype ORDER BY enumsortorder`,
      )
      expect(enumValues.map((r: { enumlabel: string }) => r.enumlabel)).toContain('meeting_gcs_exclusion_mismatch')
    } finally {
      await client.end()
    }
  })
})
