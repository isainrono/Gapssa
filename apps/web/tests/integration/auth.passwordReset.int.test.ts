import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'
import {
  deleteCredentialForTesting,
  findAccountRowByEmail,
  findCredentialRowForAccount,
  findSessionRowsForAccount,
  getLatestPasswordResetRequestStatus,
  setPasswordResetRequestChallengeIdForTesting,
} from './authDb'

function freshEmail(): string {
  return `test-${randomUUID()}@example.test`
}

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!'
const NEW_STRONG_PASSWORD = 'Different-Horse-Battery-77!'
const DOB = '1990-01-01'

async function freshJarWithCsrf(path = '/es/mi-cuenta/recuperar'): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, path)
  return jar
}

async function registerAndVerify(email: string): Promise<void> {
  const jar = await freshJarWithCsrf('/es/mi-cuenta/registro')
  await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
  const code = await getLatestOtpCodeForEmail(email)
  await authApi.post(jar, '/api/auth/verify-email', { email, code })
}

describe('POST /api/auth/password/forgot', () => {
  it('returns the identical generic response whether or not the account exists', async () => {
    const email = freshEmail()
    await registerAndVerify(email)

    const jarKnown = await freshJarWithCsrf()
    const known = await authApi.post(jarKnown, '/api/auth/password/forgot', { email })

    const jarUnknown = await freshJarWithCsrf()
    const unknown = await authApi.post(jarUnknown, '/api/auth/password/forgot', { email: freshEmail() })

    expect(known.status).toBe(202)
    expect(unknown.status).toBe(202)
    expect(known.body).toEqual(unknown.body)
  })
})

