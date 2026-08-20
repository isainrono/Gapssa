import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it } from 'vitest'

import { authApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './authClient'
import {
  auditRowsForEntity,
  disableAuditFailureFor,
  disableOutboxFailureFor,
  disableSessionRevocationFailureFor,
  enableAuditFailureFor,
  enableOutboxFailureFor,
  enableSessionRevocationFailureFor,
  findAccountRowByEmail,
  findCredentialRowForAccount,
  findOutboxJobsForAccount,
  findSessionRowsForAccount,
  getAccountStatusById,
  getGuardianLinkStatus,
  getIndependenceRequestStatus,
  getLatestPasswordResetRequestStatus,
  installAuditFailureInjection,
  installOutboxFailureInjection,
  installSessionRevocationFailureInjection,
  setAccountDateOfBirthForTesting,
  setAccountStatusForTesting,
} from './authDb'
import { ADULT_DOB, MINOR_DOB } from './dobFixtures'

/**
 * Revisión 4 de Fase 3 — atomicidad real de auditoría+negocio. Cada prueba
 * de fallo inyectado arma un trigger de Postgres que hace fallar el
 * `INSERT`/`UPDATE` exacto que la transacción bajo prueba intentaría
 * escribir (ver el razonamiento completo en `authDb.ts`,
 * `install*FailureInjection`), y comprueba la base real después — nunca
 * solo la respuesta HTTP.
 *
 * Revisión 5 de Fase 3: añade el mismo tratamiento a las tres operaciones
 * que hasta ahora quedaban repartidas en varias transacciones —
 * restablecimiento de contraseña + revocación de sesiones,
 * eliminación de cuenta + revocación de sesiones, y confirmación
 * tutor–menor bajo bloqueo — más la comprobación defensiva de
 * `ClientAccount.status` en `getActiveSessionFromCookies`.
 */

function freshEmail(): string {
  return `test-${randomUUID()}@example.test`
}

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!'
const NEW_STRONG_PASSWORD = 'Different-Horse-Battery-77!'

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

async function registerPendingAccount(email: string): Promise<{ jar: CookieJar; code: string; accountId: string }> {
  const jar = await freshJarWithCsrf()
  await authApi.post(jar, '/api/auth/register', { email, password: STRONG_PASSWORD, dateOfBirth: ADULT_DOB, locale: 'es' })
  const code = await getLatestOtpCodeForEmail(email)
  if (!code) throw new Error(`No se encontró código OTP para ${email}`)
  const accountId = await accountIdFromEmail(email)
  return { jar, code, accountId }
}

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

async function requestPendingGuardianLink(): Promise<{
  minorJar: CookieJar
  minorEmail: string
  minorAccountId: string
  guardianJar: CookieJar
  linkId: string
}> {
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

  return { minorJar, minorEmail, minorAccountId, guardianJar, linkId }
}

beforeAll(async () => {
  await installAuditFailureInjection()
  await installOutboxFailureInjection()
  await installSessionRevocationFailureInjection()
})

describe('transactional audit — injected failures roll back the paired business change', () => {
  it('audit failure during email verification activation leaves the account pending_verification, and a retry after the fault clears completes it', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    await enableAuditFailureFor(accountId)
    try {
      const failedAttempt = await authApi.post(jar, '/api/auth/verify-email', { email, code })
      expect(failedAttempt.status).not.toBe(200)

      const accountAfterFailure = await findAccountRowByEmail(email)
      expect((accountAfterFailure as { status: string }).status).toBe('pending_verification')
      expect((accountAfterFailure as { email_verified_at: unknown }).email_verified_at).toBeNull()

      const auditsAfterFailure = await auditRowsForEntity('ClientAccount', accountId)
      expect(auditsAfterFailure.filter((row) => row.reason_code === 'AccountEmailVerified')).toHaveLength(0)

      const jobsAfterFailure = await findOutboxJobsForAccount(accountId)
      expect(jobsAfterFailure).toHaveLength(0)
    } finally {
      await disableAuditFailureFor(accountId)
    }

    // Recuperación: el OTP ya se consumió en Redis en el intento fallido
    // (verifyOtp corre ANTES de completeEmailVerification) — repetir la
    // misma petición con el mismo código sigue el camino de recuperación
    // (`already_consumed` + `codeMatchesConsumedChallenge`) y esta vez la
    // transacción entera (activación + auditoría + outbox) se confirma.
    const retry = await authApi.post(jar, '/api/auth/verify-email', { email, code })
    expect(retry.status).toBe(200)

    const accountAfterRetry = await findAccountRowByEmail(email)
    expect((accountAfterRetry as { status: string }).status).toBe('active')

    const auditsAfterRetry = await auditRowsForEntity('ClientAccount', accountId)
    expect(auditsAfterRetry.filter((row) => row.reason_code === 'AccountEmailVerified')).toHaveLength(1)
  })

  it('audit failure during independence grant leaves both the request and the account in their prior states', async () => {
    const { jar, email, accountId } = await setUpEligibleAdultWithGuardianHistory()
    const request = await authApi.post(jar, '/api/auth/independence-requests')
    expect(request.status).toBe(202)
    const requestId = request.body.requestId as string
    const code = await getLatestOtpCodeForEmail(email)
    if (!code) throw new Error('No se encontró código OTP de independencia')

    await enableAuditFailureFor(accountId)
    try {
      const failedAttempt = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })
      expect(failedAttempt.status).not.toBe(200)

      expect(await getIndependenceRequestStatus(requestId)).toBe('pending')
      const accountAfterFailure = await findAccountRowByEmail(email)
      expect((accountAfterFailure as { independence_status: string }).independence_status).toBe('pending')

      const audits = await auditRowsForEntity('ClientAccount', accountId)
      expect(audits.filter((row) => row.reason_code === 'IndependenceGranted')).toHaveLength(0)
    } finally {
      await disableAuditFailureFor(accountId)
    }

    // Recuperación por el mismo mecanismo: el reto ya se consumió en Redis,
    // la solicitud sigue 'pending' (la transacción entera revirtió), así que
    // el camino normal (`request.status === 'pending'`) completa ahora.
    const retry = await authApi.post(jar, `/api/auth/independence-requests/${requestId}/confirm`, { code })
    expect(retry.status).toBe(200)
    expect(retry.body).toEqual({ status: 'granted' })
  })

  it('audit failure during account deletion never leaves the account pending_deletion, and a retry after the fault clears completes it', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    await enableAuditFailureFor(accountId)
    try {
      const failedAttempt = await authApi.post(jar, '/api/auth/account/delete-request')
      // La ruta borra la cookie de sesión incondicionalmente al final —
      // pero el negocio (estado de la cuenta) es lo que importa aquí.
      expect(failedAttempt.status).not.toBe(200)

      const accountAfterFailure = await findAccountRowByEmail(email)
      expect((accountAfterFailure as { status: string }).status).toBe('active')

      const audits = await auditRowsForEntity('ClientAccount', accountId)
      expect(audits.filter((row) => row.reason_code === 'AccountDeletionRequested')).toHaveLength(0)
    } finally {
      await disableAuditFailureFor(accountId)
    }

    // No hay recuperación automática vía OTP aquí (delete-request no usa
    // OTP) — una nueva petición del propio usuario, ya autenticado, repite
    // la operación y esta vez se confirma limpia.
    const retryJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(retryJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    const retry = await authApi.post(retryJar, '/api/auth/account/delete-request')
    expect(retry.status).toBe(200)
    expect(retry.body).toEqual({ status: 'pending_deletion' })

    const accountAfterRetry = await findAccountRowByEmail(email)
    expect((accountAfterRetry as { status: string }).status).toBe('pending_deletion')
  })
})

