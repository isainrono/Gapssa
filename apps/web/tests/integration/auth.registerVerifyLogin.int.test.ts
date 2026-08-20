import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'
import { countAccountsByEmail } from './authDb'

/**
 * Contra el servidor Next real de la suite de integración
 * (`global-setup.ts`), con `gapssa_auth_test_<random>` ya migrada y un
 * buzón SMTP efímero de pruebas (`mailbox.ts`) — nunca contra
 * `gapssa_auth` real ni un SMTP real.
 */

function freshEmail(): string {
  return `test-${randomUUID()}@example.test`
}

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!'
const DOB = '1990-01-01'

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es/mi-cuenta/registro')
  return jar
}

async function registerAndVerify(email: string): Promise<CookieJar> {
  const jar = await freshJarWithCsrf()
  await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
  const code = await getLatestOtpCodeForEmail(email)
  if (!code) throw new Error(`No se encontró código OTP para ${email}`)
  await authApi.post(jar, '/api/auth/verify-email', { email, code })
  return jar
}

describe('POST /api/auth/register', () => {
  it('registers a new account and returns the generic 202 message', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()

    const response = await authApi.post(jar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: DOB,
      locale: 'es',
    })

    expect(response.status).toBe(202)
    expect(await countAccountsByEmail(email)).toBe(1)
  })

  it('rejects a weak password without creating an account', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()

    const response = await authApi.post(jar, '/api/auth/register', {
      email,
      password: 'short1!',
      dateOfBirth: DOB,
      locale: 'es',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'weak_password' })
    expect(await countAccountsByEmail(email)).toBe(0)
  })

  it('registering the same email twice returns the identical generic response and never creates a second account', async () => {
    const email = freshEmail()

    const firstJar = await freshJarWithCsrf()
    const first = await authApi.post(firstJar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: DOB,
      locale: 'es',
    })

    const secondJar = await freshJarWithCsrf()
    const second = await authApi.post(secondJar, '/api/auth/register', {
      email,
      password: 'A-Different-Password-99!',
      dateOfBirth: DOB,
      locale: 'es',
    })

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(second.body).toEqual(first.body)
    expect(await countAccountsByEmail(email)).toBe(1)
  })

  it('rejects a request missing the CSRF header', async () => {
    const jar = await freshJarWithCsrf()
    const response = await authApi.post(
      jar,
      '/api/auth/register',
      { email: freshEmail(), password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' },
      { omitCsrf: true },
    )
    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({ code: 'csrf_invalid' })
  })

  it.each([
    ['2026-02-31', 'Feb 31 does not exist'],
    ['2026-04-31', 'Apr 31 does not exist'],
    ['2026-13-01', 'month 13 does not exist'],
    ['2026-01-00', 'day 00 does not exist'],
  ])('rejects an impossible calendar date (%s: %s) instead of silently normalizing it', async (dateOfBirth) => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()

    const response = await authApi.post(jar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth,
      locale: 'es',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'invalid_date_of_birth' })
    expect(await countAccountsByEmail(email)).toBe(0)
  })

  it('rejects a future date of birth', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()
    const oneYearFromNow = new Date()
    oneYearFromNow.setUTCFullYear(oneYearFromNow.getUTCFullYear() + 1)

    const response = await authApi.post(jar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: oneYearFromNow.toISOString().slice(0, 10),
      locale: 'es',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'invalid_date_of_birth' })
  })

  it('accepts Feb 29 on a real leap year', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()

    const response = await authApi.post(jar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: '2000-02-29',
      locale: 'es',
    })

    expect(response.status).toBe(202)
    expect(await countAccountsByEmail(email)).toBe(1)
  })

  it('rejects Feb 29 on a non-leap year', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()

    const response = await authApi.post(jar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: '2001-02-29',
      locale: 'es',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'invalid_date_of_birth' })
    expect(await countAccountsByEmail(email)).toBe(0)
  })

  it('revisión 2 de Fase 3 — re-registering an email still pending_verification issues a fresh verification code instead of a dead end', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()
    await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
    const firstCode = await getLatestOtpCodeForEmail(email)

    const secondJar = await freshJarWithCsrf()
    const second = await authApi.post(secondJar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: DOB,
      locale: 'es',
    })
    expect(second.status).toBe(202)
    const secondCode = await getLatestOtpCodeForEmail(email)

    // El primer código quedó invalidado (mismo propósito+sujeto, un solo
    // reto vivo a la vez) — solo el reemitido por el segundo intento sirve.
    expect(secondCode).toBeTruthy()
    expect(secondCode).not.toBe(null)

    const verifyWithOldCode = await authApi.post(jar, '/api/auth/verify-email', { email, code: firstCode })
    expect(verifyWithOldCode.status).not.toBe(200)

    const verifyWithNewCode = await authApi.post(jar, '/api/auth/verify-email', { email, code: secondCode })
    expect(verifyWithNewCode.status).toBe(200)

    expect(await countAccountsByEmail(email)).toBe(1)
  })

  it('concurrent duplicate registrations for the same email never produce two accounts', async () => {
    const email = freshEmail()
    const jars = await Promise.all([freshJarWithCsrf(), freshJarWithCsrf(), freshJarWithCsrf()])

    const responses = await Promise.all(
      jars.map((jar) =>
        authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' }),
      ),
    )

    expect(responses.every((response) => response.status === 202)).toBe(true)
    expect(await countAccountsByEmail(email)).toBe(1)
  })
})

