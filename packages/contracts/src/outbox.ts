/**
 * Outbox mínimo para trabajo posterior a una transición de negocio que no
 * puede (o no debe) ejecutarse dentro de la misma transacción Postgres —
 * `docs/fase3-autenticacion.md`, revisión 4: `evaluateEspoLinkForNewAccount`
 * es hoy un adaptador simulado, pero está documentado como una futura
 * integración externa real (§6), así que nunca debe correr dentro de la
 * transacción que activa la cuenta. El job se encola en la MISMA
 * transacción que la activación (atómico con ella); su ejecución ocurre
 * después, de forma recuperable e idempotente.
 *
 * Cerrado a un único tipo de trabajo por ahora — añadir uno nuevo exige
 * traerlo aquí explícitamente, nunca un string libre.
 */

export const OUTBOX_JOB_TYPES = ["evaluate_espo_link"] as const;
export type OutboxJobType = (typeof OUTBOX_JOB_TYPES)[number];

export const OUTBOX_JOB_STATUSES = ["pending", "completed", "failed_retryable"] as const;
export type OutboxJobStatus = (typeof OUTBOX_JOB_STATUSES)[number];

/**
 * Motivo cerrado del último fallo, nunca un mensaje de excepción libre
 * (podría filtrar detalles internos o, en una integración real futura,
 * fragmentos de una respuesta de EspoCRM) — mismo principio que
 * `AuditReasonCode` en `audit.ts`.
 */
export const OUTBOX_JOB_ERROR_CODES = [
  "espo_link_adapter_error",
  "account_not_found",
  "unknown_error",
] as const;
export type OutboxJobErrorCode = (typeof OUTBOX_JOB_ERROR_CODES)[number];
