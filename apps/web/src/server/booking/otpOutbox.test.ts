import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pruebas unitarias de `processGuestVerificationOtpJob` — revisión 2 de
 * Fase 4A, punto 3; leases y cierre de solicitudes caducadas de revisión 3,
 * puntos 1-5. Se mockean todas las dependencias de I/O (Postgres vía
 * `repository.ts`, Redis vía `otpService.ts`, SMTP vía `mailer.ts`,
 * descifrado vía `verificationSteps.ts`) para poder ejercitar cada rama de
 * recuperación de forma determinista y rápida — la prueba de extremo a
 * extremo (entrega real por el buzón SMTP de pruebas, ausencia de OTP/PII
 * en las tablas reales, recuperación de leases sobre Postgres real) vive en
 * `tests/integration/booking.otpOutbox.int.test.ts`.
 */

const claimGuestVerificationOtpJobMock = vi.fn()
const findBookingRequestByIdMock = vi.fn()
const linkOtpChallengeIfPendingMock = vi.fn()
const markGuestVerificationOtpJobCompletedMock = vi.fn()
const markGuestVerificationOtpJobFailedRetryableMock = vi.fn()

vi.mock('./repository', () => ({
  claimGuestVerificationOtpJob: (...args: unknown[]) => claimGuestVerificationOtpJobMock(...args),
  findBookingRequestById: (...args: unknown[]) => findBookingRequestByIdMock(...args),
  linkOtpChallengeIfPending: (...args: unknown[]) => linkOtpChallengeIfPendingMock(...args),
  markGuestVerificationOtpJobCompleted: (...args: unknown[]) => markGuestVerificationOtpJobCompletedMock(...args),
  markGuestVerificationOtpJobFailedRetryable: (...args: unknown[]) => markGuestVerificationOtpJobFailedRetryableMock(...args),
}))

const requestOtpMock = vi.fn()
vi.mock('../auth/otpService', () => ({
  requestOtp: (...args: unknown[]) => requestOtpMock(...args),
}))

const sendMailMock = vi.fn()
vi.mock('../auth/mailer', () => ({
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}))

const decryptGuestIdentityMock = vi.fn()
vi.mock('./verificationSteps', () => ({
  decryptGuestIdentity: (...args: unknown[]) => decryptGuestIdentityMock(...args),
}))

import { processGuestVerificationOtpJob } from './otpOutbox'

const BOOKING_REQUEST_ID = 'request-1'
const NOW = new Date('2026-08-10T12:00:00Z')
const JOB = { id: 'job-1', attempts: 0, claimToken: 'claim-token-1' }
const IDENTITY = { firstName: 'Ana', lastName: 'López', email: 'ana@example.com', phone: '+34600000000' }
const STILL_PENDING_RECORD = {
  id: BOOKING_REQUEST_ID,
  status: 'pending_verification',
  verificationExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
}

beforeEach(() => {
  vi.clearAllMocks()
  claimGuestVerificationOtpJobMock.mockResolvedValue(JOB)
  findBookingRequestByIdMock.mockResolvedValue(STILL_PENDING_RECORD)
  decryptGuestIdentityMock.mockResolvedValue(IDENTITY)
  linkOtpChallengeIfPendingMock.mockResolvedValue('linked')
  requestOtpMock.mockResolvedValue({ outcome: 'issued', challengeId: 'challenge-1', code: '123456', expiresAt: NOW.toISOString() })
  sendMailMock.mockResolvedValue(undefined)
  markGuestVerificationOtpJobCompletedMock.mockResolvedValue('updated')
  markGuestVerificationOtpJobFailedRetryableMock.mockResolvedValue('updated')
})

