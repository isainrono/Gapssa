import 'server-only'

import { sendMail } from '../auth/mailer'
import { requestOtp } from '../auth/otpService'
import {
  claimGuestVerificationOtpJob,
  findBookingRequestById,
  linkOtpChallengeIfPending,
  markGuestVerificationOtpJobCompleted,
  markGuestVerificationOtpJobFailedRetryable,
} from './repository'
import { BOOKING_TIME_ZONE } from './timezone'
import { decryptGuestIdentity } from './verificationSteps'

/**
 * Orquestación del envío del OTP de verificación de invitado — revisión 2
 * de Fase 4A, punto 3; leases y disparador durable de revisión 3, puntos
 * 1-5. El job en sí (`booking_outbox_jobs`, `repository.ts`) se crea
 * SIEMPRE dentro de la misma transacción que el `BookingRequestRecord` +
 * `PendingGuestIdentity` + evento `ClientRequested`
 * (`repository.ts::createGuestBookingRequest`). `processGuestVerificationOtpJob`
 * se invoca DESPUÉS, fuera de esa transacción — justo tras el commit, en
 * modo best-effort desde `guestFlow.ts` (siempre, ya no solo cuando una
 * comprobación previa cree que hay un job pendiente — punto 3), en
 * cualquier reintento idempotente, y ahora también desde el disparador
 * durable del barrido (`reconciliation.ts::sweepOutboxJobs`, punto 4) — un
 * fallo aquí nunca hace fallar la respuesta HTTP de creación, que ya tuvo
 * éxito (el `BookingRequestRecord` existe y es recuperable).
 *
 * El código OTP NUNCA se persiste en Postgres, en auditoría ni en logs — el
 * reto (`OtpChallenge`, Redis, `otpService.ts`) se crea/rota DURANTE el
 * procesamiento de este job, nunca antes: encolarlo no genera ningún
 * código. `otpChallengeId` se vincula al `BookingRequestRecord` justo antes
 * de enviar el correo (durable en Postgres, fuente de verdad de "qué reto
 * es el vigente" — `verifyGuestBooking`, `guestFlow.ts`).
 *
 * No hay garantía "exactly-once" sobre SMTP (nunca se inventa una): un
 * reintento tras un fallo incierto (p. ej. el proceso cae justo después de
 * que el SMTP aceptara el mensaje pero antes de marcar el job `completed`)
 * puede reenviar un SEGUNDO correo con un código nuevo. Esto es seguro
 * porque `requestOtp` invalida el reto anterior para el mismo
 * propósito+sujeto antes de publicar el nuevo puntero (`otpService.ts`):
 * nunca coexisten dos códigos vivos para la misma solicitud — como mucho,
 * el código de un correo anterior deja de funcionar silenciosamente si
 * llegó a entregarse un segundo correo más reciente. El lease de revisión 3
 * (`claimToken`) evita una corrupción distinta — que DOS workers escriban
 * el bookkeeping final del MISMO job pisándose entre sí — nunca pretende
 * evitar el correo duplicado de SMTP en sí, que sigue siendo posible y
 * queda documentado aquí a propósito, no es un caso no contemplado.
 */

export type ProcessGuestVerificationOtpJobOutcome = 'sent' | 'rate_limited' | 'failed_retryable' | 'expired' | 'no_eligible_job'

