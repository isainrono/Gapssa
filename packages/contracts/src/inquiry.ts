import type { IdempotencyKey } from "./idempotency.ts";

/**
 * Formulario de consulta general: PLAN_DESARROLLO_WEB_PORTAL.md §14.
 * Crea una consulta en EspoCRM; idempotencyKey evita duplicados por reenvío.
 */
export interface GeneralInquiry {
  idempotencyKey: IdempotencyKey;
  name: string;
  email: string;
  phone: string;
  message: string;
  preferredChannel: "email" | "phone" | "whatsapp";
  preferredTimeWindow?: string;
  /** IDs de las versiones de consentimiento aceptadas al enviar el formulario. */
  acceptedConsentVersionIds: string[];
  submittedAt: string;
}