describe('POST /api/auth/password/reset', () => {
  it('completes the full recover -> reset -> login-with-new-password flow, and revokes existing sessions', async () => {
    const email = freshEmail()
    await registerAndVerify(email)

    // Sesión activa antes de restablecer — debe quedar revocada al terminar.
    const sessionJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(sessionJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    const sessionsBeforeReset = await authApi.get(sessionJar, '/api/auth/sessions')
    expect(sessionsBeforeReset.status).toBe(200)

    const forgotJar = await freshJarWithCsrf()
    await authApi.post(forgotJar, '/api/auth/password/forgot', { email })
    const code = await getLatestOtpCodeForEmail(email)

    const resetResponse = await authApi.post(forgotJar, '/api/auth/password/reset', {
      email,
      code,
      newPassword: NEW_STRONG_PASSWORD,
    })
    expect(resetResponse.status).toBe(200)

    // La sesión que existía antes del restablecimiento ya no sirve.
    const sessionsAfterReset = await authApi.get(sessionJar, '/api/auth/sessions')
    expect(sessionsAfterReset.status).toBe(401)

    // La contraseña antigua ya no funciona; la nueva sí.
    const loginOldJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    const loginOld = await authApi.post(loginOldJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    expect(loginOld.body.error).toMatchObject({ code: 'invalid_credentials' })

    const loginNewJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    const loginNew = await authApi.post(loginNewJar, '/api/auth/login', { email, password: NEW_STRONG_PASSWORD })
    expect(loginNew.status).toBe(200)
  })

  it('rejects a weak new password without consuming the OTP attempt', async () => {
    const email = freshEmail()
    await registerAndVerify(email)

    const forgotJar = await freshJarWithCsrf()
    await authApi.post(forgotJar, '/api/auth/password/forgot', { email })
    const code = await getLatestOtpCodeForEmail(email)

    const weak = await authApi.post(forgotJar, '/api/auth/password/reset', { email, code, newPassword: 'short1!' })
    expect(weak.status).toBe(400)
    expect(weak.body.error).toMatchObject({ code: 'weak_password' })

    // El código sigue siendo válido: la comprobación de fuerza ocurrió
    // antes de tocar el OTP.
    const strong = await authApi.post(forgotJar, '/api/auth/password/reset', {
      email,
      code,
      newPassword: NEW_STRONG_PASSWORD,
    })
    expect(strong.status).toBe(200)
  })

  it('revisión 2 de Fase 3 — a second forgot request replaces the pending one: only the latest code works', async () => {
    const email = freshEmail()
    await registerAndVerify(email)

    const firstForgotJar = await freshJarWithCsrf()
    await authApi.post(firstForgotJar, '/api/auth/password/forgot', { email })
    const firstCode = await getLatestOtpCodeForEmail(email)

    const secondForgotJar = await freshJarWithCsrf()
    await authApi.post(secondForgotJar, '/api/auth/password/forgot', { email })
    const secondCode = await getLatestOtpCodeForEmail(email)
    expect(secondCode).not.toBe(firstCode)

    const withOldCode = await authApi.post(secondForgotJar, '/api/auth/password/reset', {
      email,
      code: firstCode,
      newPassword: NEW_STRONG_PASSWORD,
    })
    expect(withOldCode.status).not.toBe(200)

    const withNewCode = await authApi.post(secondForgotJar, '/api/auth/password/reset', {
      email,
      code: secondCode,
      newPassword: NEW_STRONG_PASSWORD,
    })
    expect(withNewCode.status).toBe(200)
  })

  it('revisión 2 de Fase 3 — resubmitting the SAME correct code after a successful reset is idempotent (recovery design), not an error', async () => {
    const email = freshEmail()
    await registerAndVerify(email)

    const forgotJar = await freshJarWithCsrf()
    await authApi.post(forgotJar, '/api/auth/password/forgot', { email })
    const code = await getLatestOtpCodeForEmail(email)

    const first = await authApi.post(forgotJar, '/api/auth/password/reset', { email, code, newPassword: NEW_STRONG_PASSWORD })
    expect(first.status).toBe(200)

    const second = await authApi.post(forgotJar, '/api/auth/password/reset', { email, code, newPassword: NEW_STRONG_PASSWORD })
    expect(second.status).toBe(200)

    // La contraseña sigue siendo la fijada por la primera petición
    // (segunda es un no-op, no una segunda rotación) — inicia sesión con
    // ella para confirmarlo.
    const loginJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    const login = await authApi.post(loginJar, '/api/auth/login', { email, password: NEW_STRONG_PASSWORD })
    expect(login.status).toBe(200)
  })

  it('rejects an incorrect code without revealing whether the account exists', async () => {
    const email = freshEmail()
    await registerAndVerify(email)

    const jarKnown = await freshJarWithCsrf()
    const known = await authApi.post(jarKnown, '/api/auth/password/reset', {
      email,
      code: '000000',
      newPassword: NEW_STRONG_PASSWORD,
    })

    const jarUnknown = await freshJarWithCsrf()
    const unknown = await authApi.post(jarUnknown, '/api/auth/password/reset', {
      email: freshEmail(),
      code: '000000',
      newPassword: NEW_STRONG_PASSWORD,
    })

    expect(known.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(unknown.body).toEqual(known.body)
  })

  it('revisión de cierre de Fase 3 — never reports success when the verified code has no matching password_reset_requests row (request_not_found)', async () => {
    const email = freshEmail()
    await registerAndVerify(email)

    const forgotJar = await freshJarWithCsrf()
    await authApi.post(forgotJar, '/api/auth/password/forgot', { email })
    const code = await getLatestOtpCodeForEmail(email)
    const account = await findAccountRowByEmail(email)
    const accountId = (account as { id: string }).id

    // Simula que el reto que `code` valida en Redis no coincide con la fila
    // `pending` de Postgres (p. ej. un fallo de proceso entre `requestOtp` y
    // `replacePendingPasswordResetRequest`, o, como aquí, la fila apunta a
    // otro reto) — `completePasswordReset` debe devolver `request_not_found`
    // y el endpoint NUNCA debe responder como si la contraseña hubiera
    // cambiado.
    await setPasswordResetRequestChallengeIdForTesting(accountId, randomUUID())

    const credentialBefore = await findCredentialRowForAccount(accountId)

    const response = await authApi.post(forgotJar, '/api/auth/password/reset', {
      email,
      code,
      newPassword: NEW_STRONG_PASSWORD,
    })

    // Mismo error genérico que un código caducado — nunca un 200 falso.
    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'expired' })

    // La credencial nunca se tocó y la solicitud sigue pendiente.
    const credentialAfter = await findCredentialRowForAccount(accountId)
    expect(credentialAfter).toEqual(credentialBefore)
    expect(await getLatestPasswordResetRequestStatus(accountId)).toBe('pending')

    // La contraseña original sigue funcionando.
    const loginJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    const login = await authApi.post(loginJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    expect(login.status).toBe(200)
  })

  it('revisión de cierre de Fase 3 — never reports success nor consumes the request if the account has no password credential (credential_missing)', async () => {
    const email = freshEmail()
    await registerAndVerify(email)

    const forgotJar = await freshJarWithCsrf()
    await authApi.post(forgotJar, '/api/auth/password/forgot', { email })
    const code = await getLatestOtpCodeForEmail(email)
    const account = await findAccountRowByEmail(email)
    const accountId = (account as { id: string }).id

    // Estado inconsistente que nunca debería darse por construcción, pero
    // se comprueba de forma defensiva en vez de asumirse.
    await deleteCredentialForTesting(accountId)

    const response = await authApi.post(forgotJar, '/api/auth/password/reset', {
      email,
      code,
      newPassword: NEW_STRONG_PASSWORD,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'expired' })

    // Ninguna sesión se revocó y la solicitud sigue pendiente (nada se
    // consumió a medias sin haber rotado una credencial real).
    expect(await getLatestPasswordResetRequestStatus(accountId)).toBe('pending')
    const sessions = await findSessionRowsForAccount(accountId)
    expect(sessions.every((row) => row.revoked_at === null)).toBe(true)
  })
})
