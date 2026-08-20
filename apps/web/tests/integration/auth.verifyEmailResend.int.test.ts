import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'

/**
 * `POST /api/auth/verify-email/resend` — revisión 2 de Fase 3. Antes de
 * esta revisión no existía ninguna ruta explícita para reenviar un código
 * a una cuenta `pending_verification` cuyo primer correo nunca llegó o
 * cuyo código caducó.
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

describe('POST /api/auth/verify-email/resend', () => {
  it('issues a new code for a pending_verification account, and the new code verifies the account', async () => {
    const email = freshEmail()
    const registerJar = await freshJarWithCsrf('/es/mi-cuenta/registro')
    await authApi.post(registerJar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })

    const resendJar = await freshJarWithCsrf()
    const resend = await authApi.post(resendJar, '/api/auth/verify-email/resend', { email })
    expect(resend.status).toBe(202)

    const code = await getLatestOtpCodeForEmail(email)
    const verify = await authApi.post(resendJar, '/api/auth/verify-email', { email, code })
    expect(verify.status).toBe(200)
    expect(verify.body).toEqual({ status: 'verified' })
  })

  it('invalidates the previous code — only the resent one verifies', async () => {
    const email = freshEmail()
    const registerJar = await freshJarWithCsrf('/es/mi-cuenta/registro')
    await authApi.post(registerJar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
    const firstCode = await getLatestOtpCodeForEmail(email)

    const resendJar = await freshJarWithCsrf()
    await authApi.post(resendJar, '/api/auth/verify-email/resend', { email })
    const secondCode = await getLatestOtpCodeForEmail(email)
    expect(secondCode).not.toBe(null)

    const verifyWithOldCode = await authApi.post(resendJar, '/api/auth/verify-email', { email, code: firstCode })
    expect(verifyWithOldCode.status).not.toBe(200)

    const verifyWithNewCode = await authApi.post(resendJar, '/api/auth/verify-email', { email, code: secondCode })
    expect(verifyWithNewCode.status).toBe(200)
  })

  it('returns the identical generic response for a nonexistent email, an already-active account, and a genuinely pending one — no enumeration', async () => {
    const activeEmail = freshEmail()
    const activeJar = await freshJarWithCsrf('/es/mi-cuenta/registro')
    await authApi.post(activeJar, '/api/auth/register', { email: activeEmail, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
    const activeCode = await getLatestOtpCodeForEmail(activeEmail)
    await authApi.post(activeJar, '/api/auth/verify-email', { email: activeEmail, code: activeCode })

    const pendingEmail = freshEmail()
    const pendingJar = await freshJarWithCsrf('/es/mi-cuenta/registro')
    await authApi.post(pendingJar, '/api/auth/register', { email: pendingEmail, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })

    const forNonexistent = await authApi.post(await freshJarWithCsrf(), '/api/auth/verify-email/resend', { email: freshEmail() })
    const forActive = await authApi.post(await freshJarWithCsrf(), '/api/auth/verify-email/resend', { email: activeEmail })
    const forPending = await authApi.post(await freshJarWithCsrf(), '/api/auth/verify-email/resend', { email: pendingEmail })

    expect(forNonexistent.status).toBe(202)
    expect(forActive.status).toBe(202)
    expect(forPending.status).toBe(202)
    expect(forNonexistent.body).toEqual(forActive.body)
    expect(forActive.body).toEqual(forPending.body)
  })

  it('does not send a new code for an already-active account (no email queued)', async () => {
    const email = freshEmail()
    const registerJar = await freshJarWithCsrf('/es/mi-cuenta/registro')
    await authApi.post(registerJar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
    const code = await getLatestOtpCodeForEmail(email)
    await authApi.post(registerJar, '/api/auth/verify-email', { email, code })

    await authApi.post(await freshJarWithCsrf(), '/api/auth/verify-email/resend', { email })

    // Sin una nueva solicitud pendiente, el reto de la verificación
    // original (ya consumida) sigue siendo lo único que existe en Redis
    // para esta cuenta+propósito hasta que expire su TTL — un código
    // cualquiera contra él es "already_consumed" (reutilización de un reto
    // ya gastado), nunca "invalid_code": ese código sí indicaría que
    // resend emitió un reto NUEVO y vivo contra el que se puede seguir
    // intentando, que es justo lo que esta prueba comprueba que NO pasa.
    const verify = await authApi.post(await freshJarWithCsrf(), '/api/auth/verify-email', { email, code: '000000' })
    expect(verify.body.error).not.toMatchObject({ code: 'invalid_code' })
    expect(verify.status).not.toBe(200)
  })

  it('rejects a request missing the CSRF header', async () => {
    const jar = await freshJarWithCsrf()
    const response = await authApi.post(jar, '/api/auth/verify-email/resend', { email: freshEmail() }, { omitCsrf: true })
    expect(response.status).toBe(403)
  })
})
