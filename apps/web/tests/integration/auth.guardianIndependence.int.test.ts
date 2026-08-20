import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'
import {
  auditRowsForEntity,
  findAccountRowByEmail,
  findGuardianLinkRow,
  getGuardianLinkStatus,
  getIndependenceRequestStatus,
  setAccountDateOfBirthForTesting,
  setAccountStatusForTesting,
  setIndependenceRequestStatusForTesting,
} from './authDb'
import { ADULT_DOB, ALMOST_ADULT_MINOR_DOB, MINOR_DOB, RECENTLY_ADULT_DOB } from './dobFixtures'

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

/**
 * Deja lista una cuenta adulta con al menos un vínculo de tutela histórico
 * (confirmado y luego "envejecida" hasta la mayoría de edad) — el estado
 * mínimo elegible para solicitar independencia, reutilizado por varias
 * pruebas de `completeIndependenceRequest` (revisión 3 de Fase 3).
 */
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

describe('guardian links — real tutor/minor validation (revisión 2 de Fase 3)', () => {
  it('a guardian request stays pending until the minor confirms it, and only then does the link become active', async () => {
    const minorEmail = freshEmail()
    const minorJar = await registerVerifyAndLogin(minorEmail, MINOR_DOB)

    const guardianEmail = freshEmail()
    const guardianJar = await registerVerifyAndLogin(guardianEmail, ADULT_DOB)

    const request = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    expect(request.status).toBe(201)
    expect(request.body).toEqual({ status: 'pending_minor_confirmation' })

    const linkId = (await authApi.get(minorJar, '/api/auth/guardian/link-requests')).body as {
      asMinor: Array<{ id: string; status: string }>
    }
    const pendingLink = linkId.asMinor[0]
    expect(pendingLink?.status).toBe('pending_minor_confirmation')

    const confirm = await authApi.post(minorJar, `/api/auth/guardian/link-requests/${pendingLink?.id}/confirm`)
    expect(confirm.status).toBe(200)
    expect(confirm.body).toEqual({ status: 'active' })
  })

  it('rejects a self-link request', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)

    const response = await authApi.post(jar, '/api/auth/guardian/link-requests', { minorEmail: email })
    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'self_link_not_allowed' })
  })

  it('rejects a duplicate live link request from the same guardian', async () => {
    const minorEmail = freshEmail()
    await registerVerifyAndLogin(minorEmail, MINOR_DOB)
    const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

    const first = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    expect(first.status).toBe(201)

    const second = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    expect(second.status).toBe(409)
    expect(second.body.error).toMatchObject({ code: 'duplicate_link' })
  })

  it('an adult account cannot be targeted as a minor — generic invalid_target response, not a differentiable one', async () => {
    const adultTargetEmail = freshEmail()
    await registerVerifyAndLogin(adultTargetEmail, ADULT_DOB)
    const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

    const response = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail: adultTargetEmail })
    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'invalid_guardian_link_request' })
  })

  it('a nonexistent target email gets the SAME generic response as an adult target — no enumeration of age/existence', async () => {
    const adultTargetEmail = freshEmail()
    await registerVerifyAndLogin(adultTargetEmail, ADULT_DOB)
    const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

    const forAdultTarget = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail: adultTargetEmail })
    const forNonexistentTarget = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail: freshEmail() })

    expect(forAdultTarget.status).toBe(forNonexistentTarget.status)
    expect(forAdultTarget.body).toEqual(forNonexistentTarget.body)
  })

  it('a minor account cannot act as a guardian (requester must be an adult, active, verified account)', async () => {
    const minorGuardianEmail = freshEmail()
    const minorGuardianJar = await registerVerifyAndLogin(minorGuardianEmail, MINOR_DOB)
    const targetEmail = freshEmail()
    await registerVerifyAndLogin(targetEmail, MINOR_DOB)

    const response = await authApi.post(minorGuardianJar, '/api/auth/guardian/link-requests', { minorEmail: targetEmail })
    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({ code: 'requester_not_eligible' })
  })

  it('rejects confirmation once the target account is no longer a minor (turned 18 while the request was pending)', async () => {
    const minorEmail = freshEmail()
    const minorJar = await registerVerifyAndLogin(minorEmail, ALMOST_ADULT_MINOR_DOB)
    const minorAccountId = await accountIdFromEmail(minorEmail)
    const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

    const request = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    expect(request.status).toBe(201)

    // Simula "el tiempo pasó y cumplió 18" reescribiendo la fecha de
    // nacimiento directamente en la base — confirmGuardianLink debe volver
    // a comprobar la edad en el momento de confirmar, no solo al solicitar.
    await setAccountDateOfBirthForTesting(minorAccountId, RECENTLY_ADULT_DOB)

    const links = (await authApi.get(minorJar, '/api/auth/guardian/link-requests')).body as {
      asMinor: Array<{ id: string }>
    }
    const linkId = links.asMinor[0]?.id as string

    const confirm = await authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`)
    expect(confirm.status).toBe(409)
    expect(confirm.body.error).toMatchObject({ code: 'target_not_eligible' })
  })

  it('enforces a hard maximum of two live guardians per minor, even with concurrent requests', async () => {
    const minorEmail = freshEmail()
    await registerVerifyAndLogin(minorEmail, MINOR_DOB)

    const guardianJars = await Promise.all(
      Array.from({ length: 4 }, () => registerVerifyAndLogin(freshEmail(), ADULT_DOB)),
    )

    // Las 4 solicitudes se disparan a la vez — la protección real es el
    // bloqueo de fila dentro de la transacción (guardian.ts), no el orden
    // de llegada aquí.
    const results = await Promise.all(
      guardianJars.map((jar) => authApi.post(jar, '/api/auth/guardian/link-requests', { minorEmail })),
    )

    const created = results.filter((result) => result.status === 201)
    const rejected = results.filter((result) => result.status === 409)

    expect(created).toHaveLength(2)
    expect(rejected).toHaveLength(2)
    expect(rejected.every((result) => (result.body.error as { code?: string } | undefined)?.code === 'max_guardians_reached')).toBe(true)
  })

  it('re-validates the target under lock — a minor suspended right before the request begins is rejected with the same generic invalid_target, never linked (revisión 3)', async () => {
    const minorEmail = freshEmail()
    await registerVerifyAndLogin(minorEmail, MINOR_DOB)
    const minorAccountId = await accountIdFromEmail(minorEmail)
    const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

    await setAccountStatusForTesting(minorAccountId, 'suspended')

    const response = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({ code: 'invalid_guardian_link_request' })

    const links = (await authApi.get(guardianJar, '/api/auth/guardian/link-requests')).body as {
      asGuardian: unknown[]
    }
    expect(links.asGuardian).toHaveLength(0)
  })

  it('re-validates the requester under lock — a guardian suspended right before the request begins is rejected, never linked (revisión 3; revisión 5: rejected as unauthenticated before ever reaching guardian.ts)', async () => {
    const minorEmail = freshEmail()
    await registerVerifyAndLogin(minorEmail, MINOR_DOB)
    const minorAccountId = await accountIdFromEmail(minorEmail)
    const guardianEmail = freshEmail()
    const guardianJar = await registerVerifyAndLogin(guardianEmail, ADULT_DOB)
    const guardianAccountId = await accountIdFromEmail(guardianEmail)

    await setAccountStatusForTesting(guardianAccountId, 'suspended')

    // Revisión 5 de Fase 3: a diferencia del menor suspendido (prueba de
    // arriba, cuya sesión — la del TUTOR que solicita — sigue siendo
    // válida), aquí quien queda suspendido es el propio dueño de la
    // sesión que hace la petición. `getActiveSessionFromCookies` ya
    // rechaza esa sesión (cuenta no `active`) antes de que la petición
    // llegue a `requestGuardianLink` — nunca alcanza `requester_not_eligible`
    // (business-logic), sino `unauthenticated` (auth-gate), un rechazo
    // todavía más temprano y más correcto. El invariante que esta prueba
    // protege sigue siendo el mismo: nunca se crea el vínculo.
    const response = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    expect(response.status).toBe(401)
    expect(response.body.error).toMatchObject({ code: 'unauthenticated' })

    const link = await findGuardianLinkRow(guardianAccountId, minorAccountId)
    expect(link).toBeNull()
  })

  it('a link created concurrently with the minor deleting their own account never post-dates the deletion — the row-lock ordering is real, not decided on stale pre-transaction data', async () => {
    const minorEmail = freshEmail()
    const minorJar = await registerVerifyAndLogin(minorEmail, MINOR_DOB)
    const minorAccountId = await accountIdFromEmail(minorEmail)
    const guardianEmail = freshEmail()
    const guardianJar = await registerVerifyAndLogin(guardianEmail, ADULT_DOB)
    const guardianAccountId = await accountIdFromEmail(guardianEmail)

    const [linkResponse] = await Promise.all([
      authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail }),
      authApi.post(minorJar, '/api/auth/account/delete-request'),
    ])

    // Nunca un error de servidor — o el vínculo se crea (si ganó la
    // solicitud de tutela) o se rechaza genéricamente (si ganó la
    // eliminación), pero nunca las dos cosas a la vez de forma inconsistente.
    expect([201, 400]).toContain(linkResponse.status)

    const minorAccount = await findAccountRowByEmail(minorEmail)
    const linkRow = await findGuardianLinkRow(guardianAccountId, minorAccountId)

    if (linkRow && (minorAccount as { status: string }).status === 'pending_deletion') {
      // El único orden válido para que ambas cosas coexistan es que el
      // vínculo se creara ANTES de que la eliminación se confirmara — nunca
      // al revés. Ver el bloqueo determinista por UUID en guardian.ts: si
      // la comprobación de elegibilidad usara datos leídos antes de abrir
      // la transacción (el bug corregido en la revisión 3), un vínculo
      // podría crearse con un `createdAt` posterior a la eliminación.
      const linkCreatedAt = new Date((linkRow as { created_at: string | Date }).created_at).getTime()
      const accountUpdatedAt = new Date((minorAccount as { updated_at: string | Date }).updated_at).getTime()
      expect(linkCreatedAt).toBeLessThanOrEqual(accountUpdatedAt)
    }
  })

  it('a guardian or the minor can revoke a live link, and the minor stops appearing linked', async () => {
    const minorEmail = freshEmail()
    const minorJar = await registerVerifyAndLogin(minorEmail, MINOR_DOB)
    const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

    await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    const links = (await authApi.get(minorJar, '/api/auth/guardian/link-requests')).body as {
      asMinor: Array<{ id: string }>
    }
    const linkId = links.asMinor[0]?.id as string

    const revoke = await authApi.post(guardianJar, `/api/auth/guardian/link-requests/${linkId}/revoke`)
    expect(revoke.status).toBe(200)
    expect(revoke.body).toEqual({ status: 'revoked' })

    const revokeAgain = await authApi.post(guardianJar, `/api/auth/guardian/link-requests/${linkId}/revoke`)
    expect(revokeAgain.status).toBe(409)
    expect(revokeAgain.body.error).toMatchObject({ code: 'not_live' })
  })

  it('a concurrent confirm and revoke on the same link never resurrect a revoked link — the link always ends up revoked', async () => {
    const minorEmail = freshEmail()
    const minorJar = await registerVerifyAndLogin(minorEmail, MINOR_DOB)
    const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

    await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    const links = (await authApi.get(minorJar, '/api/auth/guardian/link-requests')).body as {
      asMinor: Array<{ id: string }>
    }
    const linkId = links.asMinor[0]?.id as string

    const [confirmResult, revokeResult] = await Promise.all([
      authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`),
      authApi.post(guardianJar, `/api/auth/guardian/link-requests/${linkId}/revoke`),
    ])

    // Ambas peticiones responden con éxito o con un estado ya avanzado —
    // nunca con un error de servidor ni con una resurrección silenciosa.
    expect([200, 409]).toContain(confirmResult.status)
    expect([200, 409]).toContain(revokeResult.status)

    const finalStatus = await getGuardianLinkStatus(linkId)
    expect(finalStatus).toBe('revoked')
  })
})