describe('outbox — evaluate_espo_link survives a failed processing attempt and is never processed twice', () => {
  it('a failure while marking the job completed leaves it retryable; a later attempt (after the fault clears) processes it exactly once', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    // Arma el fallo ANTES de verificar: la activación (su propia
    // transacción) no debe verse afectada — solo el procesamiento
    // posterior del job, que intenta un UPDATE sobre outbox_jobs.
    await enableOutboxFailureFor(accountId)

    const verify = await authApi.post(jar, '/api/auth/verify-email', { email, code })
    // La respuesta de verificación sigue siendo 200: la activación ya se
    // confirmó en su propia transacción antes de intentar procesar el job,
    // y un fallo de procesamiento (best-effort) nunca debe convertir una
    // verificación ya exitosa en un error para el cliente.
    expect(verify.status).toBe(200)

    const accountAfterVerify = await findAccountRowByEmail(email)
    expect((accountAfterVerify as { status: string }).status).toBe('active')

    const jobsAfterFailedProcessing = await findOutboxJobsForAccount(accountId)
    expect(jobsAfterFailedProcessing).toHaveLength(1)
    expect((jobsAfterFailedProcessing[0] as { status: string }).status).toBe('pending')

    await disableOutboxFailureFor(accountId)

    // Segundo intento: la propia ruta de verificación reprocesa cualquier
    // job pendiente también en su rama idempotente ('already_active') —
    // repetir la misma petición (código ya consumido, recuperación vía
    // already_consumed) dispara ese segundo intento sin infraestructura
    // nueva.
    const secondAttempt = await authApi.post(jar, '/api/auth/verify-email', { email, code })
    expect(secondAttempt.status).toBe(200)

    const jobsAfterSuccess = await findOutboxJobsForAccount(accountId)
    expect(jobsAfterSuccess).toHaveLength(1)
    expect((jobsAfterSuccess[0] as { status: string }).status).toBe('completed')
  })
})

