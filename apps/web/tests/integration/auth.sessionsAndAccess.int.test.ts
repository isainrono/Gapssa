import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'

function freshEmail(): string {
  return `test-${randomUUID()}@example.test`
}

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!'
const DOB = '1990-01-01'

async function freshJarWithCsrf(path = '/es/mi-cuenta/acceder'): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, path)
  return jar
}

async function registerVerifyAndLogin(email: string): Promise<CookieJar> {
  const registerJar = await freshJarWithCsrf('/es/mi-cuenta/registro')
  await authApi.post(registerJar, '/api/auth/register', {
    email,
    password: STRONG_PASSWORD,
    dateOfBirth: DOB,
    locale: 'es',
  })
  const code = await getLatestOtpCodeForEmail(email)
  await authApi.post(registerJar, '/api/auth/verify-email', { email, code })

  const loginJar = await freshJarWithCsrf()
  await authApi.post(loginJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
  return loginJar
}

describe('/[locale]/mi-cuenta — protected by the DAL', () => {
  it('redirects to /acceder when there is no session', async () => {
    const jar = new CookieJar()
    const response = await fetch(`${inject('integrationBaseUrl')}/es/mi-cuenta`, {
      headers: { Cookie: jar.header() },
      redirect: 'manual',
    })
    expect([302, 307]).toContain(response.status)
    expect(response.headers.get('location')).toContain('/es/mi-cuenta/acceder')
  })

  it('renders the dashboard (200) with an active session', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email)

    const response = await fetch(`${inject('integrationBaseUrl')}/es/mi-cuenta`, {
      headers: { Cookie: jar.header() },
      redirect: 'manual',
    })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(email)
  })
})

describe('GET/DELETE /api/auth/sessions', () => {
  it('requires authentication', async () => {
    const jar = new CookieJar()
    const response = await authApi.get(jar, '/api/auth/sessions')
    expect(response.status).toBe(401)
  })

  it('lists the current session marked as isCurrent, and revoking it logs the device out', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email)

    const list = await authApi.get(jar, '/api/auth/sessions')
    expect(list.status).toBe(200)
    const sessions = list.body.sessions as Array<{ id: string; isCurrent: boolean }>
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.isCurrent).toBe(true)

    const revoke = await authApi.delete(jar, `/api/auth/sessions/${sessions[0]?.id}`)
    expect(revoke.status).toBe(200)

    const afterRevoke = await authApi.get(jar, '/api/auth/sessions')
    expect(afterRevoke.status).toBe(401)
  })

  it('revoking another account session id does not affect it and does not reveal whether it exists', async () => {
    const emailA = freshEmail()
    const jarA = await registerVerifyAndLogin(emailA)

    const emailB = freshEmail()
    const jarB = await registerVerifyAndLogin(emailB)
    const sessionsB = (await authApi.get(jarB, '/api/auth/sessions')).body.sessions as Array<{ id: string }>
    const sessionBId = sessionsB[0]?.id as string

    // A intenta revocar la sesión de B.
    const revokeAttempt = await authApi.delete(jarA, `/api/auth/sessions/${sessionBId}`)
    expect(revokeAttempt.status).toBe(200) // idempotente: no revela si existía o no

    // La sesión de B sigue viva.
    const stillActiveForB = await authApi.get(jarB, '/api/auth/sessions')
    expect(stillActiveForB.status).toBe(200)
  })

  it('two concurrent logins for the same account produce two independent sessions, each revocable on its own', async () => {
    const email = freshEmail()
    const registerJar = await freshJarWithCsrf('/es/mi-cuenta/registro')
    await authApi.post(registerJar, '/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      dateOfBirth: DOB,
      locale: 'es',
    })
    const code = await getLatestOtpCodeForEmail(email)
    await authApi.post(registerJar, '/api/auth/verify-email', { email, code })

    const jar1 = await freshJarWithCsrf()
    await authApi.post(jar1, '/api/auth/login', { email, password: STRONG_PASSWORD })
    const jar2 = await freshJarWithCsrf()
    await authApi.post(jar2, '/api/auth/login', { email, password: STRONG_PASSWORD })

    const listFrom1 = await authApi.get(jar1, '/api/auth/sessions')
    expect((listFrom1.body.sessions as unknown[]).length).toBe(2)

    const mySession = (listFrom1.body.sessions as Array<{ id: string; isCurrent: boolean }>).find((s) => s.isCurrent)
    await authApi.delete(jar1, `/api/auth/sessions/${mySession?.id}`)

    // jar1 quedó desconectado; jar2 sigue activo.
    expect((await authApi.get(jar1, '/api/auth/sessions')).status).toBe(401)
    expect((await authApi.get(jar2, '/api/auth/sessions')).status).toBe(200)
  })
})

describe('open redirect protection on /acceder', () => {
  it('sanitizes a malicious "next" parameter server-side before it ever reaches the client component', async () => {
    const jar = new CookieJar()
    const maliciousNext = encodeURIComponent('https://evil.example/phish')
    const response = await fetch(`${inject('integrationBaseUrl')}/es/mi-cuenta/acceder?next=${maliciousNext}`, {
      headers: { Cookie: jar.header() },
    })
    expect(response.status).toBe(200)
    const html = await response.text()

    // Next.js legítimamente incluye la URL solicitada (con su query
    // string) en sus propios metadatos internos de enrutamiento/hidratación
    // (RSC flight data) — eso no es una vulnerabilidad, es cómo el
    // navegador sabe en qué ruta está. Lo que sí sería una vulnerabilidad
    // real es que ese valor sin sanear llegara como prop `next` al
    // componente cliente `LoginForm`, que es lo que de verdad decide a
    // dónde redirige tras el login (`sanitizeRedirectTarget`, ya probado
    // exhaustivamente en `lib/auth/redirectSafety.test.ts`). Por eso la
    // comprobación aquí es específica al prop serializado, no al HTML
    // entero — el flight payload de React va embebido dentro de un
    // string de JavaScript, así que sus propias comillas llegan escapadas
    // con `\"` en el HTML en crudo.
    expect(html).not.toContain('\\"next\\":\\"https://evil.example')
    expect(html).toContain('\\"next\\":\\"/es/mi-cuenta\\"')
  })
})
