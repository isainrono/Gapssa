import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'
import {
  auditRowsForEntity,
  findAccountRowByEmail,
  getIndependenceRequestOtpChallengeId,
  getIndependenceRequestStatus,
  setAccountDateOfBirthForTesting,
  setIndependenceRequestStatusForTesting,
} from './authDb'
import { ADULT_DOB, MINOR_DOB } from './dobFixtures'
import { expireIndependenceOtpChallenge } from './redisTestHelper'

/**
 * Revisión 4 de Fase 3 — política de challenge exacto en
 * `completeIndependenceRequest` (repository.ts). Antes de esta revisión, la
 * comprobación `otpChallengeId !== challengeId` solo se aplicaba cuando
 * `request.status === 'pending'`: una solicitud `confirmed` heredada (cuenta
 * todavía `pending`, el estado inconsistente que la propia función
 * reconcilia) aceptaba CUALQUIER OTP de propósito `independence_confirmation`
 * válido para la cuenta, sin comprobar que perteneciera a esa solicitud
 * concreta. La matriz de pruebas de esta suite cubre exactamente los seis
 * casos pedidos para la corrección — ver el comentario completo de
 * `completeIndependenceRequest` (repository.ts) para el razonamiento y la
 * vía de reconciliación explícita (pedir un reto nuevo) cuando el original
 * ya no es válido.
 */

function freshEmail(): string {
  return `test-${randomUUID()}@example.test`
}

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!'

async function freshJarWithCsrf(path = '/es/mi-cuenta/registro'): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, path)
  return jar
}