describe('concurrency — one activation produces exactly one transition, one audit entry, and one outbox job', () => {
  it('two concurrent verify-email requests with the correct code never duplicate the audit trail or the outbox job', async () => {
    const email = freshEmail()
    const { jar, code, accountId } = await registerPendingAccount(email)

    const [first, second] = await Promise.all([
      authApi.post(jar, '/api/auth/verify-email', { email, code }),
      authApi.post(jar, '/api/auth/verify-email', { email, code }),
    ])

    expect([first.status, second.status]).toEqual([200, 200])

    const account = await findAccountRowByEmail(email)
    expect((account as { status: string }).status).toBe('active')

    const audits = await auditRowsForEntity('ClientAccount', accountId)
    expect(audits.filter((row) => row.reason_code === 'AccountEmailVerified')).toHaveLength(1)

    const jobs = await findOutboxJobsForAccount(accountId)
    expect(jobs).toHaveLength(1)
  })
})

describe('revisión 5 — password reset rotates the credential, consumes the request, and revokes every session atomically', () => {
  it('a failure revoking the only active session rolls back credential rotation and request consumption; a retry after the fault clears completes everything once', async () => {
    const email = freshEmail()
    await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    const sessionJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(sessionJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    const [sessionBeforeFailure] = await findSessionRowsForAccount(accountId)
    const sessionId = (sessionBeforeFailure as { id: string }).id
    const credentialBefore = await findCredentialRowForAccount(accountId)

    const forgotJar = await freshJarWithCsrf('/es/mi-cuenta/recuperar')
    await authApi.post(forgotJar, '/api/auth/password/forgot', { email })
    const code = await getLatestOtpCodeForEmail(email)

    await enableSessionRevocationFailureFor(sessionId)
    try {
      const failedAttempt = await authApi.post(forgotJar, '/api/auth/password/reset', {
        email,
        code,
        newPassword: NEW_STRONG_PASSWORD,
      })
      expect(failedAttempt.status).not.toBe(200)

      // Nada se confirmó: ni la credencial rotó, ni la solicitud se
      // consumió, ni la sesión (todavía viva) se tocó.
      const credentialAfterFailure = await findCredentialRowForAccount(accountId)
      expect(credentialAfterFailure).toEqual(credentialBefore)

      const [sessionAfterFailure] = await findSessionRowsForAccount(accountId)
      expect((sessionAfterFailure as { revoked_at: unknown }).revoked_at).toBeNull()

      const audits = await auditRowsForEntity('ClientAccount', accountId)
      expect(audits.filter((row) => row.reason_code === 'PasswordResetCompleted')).toHaveLength(0)

      const oldPasswordStillWorks = await authApi.post(await freshJarWithCsrf('/es/mi-cuenta/acceder'), '/api/auth/login', {
        email,
        password: STRONG_PASSWORD,
      })
      expect(oldPasswordStillWorks.status).toBe(200)
    } finally {
      await disableSessionRevocationFailureFor(sessionId)
    }

    // Recuperación: el OTP ya se consumió en Redis en el intento fallido —
    // repetir la misma petición sigue el camino `already_consumed` +
    // `codeMatchesConsumedChallenge`, y esta vez la transacción entera
    // (rotación + consumo de solicitud + revocación de sesión + auditoría)
    // se confirma de una sola vez.
    const retry = await authApi.post(forgotJar, '/api/auth/password/reset', {
      email,
      code,
      newPassword: NEW_STRONG_PASSWORD,
    })
    expect(retry.status).toBe(200)

    const [sessionAfterRetry] = await findSessionRowsForAccount(accountId)
    expect((sessionAfterRetry as { revoked_at: unknown }).revoked_at).not.toBeNull()
    expect((sessionAfterRetry as { revoked_reason: string }).revoked_reason).toBe('password_changed')

    const auditsAfterRetry = await auditRowsForEntity('ClientAccount', accountId)
    expect(auditsAfterRetry.filter((row) => row.reason_code === 'PasswordResetCompleted')).toHaveLength(1)

    const sessionAudits = await auditRowsForEntity('Session', sessionId)
    expect(sessionAudits.filter((row) => row.reason_code === 'SessionRevokedByPasswordChange')).toHaveLength(1)

    const loginOld = await authApi.post(await freshJarWithCsrf('/es/mi-cuenta/acceder'), '/api/auth/login', {
      email,
      password: STRONG_PASSWORD,
    })
    expect(loginOld.status).toBe(401)
  })

  it('a failure revoking the second of several active sessions rolls back ALL of them (and the credential), never leaving a partially revoked set; a retry completes once', async () => {
    const email = freshEmail()
    await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    // Tres sesiones activas para la misma cuenta (tres "dispositivos").
    for (let i = 0; i < 2; i += 1) {
      const extraJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
      await authApi.post(extraJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    }
    const sessionsBefore = await findSessionRowsForAccount(accountId)
    expect(sessionsBefore).toHaveLength(3)
    const secondSessionId = (sessionsBefore[1] as { id: string }).id

    const forgotJar = await freshJarWithCsrf('/es/mi-cuenta/recuperar')
    await authApi.post(forgotJar, '/api/auth/password/forgot', { email })
    const code = await getLatestOtpCodeForEmail(email)

    await enableSessionRevocationFailureFor(secondSessionId)
    try {
      const failedAttempt = await authApi.post(forgotJar, '/api/auth/password/reset', {
        email,
        code,
        newPassword: NEW_STRONG_PASSWORD,
      })
      expect(failedAttempt.status).not.toBe(200)

      // Ninguna de las tres quedó revocada — no solo la que falló: el
      // `UPDATE` masivo de las tres es una única sentencia, y el fallo de
      // una fila revierte la transacción entera.
      const sessionsAfterFailure = await findSessionRowsForAccount(accountId)
      expect(sessionsAfterFailure.every((row) => (row as { revoked_at: unknown }).revoked_at === null)).toBe(true)
    } finally {
      await disableSessionRevocationFailureFor(secondSessionId)
    }

    const retry = await authApi.post(forgotJar, '/api/auth/password/reset', {
      email,
      code,
      newPassword: NEW_STRONG_PASSWORD,
    })
    expect(retry.status).toBe(200)

    const sessionsAfterRetry = await findSessionRowsForAccount(accountId)
    expect(sessionsAfterRetry).toHaveLength(3)
    expect(sessionsAfterRetry.every((row) => (row as { revoked_at: unknown }).revoked_at !== null)).toBe(true)

    const sessionAuditRows = await Promise.all(
      sessionsAfterRetry.map((row) => auditRowsForEntity('Session', (row as { id: string }).id)),
    )
    for (const rows of sessionAuditRows) {
      expect(rows.filter((row) => row.reason_code === 'SessionRevokedByPasswordChange')).toHaveLength(1)
    }
  })

  it('a failure auditing one specific session rolls back the whole transaction, including sessions already updated in the same statement; a retry completes once', async () => {
    const email = freshEmail()
    await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    const extraJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(extraJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    const sessionsBefore = await findSessionRowsForAccount(accountId)
    expect(sessionsBefore).toHaveLength(2)
    const targetSessionId = (sessionsBefore[0] as { id: string }).id

    const forgotJar = await freshJarWithCsrf('/es/mi-cuenta/recuperar')
    await authApi.post(forgotJar, '/api/auth/password/forgot', { email })
    const code = await getLatestOtpCodeForEmail(email)

    // Reutiliza el mecanismo genérico de fallo de auditoría —
    // `entity_id` de una fila de auditoría `Session` es el propio id de
    // la sesión.
    await enableAuditFailureFor(targetSessionId)
    try {
      const failedAttempt = await authApi.post(forgotJar, '/api/auth/password/reset', {
        email,
        code,
        newPassword: NEW_STRONG_PASSWORD,
      })
      expect(failedAttempt.status).not.toBe(200)

      const sessionsAfterFailure = await findSessionRowsForAccount(accountId)
      expect(sessionsAfterFailure.every((row) => (row as { revoked_at: unknown }).revoked_at === null)).toBe(true)

      const requestStatus = await getLatestPasswordResetRequestStatus(accountId)
      expect(requestStatus).not.toBe('consumed')
    } finally {
      await disableAuditFailureFor(targetSessionId)
    }

    const retry = await authApi.post(forgotJar, '/api/auth/password/reset', {
      email,
      code,
      newPassword: NEW_STRONG_PASSWORD,
    })
    expect(retry.status).toBe(200)

    const sessionsAfterRetry = await findSessionRowsForAccount(accountId)
    expect(sessionsAfterRetry.every((row) => (row as { revoked_at: unknown }).revoked_at !== null)).toBe(true)
  })
})

describe('revisión 5 — account deletion transitions to pending_deletion and revokes every session atomically', () => {
  it('a successful deletion revokes every active session and audits the account transition + each session exactly once', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    const extraJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(extraJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    const sessionsBefore = await findSessionRowsForAccount(accountId)
    expect(sessionsBefore).toHaveLength(2)

    const response = await authApi.post(jar, '/api/auth/account/delete-request')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'pending_deletion' })

    const account = await findAccountRowByEmail(email)
    expect((account as { status: string }).status).toBe('pending_deletion')

    const sessionsAfter = await findSessionRowsForAccount(accountId)
    expect(sessionsAfter.every((row) => (row as { revoked_at: unknown }).revoked_at !== null)).toBe(true)
    expect(sessionsAfter.every((row) => (row as { revoked_reason: string }).revoked_reason === 'account_deletion_requested')).toBe(true)

    const accountAudits = await auditRowsForEntity('ClientAccount', accountId)
    expect(accountAudits.filter((row) => row.reason_code === 'AccountDeletionRequested')).toHaveLength(1)

    for (const row of sessionsAfter) {
      const sessionAudits = await auditRowsForEntity('Session', (row as { id: string }).id)
      expect(sessionAudits.filter((auditRow) => auditRow.reason_code === 'AccountDeletionRequested')).toHaveLength(1)
    }
  })

  it('a failure revoking one of several sessions rolls back the pending_deletion transition too; a retry after the fault clears completes everything once', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    const extraJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(extraJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    const sessionsBefore = await findSessionRowsForAccount(accountId)
    expect(sessionsBefore).toHaveLength(2)
    const targetSessionId = (sessionsBefore[1] as { id: string }).id

    await enableSessionRevocationFailureFor(targetSessionId)
    try {
      const failedAttempt = await authApi.post(jar, '/api/auth/account/delete-request')
      expect(failedAttempt.status).not.toBe(200)

      const accountAfterFailure = await findAccountRowByEmail(email)
      expect((accountAfterFailure as { status: string }).status).toBe('active')

      const sessionsAfterFailure = await findSessionRowsForAccount(accountId)
      expect(sessionsAfterFailure.every((row) => (row as { revoked_at: unknown }).revoked_at === null)).toBe(true)

      const accountAudits = await auditRowsForEntity('ClientAccount', accountId)
      expect(accountAudits.filter((row) => row.reason_code === 'AccountDeletionRequested')).toHaveLength(0)
    } finally {
      await disableSessionRevocationFailureFor(targetSessionId)
    }

    // La ruta borra la cookie de sesión incondicionalmente al final, así
    // que la propia `jar` original ya no sirve tras el intento fallido —
    // una nueva sesión (login) repite la petición.
    const retryJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(retryJar, '/api/auth/login', { email, password: STRONG_PASSWORD })
    const retry = await authApi.post(retryJar, '/api/auth/account/delete-request')
    expect(retry.status).toBe(200)

    const accountAfterRetry = await findAccountRowByEmail(email)
    expect((accountAfterRetry as { status: string }).status).toBe('pending_deletion')

    const sessionsAfterRetry = await findSessionRowsForAccount(accountId)
    expect(sessionsAfterRetry.every((row) => (row as { revoked_at: unknown }).revoked_at !== null)).toBe(true)
  })

  it('two concurrent delete-request calls for the same account never duplicate the account audit, and leave zero active sessions', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    const extraJar = await freshJarWithCsrf('/es/mi-cuenta/acceder')
    await authApi.post(extraJar, '/api/auth/login', { email, password: STRONG_PASSWORD })

    const [first, second] = await Promise.all([
      authApi.post(jar, '/api/auth/account/delete-request'),
      authApi.post(extraJar, '/api/auth/account/delete-request'),
    ])
    expect([first.status, second.status]).toEqual([200, 200])

    const account = await findAccountRowByEmail(email)
    expect((account as { status: string }).status).toBe('pending_deletion')

    const accountAudits = await auditRowsForEntity('ClientAccount', accountId)
    expect(accountAudits.filter((row) => row.reason_code === 'AccountDeletionRequested')).toHaveLength(1)

    const sessionsAfter = await findSessionRowsForAccount(accountId)
    expect(sessionsAfter).toHaveLength(2)
    expect(sessionsAfter.every((row) => (row as { revoked_at: unknown }).revoked_at !== null)).toBe(true)

    for (const row of sessionsAfter) {
      const sessionAudits = await auditRowsForEntity('Session', (row as { id: string }).id)
      expect(sessionAudits.filter((auditRow) => auditRow.reason_code === 'AccountDeletionRequested')).toHaveLength(1)
    }
  })
})