describe('POST /api/auth/verify-email', () => {
  it('verifies with the correct code and activates the account', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()
    await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
    const code = await getLatestOtpCodeForEmail(email)

    const response = await authApi.post(jar, '/api/auth/verify-email', { email, code })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'verified' })
  })

  it('an unknown account always resolves to the same generic "expired" outcome, consistently across attempts', async () => {
    // Alcance real de esta garantía, documentado en
    // docs/fase3-autenticacion.md §9: justo después de registrarse, una
    // cuenta real SÍ tiene un reto de verificación activo, y un código
    // incorrecto contra ese reto devuelve "invalid_code" — distinto de
    // una cuenta inexistente ("expired"). Esa distinción es inherente a
    // cualquier verificación por código funcional (existe una ventana
    // breve en la que "esta cuenta se está registrando ahora mismo" es
    // observable) y no se intenta ocultar aquí, porque tapar esa señal
    // exigiría desactivar el propio mecanismo de intentos limitados. Lo
    // que sí se garantiza, y es lo que importa para no poder enumerar
    // cuentas por correo: **ninguna** cuenta inexistente obtiene jamás
    // "invalid_code", "already_consumed" o "locked" — siempre el mismo
    // "expired" genérico, sin importar cuántas veces se intente.
    const jarUnknown = await freshJarWithCsrf()
    const email = freshEmail()

    const firstAttempt = await authApi.post(jarUnknown, '/api/auth/verify-email', { email, code: '111111' })
    const secondAttempt = await authApi.post(jarUnknown, '/api/auth/verify-email', { email, code: '222222' })

    expect(firstAttempt.status).toBe(400)
    expect(firstAttempt.body).toEqual({ error: { code: 'expired', message: 'El código ha caducado. Solicita uno nuevo.' } })
    expect(secondAttempt.body).toEqual(firstAttempt.body)
  })

  it('revisión 2 de Fase 3 — resubmitting the SAME correct code after success is idempotent (recovery design): returns verified again, not an error', async () => {
    // El propósito de esto no es dejar "verificar dos veces" como una
    // operación con sentido de negocio — es que un reintento legítimo del
    // MISMO código correcto (p. ej. el cliente reintenta tras un timeout
    // de red, sin saber si la primera petición completó la activación en
    // Postgres) nunca debe quedar bloqueado con "already_consumed" para
    // siempre. verifyOtp ya sabe, incluso con el reto consumido, si el
    // código recién enviado es criptográficamente el correcto
    // (`codeMatchesConsumedChallenge`) — ver otpService.ts/repository.ts.
    const email = freshEmail()
    const jar = await freshJarWithCsrf()
    await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
    const code = await getLatestOtpCodeForEmail(email)

    const first = await authApi.post(jar, '/api/auth/verify-email', { email, code })
    const second = await authApi.post(jar, '/api/auth/verify-email', { email, code })

    expect(first.status).toBe(200)
    expect(first.body).toEqual({ status: 'verified' })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ status: 'verified' })
  })

  it('a WRONG code submitted after the challenge was already consumed still fails as already_consumed (no recovery without proving the real code)', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()
    await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })
    const code = await getLatestOtpCodeForEmail(email)

    const first = await authApi.post(jar, '/api/auth/verify-email', { email, code })
    expect(first.status).toBe(200)

    const wrongCode = code === '000000' ? '111111' : '000000'
    const second = await authApi.post(jar, '/api/auth/verify-email', { email, code: wrongCode })

    expect(second.status).toBe(400)
    expect(second.body.error).toMatchObject({ code: 'already_consumed' })
  })

  it('locks after enough wrong attempts (OTP_MAX_ATTEMPTS)', async () => {
    const email = freshEmail()
    const jar = await freshJarWithCsrf()
    await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: DOB, locale: 'es' })

    const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS ?? '5')
    let lastResponse
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      lastResponse = await authApi.post(jar, '/api/auth/verify-email', { email, code: '000000' })
    }

    expect(lastResponse?.status).toBe(429)
    expect(lastResponse?.body.error).toMatchObject({ code: 'locked' })

    // Incluso el código correcto ya no sirve una vez bloqueado.
    const correctCode = await getLatestOtpCodeForEmail(email)
    const afterLock = await authApi.post(jar, '/api/auth/verify-email', { email, code: correctCode })
    expect(afterLock.status).not.toBe(200)
  })
})

