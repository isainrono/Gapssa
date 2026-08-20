import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { bookingApi, CookieJar, countMailboxMessagesForEmail, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import {
  attemptLinkOtpChallenge,
  auditRowsForBookingEntity,
  findBookingRequestRow,
  findGuestVerificationOtpJob,
  resetGuestVerificationOtpJobForTesting,
  selectDbNow,
  setBookingRequestStatusForTesting,
} from './bookingDb'

/**
 * Outbox de envío del OTP de invitado — revisión 2 de Fase 4A, punto 3.
 * `booking.guestFlow.int.test.ts` ya ejercita el camino feliz de extremo a
 * extremo (crear -> recibir OTP por el buzón SMTP de pruebas -> verificar);
 * este archivo se centra en lo que ese camino feliz no cubre: que el
 * código nunca aparece en Postgres/auditoría, y que un reintento
 * concurrente del job nunca duplica el envío. El estado de recuperación
 * ante fallo de Redis/SMTP (before/after el intento de entrega) está
 * cubierto a nivel unitario en `src/server/booking/otpOutbox.test.ts` —
 * el proceso de pruebas de integración no comparte memoria con el
 * servidor `next dev` real que atiende estas peticiones, así que no hay
 * forma determinista de forzar una caída de SMTP real para UN solo
 * archivo de pruebas sin afectar al resto de la suite (el buzón SMTP
 * efímero es compartido, `global-setup.ts`).
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

// Franja horaria EXCLUSIVA de este archivo para el test de "reintento tras
// expirar" — todo `treatment-masaje-relajante-60`/`professional-owner`/
// `zone-cabina-1` a las 10:00 UTC ya está repartido, sin ningún hueco de
// día hábil libre por debajo del horizonte máximo
// (`MAX_LEAD_TIME_DAYS = 60`, packages/contracts/src/booking.ts) entre
// TODOS los ficheros que comparten ese trío (booking.{approvalSweep,
// authenticatedFlow,concurrency,otpOutbox,auditAtomicity,guestFlow,
// outboxLease,decisionRecovery,sweepRecovery}.int.test.ts, offsets 1-51
// todos ya en uso). Un hueco horario distinto (11:00 UTC, no usado en
// ningún fichero de la suite — verificado por grep) evita la colisión sin
// tocar ningún offset ya usado por otro archivo.
function nextBusinessDayAt11Utc(n: number): string {
  const date = new Date()
  date.setUTCHours(11, 0, 0, 0)
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
  return {
    firstName: 'Otilia',
    lastName: 'Outbox',
    phone: '+34 600 111 222',
    email: `outbox-${unique}@example.test`,
  }
}

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es')
  return jar
}

const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-1'
const PROFESSIONAL_ID = 'professional-owner'

describe('booking outbox — send_guest_verification_otp', () => {
  it('never persists the OTP code in booking_outbox_jobs, booking_request_records or booking_audit_log', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const startAt = nextBusinessDayAt10Utc(12)

    const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt,
      guest,
    })
    expect(create.status).toBe(202)
    const requestId = create.body.requestId as string

    const code = await getLatestOtpCodeForEmail(guest.email)
    expect(code).toBeTruthy()

    const job = await findGuestVerificationOtpJob(requestId)
    expect(job).toMatchObject({ status: 'completed', last_error_code: null })
    expect(JSON.stringify(job)).not.toContain(code as string)

    const record = await findBookingRequestRow(requestId)
    expect(JSON.stringify(record)).not.toContain(code as string)
    expect(JSON.stringify(record)).not.toContain(guest.email)
    expect(JSON.stringify(record)).not.toContain(guest.firstName)

    const auditRows = await auditRowsForBookingEntity('BookingRequestRecord', requestId)
    expect(auditRows.length).toBeGreaterThan(0)
    expect(JSON.stringify(auditRows)).not.toContain(code as string)
    expect(JSON.stringify(auditRows)).not.toContain(guest.email)
  })

  it('an idempotent replay detects and retries a pending job instead of silently claiming success — never sends more than one email per attempt actually won', async () => {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const idempotencyKey = randomUUID()
    const startAt = nextBusinessDayAt10Utc(13)
    const payload = { idempotencyKey, treatmentId: TREATMENT_ID, professionalId: PROFESSIONAL_ID, zoneId: ZONE_ID, startAt, guest }

    const create = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
    expect(create.status).toBe(202)
    const requestId = create.body.requestId as string

    expect(await getLatestOtpCodeForEmail(guest.email)).toBeTruthy()
    expect(await countMailboxMessagesForEmail(guest.email)).toBe(1)

    // Simula que el intento original se quedó sin enviar (p. ej. SMTP caído
    // en su momento) — sin este reset, el replay no encontraría ningún job
    // pendiente que reintentar, porque ya se completó en el primer intento.
    await resetGuestVerificationOtpJobForTesting(requestId)

    // Dos reintentos idempotentes CONCURRENTES con la misma idempotencyKey
    // — el reclamo atómico del job (repository.ts::claimGuestVerificationOtpJob)
    // garantiza que como mucho uno de los dos gana el reenvío real.
    const [jarA, jarB] = await Promise.all([freshJarWithCsrf(), freshJarWithCsrf()])
    const [replayA, replayB] = await Promise.all([
      bookingApi.post(jarA, '/api/booking/v1/requests', payload),
      bookingApi.post(jarB, '/api/booking/v1/requests', payload),
    ])
    expect(replayA.status).toBe(202)
    expect(replayB.status).toBe(202)
    expect(replayA.body.requestId).toBe(requestId)
    expect(replayB.body.requestId).toBe(requestId)

    // Exactamente un correo MÁS (el reintento ganador) — nunca dos.
    expect(await countMailboxMessagesForEmail(guest.email)).toBe(2)

    const job = await findGuestVerificationOtpJob(requestId)
    expect(job?.status).toBe('completed')
  })
})

/**
 * `linkOtpChallengeIfPending` (`repository.ts`) — el CAS atómico que
 * autoriza vincular un reto OTP vigente. El reloj autoritativo del `WHERE`
 * es EL DE POSTGRES (`now()`), nunca un `Date` capturado antes en Node: un
 * `now` de Node puede quedar desfasado del reloj real de la base para
 * cuando la sentencia se ejecuta (creación/rotación del reto en Redis,
 * espera de conexión, etc. de por medio). Estas pruebas ejercitan el
 * predicado SQL real (`bookingDb.ts::attemptLinkOtpChallenge`, misma
 * reproducción de `WHERE` que `attemptGuestVerificationOtpJobCompleteWithToken`)
 * contra una solicitud real en Postgres — nunca un mock de la función — y
 * anclan cada límite al reloj real de la base (`selectDbNow`), nunca a
 * `Date.now()` de este proceso de pruebas.
 */
describe('linkOtpChallengeIfPending — CAS atómico anclado al reloj de Postgres', () => {
  interface PendingVerificationRequest {
    requestId: string
    guestEmail: string
    idempotencyKey: string
    payload: Record<string, unknown>
  }

  async function createPendingVerificationRequest(
    dayOffset: number,
    // Por defecto 10:00 UTC (igual que siempre) — el único uso de 11:00 UTC
    // es el test de "reintento tras expirar" de más abajo, que necesita un
    // hueco propio (ver nextBusinessDayAt11Utc arriba).
    slotBuilder: (n: number) => string = nextBusinessDayAt10Utc,
  ): Promise<PendingVerificationRequest> {
    const jar = await freshJarWithCsrf()
    const guest = freshGuest()
    const idempotencyKey = randomUUID()
    const startAt = slotBuilder(dayOffset)
    const payload = { idempotencyKey, treatmentId: TREATMENT_ID, professionalId: PROFESSIONAL_ID, zoneId: ZONE_ID, startAt, guest }
    const create = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
    expect(create.status).toBe(202)
    const requestId = create.body.requestId as string
    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('pending_verification')
    return { requestId, guestEmail: guest.email, idempotencyKey, payload }
  }

  it('does not link once verification_expires_at is already in the past per the DATABASE clock — a stale Node `now` would have wrongly authorized this', async () => {
    // Offset 35 a las 10:00 UTC colisiona con
    // booking.sweepRecovery.int.test.ts (mismo treatment/professional/
    // zone, mismo offset 35 preexistente en ambos archivos — colisión
    // latente ya presente antes de esta sesión, que no siempre se
    // manifestaba según el orden real de ejecución). Mismo tratamiento que
    // el resto de este archivo: 11:00 UTC, offset propio sin colisión.
    const { requestId } = await createPendingVerificationRequest(22, nextBusinessDayAt11Utc)

    const dbNow = await selectDbNow()
    await setBookingRequestStatusForTesting(requestId, { verificationExpiresAt: new Date(dbNow.getTime() - 60_000) })
    // Capturado DESPUÉS de fijar el plazo pasado a propósito (parte del
    // montaje de la prueba) — la comparación de abajo aísla lo que hace el
    // CAS EN SÍ, no el montaje.
    const before = await findBookingRequestRow(requestId)

    const affected = await attemptLinkOtpChallenge(requestId, 'race-challenge-past')
    expect(affected).toBe(0)

    const after = await findBookingRequestRow(requestId)
    expect(after?.otp_challenge_id).toBe(before?.otp_challenge_id)
    expect(after?.status).toBe('pending_verification')
    // Ningún segundo plazo ni extensión del existente por una CAS perdida.
    expect(after?.verification_expires_at).toEqual(before?.verification_expires_at)
  })

  it('links while verification_expires_at is still in the future per the DATABASE clock, and never touches verification_expires_at itself', async () => {
    const { requestId } = await createPendingVerificationRequest(37)

    const dbNow = await selectDbNow()
    const futureExpiry = new Date(dbNow.getTime() + 5 * 60_000)
    await setBookingRequestStatusForTesting(requestId, { verificationExpiresAt: futureExpiry })

    const affected = await attemptLinkOtpChallenge(requestId, 'race-challenge-future')
    expect(affected).toBe(1)

    const after = await findBookingRequestRow(requestId)
    expect(after?.otp_challenge_id).toBe('race-challenge-future')
    expect(new Date(after?.verification_expires_at as string).getTime()).toBe(futureExpiry.getTime())
  })

  it('does not link exactly at the boundary — an expiry set to the database\'s own "now" is already in the past by the time the CAS statement runs', async () => {
    const { requestId } = await createPendingVerificationRequest(38)

    const dbNow = await selectDbNow()
    await setBookingRequestStatusForTesting(requestId, { verificationExpiresAt: dbNow })

    const affected = await attemptLinkOtpChallenge(requestId, 'race-challenge-boundary')
    expect(affected).toBe(0)
  })

  it('never authorizes linking once the request left pending_verification, even with a deadline still live per the database clock', async () => {
    const { requestId } = await createPendingVerificationRequest(39)

    const dbNow = await selectDbNow()
    await setBookingRequestStatusForTesting(requestId, {
      status: 'verification_processing',
      verificationExpiresAt: new Date(dbNow.getTime() + 5 * 60_000),
    })

    const affected = await attemptLinkOtpChallenge(requestId, 'race-challenge-wrong-status')
    expect(affected).toBe(0)
  })

  it('a retried job for a request already expired per Postgres completes without sending mail or linking a new challenge — real end-to-end path, not a mock', async () => {
    // El otpOutbox.test.ts unitario ya cubre el branch exacto "el CAS
    // devuelve not_pending" en aislamiento (mock). Esta prueba complementa
    // eso contra el servidor real: una solicitud cuyo plazo ya venció SEGÚN
    // POSTGRES (nunca según el reloj de este proceso de pruebas) nunca
    // produce un correo nuevo ni una vinculación nueva, la rechace la
    // comprobación rápida de Node o el CAS mismo — ambas anclan al mismo
    // valor real de `verification_expires_at`, así que el resultado
    // observable es idéntico en cualquiera de los dos casos.
    // Offsets 1-51 a las 10:00 UTC están TODOS ya en uso por algún fichero
    // de la suite de integración que comparte
    // treatment-masaje-relajante-60/professional-owner/zone-cabina-1
    // (booking.{approvalSweep,authenticatedFlow,concurrency,otpOutbox,
    // auditAtomicity,guestFlow,outboxLease,decisionRecovery,sweepRecovery}
    // .int.test.ts) — y 52+ supera `MAX_LEAD_TIME_DAYS = 60`
    // (packages/contracts/src/booking.ts) en el peor caso, con 400
    // `horizon_violation`. Se usa 11:00 UTC (franja no usada en ningún
    // fichero de la suite) en vez de pelear por un hueco de día ya
    // agotado.
    const { requestId, guestEmail, payload } = await createPendingVerificationRequest(20, nextBusinessDayAt11Utc)

    // El primer envío ya completó el job (camino feliz de creación). Lo
    // reabrimos a `pending` para simular un reintento — y adelantamos el
    // plazo al pasado SEGÚN EL RELOJ DE POSTGRES antes de dispararlo.
    const mailsBefore = await countMailboxMessagesForEmail(guestEmail)

    const dbNow = await selectDbNow()
    await setBookingRequestStatusForTesting(requestId, { verificationExpiresAt: new Date(dbNow.getTime() - 60_000) })
    // Capturado DESPUÉS de fijar el plazo pasado a propósito — la
    // comparación de abajo aísla lo que hace el reintento EN SÍ.
    const before = await findBookingRequestRow(requestId)
    await resetGuestVerificationOtpJobForTesting(requestId)

    // Misma idempotencyKey que la creación original — un reintento
    // idempotente de la MISMA solicitud, nunca una nueva.
    const jar = await freshJarWithCsrf()
    const replay = await bookingApi.post(jar, '/api/booking/v1/requests', payload)
    expect(replay.status).toBe(202)
    expect(replay.body.requestId).toBe(requestId)

    // Ningún correo NUEVO — la solicitud ya había vencido según Postgres.
    expect(await countMailboxMessagesForEmail(guestEmail)).toBe(mailsBefore)

    const job = await findGuestVerificationOtpJob(requestId)
    expect(job?.status).toBe('completed')

    const after = await findBookingRequestRow(requestId)
    expect(after?.otp_challenge_id).toBe(before?.otp_challenge_id)
    expect(after?.verification_expires_at).toEqual(before?.verification_expires_at)
  })
})