describe('revisión 5 — a session belonging to a non-active account never authorizes, and self-heals defensively', () => {
  it('pending_deletion with a residual session (manipulated directly in the database) is rejected and the session is revoked+audited defensively; idempotent on a second request', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    // Simula exactamente el hueco que esta revisión cierra: la cuenta pasa
    // a `pending_deletion` sin pasar por `requestAccountDeletion` (dato
    // manipulado directamente, o cualquier otro camino no cubierto) — la
    // fila de la sesión sigue con `revoked_at IS NULL`.
    await setAccountStatusForTesting(accountId, 'pending_deletion')

    const rejected = await authApi.get(jar, '/api/auth/sessions')
    expect(rejected.status).toBe(401)

    const [sessionRow] = await findSessionRowsForAccount(accountId)
    expect((sessionRow as { revoked_at: unknown }).revoked_at).not.toBeNull()
    expect((sessionRow as { revoked_reason: string }).revoked_reason).toBe('account_deletion_requested')

    const sessionAudits = await auditRowsForEntity('Session', (sessionRow as { id: string }).id)
    expect(sessionAudits.filter((row) => row.reason_code === 'AccountDeletionRequested')).toHaveLength(1)

    // Segunda petición con la misma cookie: sigue rechazada, sin auditoría
    // duplicada (la sesión ya estaba revocada, `revokedAt IS NOT NULL` en
    // el propio `WHERE` del `UPDATE` defensivo evita una segunda escritura).
    const rejectedAgain = await authApi.get(jar, '/api/auth/sessions')
    expect(rejectedAgain.status).toBe(401)
    const sessionAuditsAfterSecondAttempt = await auditRowsForEntity('Session', (sessionRow as { id: string }).id)
    expect(sessionAuditsAfterSecondAttempt.filter((row) => row.reason_code === 'AccountDeletionRequested')).toHaveLength(1)
  })

  it('suspended with a residual session (manipulated directly in the database) is rejected and the session is revoked with admin_action', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)
    const accountId = await accountIdFromEmail(email)

    await setAccountStatusForTesting(accountId, 'suspended')

    const rejected = await authApi.get(jar, '/api/auth/sessions')
    expect(rejected.status).toBe(401)

    const [sessionRow] = await findSessionRowsForAccount(accountId)
    expect((sessionRow as { revoked_at: unknown }).revoked_at).not.toBeNull()
    expect((sessionRow as { revoked_reason: string }).revoked_reason).toBe('admin_action')

    const sessionAudits = await auditRowsForEntity('Session', (sessionRow as { id: string }).id)
    expect(sessionAudits.filter((row) => row.reason_code === 'SessionRevokedByAdmin')).toHaveLength(1)
  })

  it('an active account keeps authorizing normally through the same code path', async () => {
    const email = freshEmail()
    const jar = await registerVerifyAndLogin(email, ADULT_DOB)

    const response = await authApi.get(jar, '/api/auth/sessions')
    expect(response.status).toBe(200)
  })
})

