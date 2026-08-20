import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { bookingApi, CookieJar, countMailboxMessagesForEmail, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import {
  attemptGuestVerificationOtpJobCompleteWithToken,
  attemptGuestVerificationOtpJobFailRetryableWithToken,
  findGuestVerificationOtpJob,
  forceGuestVerificationOtpJobFailedRetryable,
  forceGuestVerificationOtpJobProcessing,
  resetGuestVerificationOtpJobForTesting,
  setBookingRequestStatusForTesting,
} from './bookingDb'

/**
 * Leases del outbox de OTP de invitado y disparador durable del barrido —
 * revisión 3 de Fase 4A, puntos 1, 2, 4 y 5. `booking.otpOutbox.int.test.ts`
 * ya cubre el camino feliz de extremo a extremo y la ausencia de PII/OTP en
 * las tablas reales; este archivo se centra en lo que ese no cubre: la
 * elegibilidad exacta del reclamo (`nextAttemptAt`/`leaseExpiresAt`), que un
 * `claimToken` obsoleto nunca puede corromper el resultado de un worker más
 * reciente, que el barrido recupera trabajo sin que el cliente repita
 * `POST /requests`, y que una solicitud caducada nunca recibe un código
 * nuevo. El estado incierto de un fallo SMTP real (`nextAttemptAt` exacto
 * tras un fallo de verdad) sigue cubierto solo a nivel unitario
 * (`src/server/booking/otpOutbox.test.ts`) por el mismo motivo documentado
 * en `booking.otpOutbox.int.test.ts`: este proceso de pruebas no comparte
 * memoria con el servidor `next dev` real, así que no hay forma
 * determinista de forzar esa caída para UN solo archivo sin afectar al
 * resto de la suite.
 */

function nextBusinessDayAt10Utc(n: number): string {
  const date = new Date()
  date.setUTCHours(10, 0, 0, 0)
  let remaining = n
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    if (date.getUTCDay() !== 0) {
      remaining -= 1
    }
  }
  return date.toISOString()
}

function freshGuest() {
  const unique = randomUUID()
  return { firstName: 'Leandra', lastName: 'Lease', phone: '+34 699 000 111', email: `lease-${unique}@example.test` }
}

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es')
  return jar
}

const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-1'
const PROFESSIONAL_ID = 'professional-owner'
const INTERNAL_SECRET = process.env.BOOKING_INTERNAL_API_SECRET as string

interface CreatedRequest {
  requestId: string
  accessToken: string
  guest: ReturnType<typeof freshGuest>
  payload: Record<string, unknown>
  jar: CookieJar
}

/** Crea una solicitud de invitado y espera el envío inicial (best-effort, síncrono con la respuesta 202) — punto de partida común de todos los escenarios de este archivo. */
async function createAndCompleteInitialSend(dayOffset: number): Promise<CreatedRequest> {
  const jar = await freshJarWithCsrf()
  const guest = freshGuest()
  const startAt = nextBusinessDayAt10Utc(dayOffset)
  const payload = {
    idempotencyKey: randomUUID(),
    treatmentId: TREATMENT_ID,
    professionalId: PROFESSIONAL_ID,
    zoneId: ZONE_ID,
    startAt,
    guest,
  }

  const create = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
  if (create.status !== 202) throw new Error(`create failed: ${create.status} ${JSON.stringify(create.body)}`)
  const requestId = create.body.requestId as string
  const accessToken = create.body.accessToken as string

  const job = await findGuestVerificationOtpJob(requestId)
  if (job?.status !== 'completed') throw new Error(`expected initial send to complete, got ${JSON.stringify(job)}`)

  return { requestId, accessToken, guest, payload, jar }
}

