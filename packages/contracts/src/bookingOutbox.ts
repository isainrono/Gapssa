/**
 * Outbox de reservas (`gapssa_booking`) — mismo patrón que
 * `packages/contracts/src/outbox.ts` (Fase 3, `gapssa_auth`), con su
 * propio catálogo cerrado de tipos de trabajo/estados/motivos de error:
 * ambos outbox viven en bases de datos físicas distintas y no comparten
 * ningún significado de dominio (un `"espo_link_adapter_error"` de Fase 3
 * no tiene sentido para un job de envío de OTP de reserva, y viceversa) —
 * mismo razonamiento que mantener `BOOKING_REASON_CODES` separado de los
 * motivos de `gapssa_auth`.
 *
 * Revisión 2 de Fase 4A, punto 3: entrega recuperable del OTP de
 * verificación de invitado. El job NUNCA lleva el código OTP en claro (ni
 * cifrado) — el reto (`OtpChallenge`, Redis) se crea/rota durante el
 * PROCESAMIENTO del job, nunca antes ni al encolarlo; el job solo
 * referencia `bookingRequestId`. Un intento fallido (Redis o SMTP) deja el
 * job `failed_retryable` con backoff — nunca se asume "exactly-once" sobre
 * SMTP: un reintento puede enviar un segundo correo con un código nuevo (el
 * anterior queda invalidado en Redis por el propio mecanismo de puntero
 * único de `otpService.ts` — nunca coexisten dos códigos vivos para la
 * misma solicitud). Ver `server/booking/otpOutbox.ts`.
 */

export const BOOKING_OUTBOX_JOB_TYPES = ["send_guest_verification_otp"] as const;
export type BookingOutboxJobType = (typeof BOOKING_OUTBOX_JOB_TYPES)[number];

/**
 * `"processing"` existe aquí (a diferencia del outbox de Fase 3) porque el
 * procesamiento de este job cruza dos sistemas de I/O real con latencia
 * impredecible (Redis + SMTP) y necesita un estado propio para el CLAIM
 * transaccional que evita el doble envío concurrente — el reclamo
 * (`pending`/`failed_retryable` -> `processing`) es una única sentencia
 * `UPDATE ... WHERE ... RETURNING`, atómica sin necesidad de mantener
 * abierta una transacción de Postgres mientras se llama a Redis/SMTP.
 *
 * Revisión 3 de Fase 4A: el reclamo lleva lease (`claimToken`/`claimedAt`/
 * `leaseExpiresAt`, `server/booking/db/schema.ts`) — solo el poseedor del
 * `claimToken` vigente puede escribir `completed`/`failed_retryable`; un
 * worker cuyo lease venció y fue recuperado por otro nunca sobrescribe el
 * resultado del nuevo. `nextAttemptAt` (`failed_retryable`) y
 * `leaseExpiresAt` (`processing`) los respeta tanto el reclamo dirigido
 * (`claimGuestVerificationOtpJob`, por `bookingRequestId`) como el disparador
 * durable del barrido (`listEligibleGuestVerificationOtpJobs` +
 * `reconciliation.ts::sweepOutboxJobs`, punto 4) — ya no son campos
 * reservados para un futuro runner, ambos caminos los consultan hoy.
 */
export const BOOKING_OUTBOX_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed_retryable",
] as const;
export type BookingOutboxJobStatus = (typeof BOOKING_OUTBOX_JOB_STATUSES)[number];

export const BOOKING_OUTBOX_JOB_ERROR_CODES = [
  "otp_issue_failed",
  "otp_rate_limited",
  "mail_send_failed",
  "booking_request_not_pending",
  "booking_request_not_found",
  "unknown_error",
] as const;
export type BookingOutboxJobErrorCode = (typeof BOOKING_OUTBOX_JOB_ERROR_CODES)[number];