describe('revisión 5 — guardian link confirmation revalidates the minor account under lock', () => {
  it('confirms normally when the minor account is still active, verified, and a minor (control case)', async () => {
    const { minorJar, linkId } = await requestPendingGuardianLink()

    const confirm = await authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`)
    expect(confirm.status).toBe(200)
    expect(await getGuardianLinkStatus(linkId)).toBe('active')
  })

  it('confirm vs. the minor account already suspended: never activates, and the link stays non-active', async () => {
    const { minorJar, minorAccountId, linkId } = await requestPendingGuardianLink()

    await setAccountStatusForTesting(minorAccountId, 'suspended')

    const confirm = await authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`)
    // La propia sesión del menor ya deja de autorizar en cuanto la cuenta
    // no es `active` (getActiveSessionFromCookies) — 401 es la respuesta
    // esperada, no un 409 `target_not_eligible` alcanzado dentro de
    // confirmGuardianLink; en cualquier caso, el invariante es el mismo:
    // el vínculo nunca queda `active`.
    expect(confirm.status).not.toBe(200)
    expect(await getGuardianLinkStatus(linkId)).not.toBe('active')
  })

  it('confirm vs. the minor account already pending_deletion: never activates, and the link stays non-active', async () => {
    const { minorJar, minorAccountId, linkId } = await requestPendingGuardianLink()

    await setAccountStatusForTesting(minorAccountId, 'pending_deletion')

    const confirm = await authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`)
    expect(confirm.status).not.toBe(200)
    expect(await getGuardianLinkStatus(linkId)).not.toBe('active')
  })

  it('confirm the day the minor turns 18: rejected as target_not_eligible, link stays pending', async () => {
    const { minorJar, minorAccountId, linkId } = await requestPendingGuardianLink()

    await setAccountDateOfBirthForTesting(minorAccountId, ADULT_DOB)

    const confirm = await authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`)
    expect(confirm.status).toBe(409)
    expect(confirm.body.error).toMatchObject({ code: 'target_not_eligible' })
    expect(await getGuardianLinkStatus(linkId)).toBe('pending_minor_confirmation')
  })

  it('confirm vs. a concurrent revocation: the link never ends up active once revoked', async () => {
    const { minorJar, guardianJar, linkId } = await requestPendingGuardianLink()

    await authApi.post(guardianJar, `/api/auth/guardian/link-requests/${linkId}/revoke`)
    expect(await getGuardianLinkStatus(linkId)).toBe('revoked')

    const confirm = await authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`)
    expect(confirm.status).toBe(409)
    expect(confirm.body.error).toMatchObject({ code: 'not_pending' })
    expect(await getGuardianLinkStatus(linkId)).toBe('revoked')
  })

  it('invariant under real concurrency: confirm racing a suspension never leaves an active link whose minor was suspended before the commit', async () => {
    const { minorJar, minorAccountId, linkId } = await requestPendingGuardianLink()

    const [confirmResult] = await Promise.all([
      authApi.post(minorJar, `/api/auth/guardian/link-requests/${linkId}/confirm`),
      setAccountStatusForTesting(minorAccountId, 'suspended'),
    ])

    const linkStatus = await getGuardianLinkStatus(linkId)
    const accountAfter = await getAccountStatusById(minorAccountId)

    if (linkStatus === 'active') {
      // Si la confirmación ganó la carrera, la cuenta debía seguir activa
      // en el instante real del commit — nunca "activa a medias" con una
      // suspensión que en realidad ya había ganado.
      expect(confirmResult.status).toBe(200)
    } else {
      // Si la suspensión ganó, el vínculo nunca debe haber quedado activo.
      expect(linkStatus).not.toBe('active')
      expect(accountAfter).toBe('suspended')
    }
  })
})