describe('independence requests', () => {
  it('an adult account with a (historical) guardian link is eligible; confirming with the OTP grants independence', async () => {
    // El vínculo de tutela solo puede crearse mientras el objetivo es
    // realmente menor (guardian.ts, revisión 2 de Fase 3) — así que esta
    // prueba registra a la joven como menor, confirma el vínculo, y SOLO
    // DESPUÉS simula que cumplió 18 (mismo mecanismo que la prueba de
    // "turned 18 while pending" de arriba). La independencia exige ser
    // adulto AHORA con al menos un vínculo histórico, no en el momento en
    // que se creó el vínculo.
    const minorEmail = freshEmail()
    const minorJar = await registerVerifyAndLogin(minorEmail, MINOR_DOB)
    const minorAccountId = await accountIdFromEmail(minorEmail)
    const guardianJar = await registerVerifyAndLogin(freshEmail(), ADULT_DOB)

    const link = await authApi.post(guardianJar, '/api/auth/guardian/link-requests', { minorEmail })
    expect(link.status).toBe(201)

    const pendingLinks = (await authApi.get(minorJar, '/api/auth/guardian/link-requests')).body as {
      asMinor: Array<{ id: string }>
    }
    const linkId = pendingLinks.asMinor[0]?.id as string
    const confirmLink = await authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`)
    expect(confirmLink.status).toBe(200)

    await setAccountDateOfBirthForTesting(minorAccountId, ADULT_DOB)

    const request = await authApi.post(minorJar, '/api/auth/independence-requests')
    expect(request.status).toBe(202)
    const requestId = request.body.requestId as string

    const code = await getLatestOtpCodeForEmail(minorEmail)
    const confirm = await authApi.post(minorJar, `/api/auth/independence-requests/${requestId}/confirm`, { code })

    expect(confirm.status).toBe(200)
    expect(confirm.body).toEqual({ status: 'granted' })
  })

  it('rejects an independence request from an account with no guardian link at all', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)

    const response = await authApi.post(jar, '/api/auth/independence-requests')
    expect(response.status).toBe(403)
    expect(response.body.error).toMatchObject({ code: 'not_eligible' })
  })

  it('requires authentication (with a valid CSRF token but no session)', async () => {
    const jar = await freshJarWithCsrf()
    const response = await authApi.post(jar, '/api/auth/independence-requests')
    expect(response.status).toBe(401)
  })
})

describe('completeIndependenceRequest — single transaction (revisión 3)', () => {
  it('is idempotent — repeating confirm with the same already-consumed code after a full grant never audits twice', async () => {
    const { jar, email, accountId } = await setUpEligibleAdultWithGuardianHistory()
    const { requestId, code } = await requestIndependence(jar, email)

    const first = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ status: 'granted' })

    const second = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ status: 'granted' })

    const accountAudits = await auditRowsForEntity('ClientAccount', accountId)
    expect(accountAudits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(1)
    const requestAudits = await auditRowsForEntity('IndependenceRequest', requestId)
    expect(requestAudits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(1)
  })

  it('reconciles a legacy inconsistent state — request already confirmed but account still pending (the exact partial-failure signature of the old two-transaction version)', async () => {
    const { jar, email } = await setUpEligibleAdultWithGuardianHistory()
    const { requestId, code } = await requestIndependence(jar, email)

    // Simula que la primera transacción (de la versión de dos pasos
    // anterior a esta revisión) ganó pero la segunda nunca llegó a
    // ejecutarse: la solicitud queda "confirmed" con la cuenta todavía
    // "pending" — sin haber consumido el OTP en Redis, que sigue siendo
    // válido.
    await setIndependenceRequestStatusForTesting(requestId, 'confirmed')

    const confirm = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })
    expect(confirm.status).toBe(200)
    expect(confirm.body).toEqual({ status: 'granted' })

    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('granted')
    expect(await getIndependenceRequestStatus(requestId)).toBe('confirmed')
  })

  it('a code that matches a different (later) independence request can never complete this one', async () => {
    const { jar, email } = await setUpEligibleAdultWithGuardianHistory()
    const first = await requestIndependence(jar, email)
    // Una segunda solicitud invalida en Redis el reto de la primera
    // (mismo propósito+sujeto) — el único código vigente ahora es el de la
    // segunda solicitud.
    const second = await requestIndependence(jar, email)

    const confirmFirstWithSecondCode = await authApi.post(
      jar,
      `/api/auth/independence-requests/${first.requestId}/confirm`,
      { code: second.code },
    )

    expect(confirmFirstWithSecondCode.status).toBe(400)
    expect(confirmFirstWithSecondCode.body.error).toMatchObject({ code: 'invalid_code' })
    expect(await getIndependenceRequestStatus(first.requestId)).toBe('pending')

    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('pending')
  })

  it('concurrent confirmations of the same request grant independence exactly once', async () => {
    const { jar, email, accountId } = await setUpEligibleAdultWithGuardianHistory()
    const { requestId, code } = await requestIndependence(jar, email)

    const results = await Promise.all(
      Array.from({ length: 3 }, () => authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })),
    )

    expect(results.every((result) => result.status === 200)).toBe(true)
    expect(results.every((result) => result.body.status === 'granted')).toBe(true)

    const account = await findAccountRowByEmail(email)
    expect((account as { independence_status: string }).independence_status).toBe('granted')

    const accountAudits = await auditRowsForEntity('ClientAccount', accountId)
    expect(accountAudits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(1)
  })
})