describe('POST /api/auth/login', () => {
  let verifiedEmail: string

  beforeEach(async () => {
    verifiedEmail = freshEmail()
    await registerAndVerify(verifiedEmail)
  })

  it('logs in with correct credentials and sets a session cookie', async () => {
    const jar = await freshJarWithCsrf()
    const response = await authApi.post(jar, '/api/auth/login', { email: verifiedEmail, password: STRONG_PASSWORD })

    expect(response.status).toBe(200)
    expect(jar.get('gapssa_session')).toBeTruthy()
  })

  it('rejects an unverified account only after confirming the password is correct', async () => {
    const email = freshEmail()
    const registerJar = await freshJarWithCsrf()
    await authApi.post(registerJar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: DOB,
      locale: 'es',
    })

    const loginJar = await freshJarWithCsrf()
    const wrongPassword = await authApi.post(loginJar, '/api/auth/login', { email, password: 'totally-wrong-99!' })
    const rightPassword = await authApi.post(loginJar, '/api/auth/login', { email, password: STRONG_PASSWORD })

    expect(wrongPassword.body.error).toMatchObject({ code: 'invalid_credentials' })
    expect(rightPassword.status).toBe(403)
    expect(rightPassword.body.error).toMatchObject({ code: 'account_not_verified' })
  })

  it('non-enumeration: nonexistent account and wrong password for a real account return identical responses', async () => {
    const jarA = await freshJarWithCsrf()
    const forNonexistent = await authApi.post(jarA, '/api/auth/login', {
      email: freshEmail(),
      password: 'whatever-password-99!',
    })

    const jarB = await freshJarWithCsrf()
    const forWrongPassword = await authApi.post(jarB, '/api/auth/login', {
      email: verifiedEmail,
      password: 'wrong-password-99!',
    })

    expect(forNonexistent.status).toBe(forWrongPassword.status)
    expect(forNonexistent.body).toEqual(forWrongPassword.body)
  })

  it('rejects a request missing the CSRF header', async () => {
    const jar = await freshJarWithCsrf()
    const response = await authApi.post(
      jar,
      '/api/auth/login',
      { email: verifiedEmail, password: STRONG_PASSWORD },
      { omitCsrf: true },
    )
    expect(response.status).toBe(403)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the session so the protected dashboard redirects afterwards', async () => {
    const email = freshEmail()
    const jar = await registerAndVerify(email)
    await authApi.post(jar, '/api/auth/login', { email, password: STRONG_PASSWORD })

    const beforeLogout = await authApi.get(jar, '/api/auth/sessions')
    expect(beforeLogout.status).toBe(200)

    const logout = await authApi.post(jar, '/api/auth/logout')
    expect(logout.status).toBe(200)

    const afterLogout = await authApi.get(jar, '/api/auth/sessions')
    expect(afterLogout.status).toBe(401)
  })

  it('is idempotent: logging out with no active session still returns 200', async () => {
    const jar = await freshJarWithCsrf()
    const response = await authApi.post(jar, '/api/auth/logout')
    expect(response.status).toBe(200)
  })
})