export async function processGuestVerificationOtpJob(
  bookingRequestId: string,
  now: Date = new Date(),
): Promise<ProcessGuestVerificationOtpJobOutcome> {
  const job = await claimGuestVerificationOtpJob(bookingRequestId, now)
  if (!job) {
    // Nada elegible: `completed`, `processing` con lease todavía fresco (lo
    // posee otro worker AHORA MISMO), o `failed_retryable` cuyo
    // `nextAttemptAt` todavía no llegó — el reclamo (repository.ts) es la
    // ÚNICA fuente de verdad sobre elegibilidad; esta función nunca repite
    // esa decisión con una comprobación propia más estrecha (revisión 3,
    // punto 3).
    return 'no_eligible_job'
  }
  const { claimToken } = job

  // Revisión 3, punto 5: comprobación ANTES de crear/rotar el reto OTP (y,
  // por tanto, antes de gastar ningún envío) — un job atrasado (reclamado
  // por el barrido tras quedar `processing` abandonado, o reintentado tras
  // un fallo) nunca debe enviar un código que nace inutilizable porque la
  // solicitud ya caducó o se resolvió por otro camino mientras tanto. Esta
  // comprobación usa el `now` capturado por Node y es SOLO una salida
  // rápida — evita gastar un reto de Redis para nada — nunca la garantía:
  // `now` puede quedar desfasado respecto al reloj real de Postgres para
  // cuando la vinculación de abajo se ejecuta. La comprobación
  // AUTORITATIVA y libre de carreras es el CAS atómico de
  // `linkOtpChallengeIfPending`, que compara contra el reloj de Postgres en
  // el mismo instante en que escribe, así que ninguna solicitud puede
  // caducar en el hueco entre esta comprobación y la vinculación real del
  // reto.
  const record = await findBookingRequestById(bookingRequestId)
  if (!record || record.status !== 'pending_verification' || record.verificationExpiresAt.getTime() <= now.getTime()) {
    await markGuestVerificationOtpJobCompleted(job.id, claimToken, now)
    return 'expired'
  }

  const identity = await decryptGuestIdentity(bookingRequestId)
  if (!identity) {
    // PendingGuestIdentity ya no existe (purgada por otro camino) — no hay
    // nada más que enviar; nunca reintentable, se marca completado para no
    // reintentar indefinidamente un trabajo que ya no tiene sentido.
    await markGuestVerificationOtpJobCompleted(job.id, claimToken, now)
    return 'no_eligible_job'
  }

  let otpResult: Awaited<ReturnType<typeof requestOtp>>
  try {
    otpResult = await requestOtp('guest_email_verification', bookingRequestId)
  } catch {
    await markGuestVerificationOtpJobFailedRetryable(job.id, claimToken, job.attempts, 'otp_issue_failed', now)
    return 'failed_retryable'
  }

  if (otpResult.outcome === 'rate_limited') {
    await markGuestVerificationOtpJobFailedRetryable(job.id, claimToken, job.attempts, 'otp_rate_limited', now)
    return 'rate_limited'
  }

  // Autorización de envío: se decide EN EL INSTANTE de este CAS (reloj de
  // Postgres, `repository.ts::linkOtpChallengeIfPending`) — si el plazo
  // seguía vigente cuando el CAS ganó, el envío posterior es válido aunque
  // el propio SMTP tarde unos segundos más; no se vuelve a comprobar el
  // plazo después. `verificationExpiresAt` nunca se extiende aquí (ni en
  // ningún reenvío): el correo comunica el vencimiento absoluto real leído
  // de `record` ANTES del CAS (columna que un `UPDATE` ganador nunca
  // modifica), nunca una ventana completa nueva — si el job se retrasó
  // (reintento, recuperación del barrido), parte de la ventana original ya
  // pudo transcurrir.
  const linkOutcome = await linkOtpChallengeIfPending(bookingRequestId, otpResult.challengeId)
  if (linkOutcome !== 'linked') {
    // La solicitud dejó de ser `pending_verification` con plazo vivo justo
    // en esta ventana (resuelta/caducada por otro camino mientras tanto,
    // p. ej. el barrido de expiración concurrente) — enviar el correo ya
    // no tiene sentido; completado, no reintentable. El reto recién creado
    // en Redis queda huérfano sin vincular, lo que es seguro: nunca se
    // envía, y `requestOtp` lo sustituirá/invalidará en cualquier intento
    // futuro para el mismo propósito+sujeto si llegara a hacer falta.
    await markGuestVerificationOtpJobCompleted(job.id, claimToken, now)
    return 'expired'
  }

  const expiresAtLabel = new Intl.DateTimeFormat('es-ES', {
    timeZone: BOOKING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(record.verificationExpiresAt)

  try {
    await sendMail({
      to: identity.email,
      subject: 'Confirma tu solicitud de reserva — GAPSSA',
      text: `Tu código para confirmar la solicitud de reserva es: ${otpResult.code}\n\nCaduca a las ${expiresAtLabel} (hora de España). Si no has solicitado esto, ignora este correo.`,
    })
  } catch {
    await markGuestVerificationOtpJobFailedRetryable(job.id, claimToken, job.attempts, 'mail_send_failed', now)
    return 'failed_retryable'
  }

  // Si esto devuelve 'lease_lost' (otro worker ya recuperó el lease y
  // reclamó el job de nuevo antes de que esta escritura llegara), el
  // correo YA se envió desde este worker — nunca se convierte eso en un
  // error ni se reintenta desde aquí: el nuevo propietario decide el
  // destino final del job. Ver comentario de cabecera sobre "exactly-once".
  await markGuestVerificationOtpJobCompleted(job.id, claimToken, now)
  return 'sent'
}