async function runSweep(): Promise<{ status: number; body: Record<string, unknown> }> {
  const baseUrl = inject('integrationBaseUrl')
  const response = await fetch(`${baseUrl}/api/booking/v1/internal/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-api-secret': INTERNAL_SECRET },
    body: JSON.stringify({}),
  })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, body: body as Record<string, unknown> }
}

describe('booking outbox — nextAttemptAt gates failed_retryable reclaims (revisión 3, punto 2)', () => {
  it('never reclaims a failed_retryable job before its nextAttemptAt', async () => {
    const { requestId, guest, payload, jar } = await createAndCompleteInitialSend(1)
    await forceGuestVerificationOtpJobFailedRetryable(requestId, new Date(Date.now() + 10 * 60_000))
    const before = await countMailboxMessagesForEmail(guest.email)

    const replay = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
    expect(replay.status).toBe(202)

    expect(await countMailboxMessagesForEmail(guest.email)).toBe(before)
    const job = await findGuestVerificationOtpJob(requestId)
    expect(job?.status).toBe('failed_retryable')
  })

  it('reclaims a failed_retryable job once nextAttemptAt has passed', async () => {
    const { requestId, guest, payload, jar } = await createAndCompleteInitialSend(2)
    await forceGuestVerificationOtpJobFailedRetryable(requestId, new Date(Date.now() - 1_000))
    const before = await countMailboxMessagesForEmail(guest.email)

    const replay = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
    expect(replay.status).toBe(202)

    expect(await countMailboxMessagesForEmail(guest.email)).toBe(before + 1)
    const job = await findGuestVerificationOtpJob(requestId)
    expect(job).toMatchObject({ status: 'completed', next_attempt_at: null })
  })
})

describe('booking outbox — leaseExpiresAt gates processing reclaims (revisión 3, punto 1-2)', () => {
  it('never reclaims a processing job whose lease is still fresh', async () => {
    const { requestId, guest, payload, jar } = await createAndCompleteInitialSend(3)
    const freshToken = randomUUID()
    await forceGuestVerificationOtpJobProcessing(requestId, { claimToken: freshToken, leaseExpiresAt: new Date(Date.now() + 60_000) })
    const before = await countMailboxMessagesForEmail(guest.email)

    const replay = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
    expect(replay.status).toBe(202)
    const sweep = await runSweep()
    expect(sweep.status).toBe(200)

    expect(await countMailboxMessagesForEmail(guest.email)).toBe(before)
    const job = await findGuestVerificationOtpJob(requestId)
    expect(job).toMatchObject({ status: 'processing', claim_token: freshToken })
  })

  it('recovers a processing job whose lease already expired — abandoned worker, no repeat POST /requests needed (revisión 3, punto 4)', async () => {
    const { requestId, guest } = await createAndCompleteInitialSend(4)
    const abandonedToken = randomUUID()
    await forceGuestVerificationOtpJobProcessing(requestId, { claimToken: abandonedToken, leaseExpiresAt: new Date(Date.now() - 1_000) })
    const before = await countMailboxMessagesForEmail(guest.email)

    // Únicamente el barrido — nunca se repite POST /requests: simula
    // exactamente lo que ve un cliente real que ya recibió su 202 y pasó a
    // introducir el código, sin motivo para volver a crear la reserva.
    const sweep = await runSweep()
    expect(sweep.status).toBe(200)
    const report = sweep.body as { outboxJobs: { sent: number; abandonedRecovered: number } }
    expect(report.outboxJobs.abandonedRecovered).toBeGreaterThanOrEqual(1)

    expect(await countMailboxMessagesForEmail(guest.email)).toBe(before + 1)
    const job = await findGuestVerificationOtpJob(requestId)
    expect(job).toMatchObject({ status: 'completed' })
    expect(job?.claim_token).not.toBe(abandonedToken)
  })

  it('two concurrent sweep runs never both process the same eligible job', async () => {
    const { requestId, guest } = await createAndCompleteInitialSend(7)
    await resetGuestVerificationOtpJobForTesting(requestId)
    const before = await countMailboxMessagesForEmail(guest.email)

    const [first, second] = await Promise.all([runSweep(), runSweep()])
    expect([first.status, second.status]).toEqual([200, 200])

    expect(await countMailboxMessagesForEmail(guest.email)).toBe(before + 1)
    const job = await findGuestVerificationOtpJob(requestId)
    expect(job?.status).toBe('completed')
  })
})

describe('booking outbox — a stale claim token can never corrupt a newer worker’s result (revisión 3, punto 1)', () => {
  it('a stale token can never mark the job completed once another worker holds the current lease', async () => {
    const { requestId } = await createAndCompleteInitialSend(14)
    const jobBefore = await findGuestVerificationOtpJob(requestId)
    const jobId = jobBefore?.id as string

    const staleToken = randomUUID()
    const currentToken = randomUUID()
    // Worker B reclama de verdad (lease vigente) — worker A, con
    // staleToken, llega demasiado tarde.
    await forceGuestVerificationOtpJobProcessing(requestId, { claimToken: currentToken, leaseExpiresAt: new Date(Date.now() + 60_000) })

    const staleAttempt = await attemptGuestVerificationOtpJobCompleteWithToken(jobId, staleToken)
    expect(staleAttempt).toBe(0)

    const stillOwnedByB = await findGuestVerificationOtpJob(requestId)
    expect(stillOwnedByB).toMatchObject({ status: 'processing', claim_token: currentToken })

    // El propietario vigente sí puede escribir con su propio token.
    const correctAttempt = await attemptGuestVerificationOtpJobCompleteWithToken(jobId, currentToken)
    expect(correctAttempt).toBe(1)
  })

  it('a stale token can never revert the job to failed_retryable once a newer worker already completed it', async () => {
    const { requestId } = await createAndCompleteInitialSend(25)
    const jobBefore = await findGuestVerificationOtpJob(requestId)
    const jobId = jobBefore?.id as string

    const staleToken = randomUUID()
    const currentToken = randomUUID()
    await forceGuestVerificationOtpJobProcessing(requestId, { claimToken: currentToken, leaseExpiresAt: new Date(Date.now() + 60_000) })
    expect(await attemptGuestVerificationOtpJobCompleteWithToken(jobId, currentToken)).toBe(1)

    // Worker A, con el token obsoleto, llega DESPUÉS de que B ya completó.
    const staleFailAttempt = await attemptGuestVerificationOtpJobFailRetryableWithToken(jobId, staleToken)
    expect(staleFailAttempt).toBe(0)

    const finalJob = await findGuestVerificationOtpJob(requestId)
    expect(finalJob?.status).toBe('completed')
  })
})

describe('booking outbox — an expired/resolved request never receives a new OTP code (revisión 3, punto 5)', () => {
  it('closes the job without creating a challenge or sending mail once verificationExpiresAt has passed', async () => {
    const { requestId, guest } = await createAndCompleteInitialSend(27)
    // Simula un job atrasado (p. ej. reclamado por el barrido tras quedar
    // abandonado) que llega DESPUÉS de que la ventana de verificación ya
    // caducó — nunca debe enviar un código que nace inutilizable.
    await resetGuestVerificationOtpJobForTesting(requestId)
    await setBookingRequestStatusForTesting(requestId, { verificationExpiresAt: new Date(Date.now() - 60_000) })
    const before = await countMailboxMessagesForEmail(guest.email)

    const sweep = await runSweep()
    expect(sweep.status).toBe(200)

    expect(await countMailboxMessagesForEmail(guest.email)).toBe(before)
    const job = await findGuestVerificationOtpJob(requestId)
    expect(job).toMatchObject({ status: 'completed', last_error_code: null })

    // El código previo (del envío inicial) sigue siendo el único que
    // existió jamás para esta solicitud — nunca se generó uno nuevo.
    const code = await getLatestOtpCodeForEmail(guest.email)
    expect(code).toBeTruthy()
  })

  it('closes the job without sending once the request already resolved (e.g. verified through another path)', async () => {
    const { requestId, guest } = await createAndCompleteInitialSend(36)
    await resetGuestVerificationOtpJobForTesting(requestId)
    await setBookingRequestStatusForTesting(requestId, { status: 'verification_processing' })
    const before = await countMailboxMessagesForEmail(guest.email)

    const sweep = await runSweep()
    expect(sweep.status).toBe(200)

    expect(await countMailboxMessagesForEmail(guest.email)).toBe(before)
    const job = await findGuestVerificationOtpJob(requestId)
    expect(job).toMatchObject({ status: 'completed', last_error_code: null })
  })
})
