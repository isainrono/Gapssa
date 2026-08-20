import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'
import {
  auditRowsForEntity,
  findAccountRowByEmail,
  getEmailVerificationRequestStatus,
  setAccountStatusForTesting,
  setEmailVerificationRequestChallengeIdForTesting,
} from './authDb'

/**
 * Revisión 3 de Fase 3 — `completeEmailVerification` (repository.ts) solo
 * puede transicionar `pending_verification -> active`. Antes de esta
 * revisión, la función activaba cualquier cuenta que no estuviera ya
 * `active`, así que un OTP emitido mientras la cuenta era todavía
 * `pending_verification` podía reactivar una cuenta `suspended` o
 * `pending_deletion` si el código se verificaba después de que un estado
 * externo cambiara la cuenta.
 */

function freshEmail(): string {
  return `test-${randomUUID()}@example.test`
}

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!'
const DOB = '1990-01-01'

async function freshJarWithCsrf(path = '/es/mi-cuenta/verificar'): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, path)
  return jar
}

async function registerPendingAccount(email: string): Promise<{ jar: CookieJar; code: string; accountId: string }> {
  const jar = await freshJarWithCsrf('/es/mi-cuenta/registro')
  await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
  const code = await getLatestOtpCodeForEmail(email)
  if (!code) throw new Error(`No se encontró código OTP para ${email}`)
  const account = await findAccountRowByEmail(email)
  const accountId = (account as { id: string }).id
  return { jar, code, accountId }
}

describe('completeEmailVerification — only pending_verification -> active', () => {
  it('activates a genuinely pending_verification account', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    const response = await authApi.post(jar, '/api/auth/verify-email', { email, code })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'verified' })

    const account = await findAccountRowByEmail(email)
    expect((account as { status: string }).status).toBe('active')
    expect((account as { email_verified_at: unknown }).email_verified_at).not.toBeNull()

    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'AccountEmailVerified')).toHaveLength(1)
  })

  it('is idempotent — repeating the same correct code after activation never duplicates the audit trail', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    const first = await authApi.post(jar, '/api/auth/verify-email', { email, code })
    expect(first.status).toBe(200)

    const second = await authApi.post(jar, '/api/auth/verify-email', { email, code })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ status: 'verified' })

    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'AccountEmailVerified')).toHaveLength(1)
  })

  it('never reactivates a suspended account, even with the correct code, and audits nothing', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    await setAccountStatusForTesting(accountId, 'suspended')

    const response = await authApi.post(jar, '/api/auth/verify-email', { email, code })

    // Misma respuesta genérica que un código caducado — nunca revela que la
    // cuenta está suspendida a quien probó un código correcto.
    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'expired' })

    const account = await findAccountRowByEmail(email)
    expect((account as { status: string }).status).toBe('suspended')
    expect((account as { email_verified_at: unknown }).email_verified_at).toBeNull()

    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'AccountEmailVerified')).toHaveLength(0)
  })

  it('never reactivates a pending_deletion account, even with the correct code, and audits nothing', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    await setAccountStatusForTesting(accountId, 'pending_deletion')

    const response = await authApi.post(jar, '/api/auth/verify-email', { email, code })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'expired' })

    const account = await findAccountRowByEmail(email)
    expect((account as { status: string }).status).toBe('pending_deletion')

    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'AccountEmailVerified')).toHaveLength(0)
  })

  it('rejects a code whose challenge does not match the pending verification request row (never marks "any pending request" indiscriminately)', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    // Desincroniza a mano el otp_challenge_id de la fila pendiente —
    // simula que el reto vigente en Redis (el que valida `code`) pertenece
    // a una solicitud distinta de la que hay guardada en Postgres.
    await setEmailVerificationRequestChallengeIdForTesting(accountId, randomUUID())

    const response = await authApi.post(jar, '/api/auth/verify-email', { email, code })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'expired' })

    const account = await findAccountRowByEmail(email)
    expect((account as { status: string }).status).toBe('pending_verification')
    expect(await getEmailVerificationRequestStatus(accountId)).toBe('pending')
  })

  it('a nonexistent account produces the same controlled generic response as an expired code (never throws)', async () => {
    const jar = await freshJarWithCsrf()
    const response = await authApi.post(jar, '/api/auth/verify-email', { email: freshEmail(), code: '123456' })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'expired' })
  })

  it('two concurrent verifications with the correct code both succeed but only activate the account once', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    const [first, second] = await Promise.all([
      authApi.post(jar, '/api/auth/verify-email', { email, code }),
      authApi.post(jar, '/api/auth/verify-email', { email, code }),
    ])

    // Ambas ganan (una "verified", la otra recupera vía "already_consumed"
    // con el mismo código correcto) o, como mucho, una de ellas ve el reto
    // ya consumido por la otra — nunca un error de servidor.
    expect([first.status, second.status]).toEqual([200, 200])

    const account = await findAccountRowByEmail(email)
    expect((account as { status: string }).status).toBe('active')

    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'AccountEmailVerified')).toHaveLength(1)
  })
})