describe('processGuestVerificationOtpJob', () => {
  it('returns no_eligible_job without touching Postgres/Redis/SMTP further when there is nothing to claim', async () => {
    claimGuestVerificationOtpJobMock.mockResolvedValue(null)
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('no_eligible_job')
    expect(findBookingRequestByIdMock).not.toHaveBeenCalled()
    expect(requestOtpMock).not.toHaveBeenCalled()
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('closes the job as expired (never sends) when the booking request no longer exists', async () => {
    findBookingRequestByIdMock.mockResolvedValue(null)
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('expired')
    expect(markGuestVerificationOtpJobCompletedMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, NOW)
    expect(requestOtpMock).not.toHaveBeenCalled()
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('closes the job as expired (never sends) when the request already moved past pending_verification', async () => {
    findBookingRequestByIdMock.mockResolvedValue({ ...STILL_PENDING_RECORD, status: 'verification_processing' })
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('expired')
    expect(markGuestVerificationOtpJobCompletedMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, NOW)
    expect(requestOtpMock).not.toHaveBeenCalled()
  })

  it('closes the job as expired (never sends) when verificationExpiresAt already passed — never creates/rotates the OTP challenge for a request that can no longer be verified', async () => {
    findBookingRequestByIdMock.mockResolvedValue({ ...STILL_PENDING_RECORD, verificationExpiresAt: new Date(NOW.getTime() - 1) })
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('expired')
    expect(markGuestVerificationOtpJobCompletedMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, NOW)
    expect(requestOtpMock).not.toHaveBeenCalled()
    expect(decryptGuestIdentityMock).not.toHaveBeenCalled()
  })

  it('marks the job completed (never retryable) when PendingGuestIdentity is already gone', async () => {
    decryptGuestIdentityMock.mockResolvedValue(null)
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('no_eligible_job')
    expect(markGuestVerificationOtpJobCompletedMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, NOW)
    expect(requestOtpMock).not.toHaveBeenCalled()
  })

  it('marks failed_retryable when issuing the OTP challenge throws (Redis down)', async () => {
    requestOtpMock.mockRejectedValue(new Error('redis unavailable'))
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('failed_retryable')
    expect(markGuestVerificationOtpJobFailedRetryableMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, JOB.attempts, 'otp_issue_failed', NOW)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('surfaces rate_limited distinctly and marks the job retryable with that error code', async () => {
    requestOtpMock.mockResolvedValue({ outcome: 'rate_limited' })
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('rate_limited')
    expect(markGuestVerificationOtpJobFailedRetryableMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, JOB.attempts, 'otp_rate_limited', NOW)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('closes the job as expired (not retryable) when the atomic link CAS loses the race — the authoritative gate for punto 5', async () => {
    linkOtpChallengeIfPendingMock.mockResolvedValue('not_pending')
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('expired')
    expect(linkOtpChallengeIfPendingMock).toHaveBeenCalledWith(BOOKING_REQUEST_ID, 'challenge-1')
    expect(markGuestVerificationOtpJobCompletedMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, NOW)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('SMTP failure BEFORE/DURING the delivery attempt: marks failed_retryable, keeps the challenge already linked so a retry issues a fresh code', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp connection refused'))
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('failed_retryable')
    expect(markGuestVerificationOtpJobFailedRetryableMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, JOB.attempts, 'mail_send_failed', NOW)
    expect(markGuestVerificationOtpJobCompletedMock).not.toHaveBeenCalled()
    // El reto SÍ se vinculó antes del intento de envío — un reintento
    // posterior rotará este reto (requestOtp lo invalida) y vinculará uno
    // nuevo; nunca queda "vinculado pero jamás enviado" sin que un
    // reintento lo sustituya.
    expect(linkOtpChallengeIfPendingMock).toHaveBeenCalledWith(BOOKING_REQUEST_ID, 'challenge-1')
  })

  it('never passes the plaintext OTP code to any repository/DB call — only sendMail sees it', async () => {
    await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    const otpCode = '123456'
    for (const call of [
      ...claimGuestVerificationOtpJobMock.mock.calls,
      ...findBookingRequestByIdMock.mock.calls,
      ...linkOtpChallengeIfPendingMock.mock.calls,
      ...markGuestVerificationOtpJobCompletedMock.mock.calls,
    ]) {
      expect(JSON.stringify(call)).not.toContain(otpCode)
    }
  })

  it('happy path: sends the mail and marks the job completed exactly once, passing the exact claimToken from the claim', async () => {
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('sent')
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: IDENTITY.email, text: expect.stringContaining('123456') }),
    )
    expect(markGuestVerificationOtpJobCompletedMock).toHaveBeenCalledTimes(1)
    expect(markGuestVerificationOtpJobCompletedMock).toHaveBeenCalledWith(JOB.id, JOB.claimToken, NOW)
    expect(markGuestVerificationOtpJobFailedRetryableMock).not.toHaveBeenCalled()
  })

  it('UNCERTAIN failure AFTER a successful send (bookkeeping write itself fails): propagates instead of silently reporting success or loss', async () => {
    markGuestVerificationOtpJobCompletedMock.mockRejectedValue(new Error('postgres blip right after smtp accepted the message'))
    await expect(processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)).rejects.toThrow(/postgres blip/)
    // El correo SÍ se llegó a enviar — por diseño, no hay "exactly-once"
    // sobre SMTP: este escenario documentado puede duplicar un correo si
    // el job se reclama de nuevo más tarde (vía el reclamo de jobs
    // "processing" con lease vencido, repository.ts) y vuelve a completar
    // con éxito. Nunca se responde como si el correo nunca se hubiera
    // enviado.
    expect(sendMailMock).toHaveBeenCalledTimes(1)
  })

  it('lease lost AFTER a successful send (another worker already reclaimed the job): reports sent, never throws — the new owner decides the job’s fate', async () => {
    markGuestVerificationOtpJobCompletedMock.mockResolvedValue('lease_lost')
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('sent')
    expect(sendMailMock).toHaveBeenCalledTimes(1)
  })

  it('lease lost while recording an SMTP failure: reports failed_retryable, never throws', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp connection refused'))
    markGuestVerificationOtpJobFailedRetryableMock.mockResolvedValue('lease_lost')
    const outcome = await processGuestVerificationOtpJob(BOOKING_REQUEST_ID, NOW)
    expect(outcome).toBe('failed_retryable')
  })
})
