import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { describe, expect, inject, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'
import { auditRowsForEntity, findAccountRowByEmail } from './authDb'

function freshEmail(): string {
  return `test-${randomUUID()}@example.test`
}

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!'
const DOB = '1990-01-01'

async function freshJarWithCsrf(path = '/es/mi-cuenta/registro'): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, path)
  return jar
}

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function queryCmsUsersByEmail(email: string): Promise<unknown[]> {
  const cmsTestDbUrl = withDatabaseName(process.env.DATABASE_URL_CMS as string, inject('integrationTestDatabaseName'))
  const client = new Client({ connectionString: cmsTestDbUrl })
  await client.connect()
  try {
    const result = await client.query('select * from users where email = $1', [email])
    return result.rows
  } finally {
    await client.end()
  }
}

describe('separation between Payload `users` (staff) and `gapssa_auth.client_accounts` (portal clients)', () => {
  it('an account registered through /api/auth/register never appears in Payload\'s users table', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()
    await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })

    const payloadRows = await queryCmsUsersByEmail(email)
    expect(payloadRows).toHaveLength(0)

    const clientAccountRow = await findAccountRowByEmail(email)
    expect(clientAccountRow).not.toBeNull()
  })

  it('logging into /api/auth/login is impossible for an email that only exists as a Payload staff user', async () => {
    // No hace falta un admin real de Payload para probar esto: basta con
    // que el correo no exista en absoluto en client_accounts, que es
    // exactamente la situación de cualquier cuenta que solo viva en
    // `users` — la respuesta debe ser la misma "no enumeración" que para
    // cualquier otro correo desconocido, nunca un error distinto que
    // delate la existencia de una cuenta de staff.
    const staffLikeEmail = 'editor@gapssa.test'
    const jar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    const response = await authApi.post(jar, '/api/auth/login', { email: staffLikeEmail, password: 'whatever-99!' })

    expect(response.status).toBe(401)
    expect(response.body.error).toMatchObject({ code: 'invalid_credentials' })
  })
})

describe('auth_audit_log never contains secrets or raw PII', () => {
  it('a login event stores only structured fields — no password, no email, no free text', async () => {
    const email = freshEmail()
    const registerJar = await freshJarWithCsrf()
    await authApi.post(registerJar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: DOB,
      locale: 'es',
    })
    const code = await getLatestOtpCodeForEmail(email)
    await authApi.post(registerJar, '/api/auth/verify-email', { email, code })

    const account = await findAccountRowByEmail(email)
    const accountId = (account as { id: string }).id

    const loginJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(loginJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    await authApi.post(loginJar, '/api/auth/login', { email, password: 'wrong-password-99!' })

    const rows = await auditRowsForEntity('ClientAccount', accountId)
    expect(rows.length).toBeGreaterThan(0)

    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(STRONG_PASSWORD)
    expect(serialized).not.toContain(email)
    expect(serialized).not.toContain(code)

    for (const row of rows) {
      // Cada fila declara su representación: raw (enum cerrado),
      // redacted (hash estructurado) o event (sin valor) — nunca un
      // campo de texto libre adicional.
      expect(['raw', 'redacted', 'event']).toContain(row.value_representation)
      if (row.value_representation === 'raw') {
        expect(typeof row.previous_value === 'string' || row.previous_value === null).toBe(true)
        expect(typeof row.new_value === 'string' || row.new_value === null).toBe(true)
      }
    }
  })
})

describe('login rate limiting', () => {
  it('locks out further attempts for the same account after the configured threshold, independent of correctness', async () => {
    const email = freshEmail()
    const registerJar = await freshJarWithCsrf()
    await authApi.post(registerJar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: DOB,
      locale: 'es',
    })
    const code = await getLatestOtpCodeForEmail(email)
    await authApi.post(registerJar, '/api/auth/verify-email', { email, code })

    const maxAttempts = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR ?? '10')

    let lastStatus = 0
    for (let attempt = 0; attempt < maxAttempts + 1; attempt += 1) {
      const jar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
      const response = await authApi.post(jar, '/api/auth/login', { email, password: 'wrong-password-99!' })
      lastStatus = response.status
    }

    expect(lastStatus).toBe(429)
  })
})