async function registerVerifyAndLogin(email: string, dateOfBirth: string): Promise<CookieJar> {
  const registerJar = await freshJarWithCsrf()
  await authApi.post(registerJar, '/api/auth/register', {
    email,
    password: STRONG_PASSWORD,
    dateOfBirth,
    locale: 'es',
  })
  const code = await getLatestOtpCodeForEmail(email)
  await authApi.post(registerJar, '/api/auth/verify-email', { email, code })

  const loginJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
  await authApi.post(loginJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
  return loginJar
}

async function accountIdFromEmail(email: string): Promise<string> {
  const row = await findAccountRowByEmail(email)
  return (row as { id: string }).id
}

/** Cuenta adulta con al menos un vínculo de tutela histórico — el estado mínimo elegible para independencia (mismo patrón que auth.guardianIndependence.int.test.ts). */
async function setUpEligibleAdultWithGuardianHistory(): Promise<{ jar: CookieJar; email: string; accountId: string }> {
  const minorEmail = freshEmail()
  const minorJar = await registerVerifyAndLogin(minorEmail, MINOR_DOB)
  const minorAccountId = await accountIdFromEmail(minorEmail)
  const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

  const link = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
  if (link.status !== 201) throw new Error(`No se pudo crear el vínculo de tutela: ${JSON.stringify(link.body)}`)

  const pendingLinks = (await authApi.get(minorJar, '/api/auth/guardian/link-requests')).body as {
    asMinor: Array<{ id: string }>
  }
  const linkId = pendingLinks.asMinor[0]?.id as string
  await authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`)

  await setAccountDateOfBirthForTesting(minorAccountId, ADULT_DOB)

  return { jar: minorJar, email: minorEmail, accountId: minorAccountId }
}

async function requestIndependence(jar: CookieJar, email: string): Promise<{ requestId: string; code: string }> {
  const request = await authApi.post(jar, '/api/auth/independence-requests')
  if (request.status !== 202) throw new Error(`No se pudo crear la solicitud de independencia: ${JSON.stringify(request.body)}`)
  const requestId = request.body.requestId as string
  const code = await getLatestOtpCodeForEmail(email)
  if (!code) throw new Error(`No se encontró código OTP para ${email}`)
  return { requestId, code }
}

describe('completeIndependenceRequest — exact challenge policy (revisión 4 de Fase 3)', () => {
  it('1) a normal pending request with its own correct challenge grants independence', async () => {
    const { jar, email, accountId } = await setUpEligibleAdultWithGuardianHistory()
    const { requestId, code } = await requestIndependence(jar, email)

    const confirm = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })

    expect(confirm.status).toBe(200)
    expect(confirm.body).toEqual({ status: 'granted' })
    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('granted')
    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(1)
  })

  it('2) a pending request never accepts the challenge of a different request for the same account', async () => {
    const { jar, email } = await setUpEligibleAdultWithGuardianHistory()
    const first = await requestIndependence(jar, email)
    // Una segunda solicitud invalida en Redis el reto de la primera (mismo
    // propósito+sujeto) — el único código vigente ahora es el de la segunda.
    const second = await requestIndependence(jar, email)

    const response = await authApi.post(jar, `/api/auth/independence-requests/${first.requestId}/confirm`, {
      code: second.code,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'invalid_code' })
    expect(await getIndependenceRequestStatus(first.requestId)).toBe('pending')
    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('pending')
  })

  it('3) a legacy confirmed-but-pending request reconciles with its OWN original challenge, still current', async () => {
    const { jar, email, accountId } = await setUpEligibleAdultWithGuardianHistory()
    const { requestId, code } = await requestIndependence(jar, email)

    // Simula el estado heredado: la solicitud ya quedó "confirmed" (primera
    // mitad de la versión de dos transacciones anterior a la revisión 3),
    // pero la cuenta sigue "pending" — el OTP original sigue sin consumirse
    // en Redis.
    await setIndependenceRequestStatusForTesting(requestId, 'confirmed')

    const confirm = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })

    expect(confirm.status).toBe(200)
    expect(confirm.body).toEqual({ status: 'granted' })
    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('granted')
    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(1)
  })

  it('4) a legacy confirmed-but-pending request NEVER accepts a different (later) challenge of the same account — the bug this revision fixes', async () => {
    const { jar, email, accountId } = await setUpEligibleAdultWithGuardianHistory()
    const legacy = await requestIndependence(jar, email)
    await setIndependenceRequestStatusForTesting(legacy.requestId, 'confirmed')

    // Una solicitud nueva, posterior, con su propio reto — antes de esta
    // revisión, este código habría bastado para "reconciliar" la solicitud
    // heredada sin ninguna relación real con ella.
    const later = await requestIndependence(jar, email)

    const response = await authApi.post(jar, `/api/auth/independence-requests/${legacy.requestId}/confirm`, {
      code: later.code,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'invalid_code' })
    // Ni la solicitud heredada ni la cuenta transicionaron por esta vía.
    expect(await getIndependenceRequestStatus(legacy.requestId)).toBe('confirmed')
    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('pending')
    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(0)

    // Vía de reconciliación explícita y segura: la solicitud NUEVA, atada a
    // su propio reto desde el principio, sí completa con su propio código.
    const reconcile = await authApi.post(jar, `/api/auth/independence-requests/${later.requestId}/confirm`, {
      code: later.code,
    })
    expect(reconcile.status).toBe(200)
    expect(reconcile.body).toEqual({ status: 'granted' })
  })

  it('5) a legacy confirmed-but-pending request whose original challenge has expired is rejected, never granted with a stand-in code', async () => {
    const { jar, email, accountId } = await setUpEligibleAdultWithGuardianHistory()
    const { requestId, code } = await requestIndependence(jar, email)
    await setIndependenceRequestStatusForTesting(requestId, 'confirmed')

    const challengeId = await getIndependenceRequestOtpChallengeId(requestId)
    if (!challengeId) throw new Error('No se encontró otp_challenge_id para la solicitud de prueba')
    // Simula que el reto original ya caducó/fue purgado de Redis — el
    // propio código ya no puede verificarse, ni siquiera contra sí mismo.
    await expireIndependenceOtpChallenge(accountId, challengeId)

    const response = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'expired' })
    expect(await getIndependenceRequestStatus(requestId)).toBe('confirmed')
    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('pending')
  })

  it('6) repeating confirm after reconciling is idempotent — no double grant, no duplicate audit', async () => {
    const { jar, email, accountId } = await setUpEligibleAdultWithGuardianHistory()
    const { requestId, code } = await requestIndependence(jar, email)
    await setIndependenceRequestStatusForTesting(requestId, 'confirmed')

    const first = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ status: 'granted' })

    const second = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ status: 'granted' })

    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('granted')
    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(1)
    const requestAudits = await auditRowsForEntity('IndependenceRequest', requestId)
    expect(requestAudits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(1)
  })
})
