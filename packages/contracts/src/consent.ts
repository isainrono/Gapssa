import type { IdempotencyKey } from "./idempotency.ts";

/**
 * Cuestionarios y consentimientos: PLAN_DESARROLLO_WEB_PORTAL.md §9.
 * EspoCRM es la fuente de verdad de la definición; estos tipos son el
 * contrato de lectura/escritura desde el portal.
 */

export type QuestionAnswerType =
  | "text"
  | "single_choice"
  | "multiple_choice"
  | "boolean";

export interface QuestionnaireQuestion {
  id: string;
  label: string;
  answerType: QuestionAnswerType;
  required: boolean;
  options?: string[];
}

export interface QuestionnaireDefinition {
  id: string;
  version: number;
  treatmentFamilyIds: string[];
  requiresGuardianAuthorization: boolean;
  effectiveFrom: string;
  status: "active" | "retired";
  questions: QuestionnaireQuestion[];
}

export interface QuestionnaireResponse {
  questionnaireId: string;
  questionnaireVersion: number;
  clientId: string;
  answers: Record<string, string | string[] | boolean>;
  submittedAt: string;
}

export type ConsentScope = "photos_private" | "photos_promotional" | "treatment";

export interface ConsentVersion {
  id: string;
  scope: ConsentScope;
  treatmentFamilyIds: string[];
  version: number;
  text: string;
  effectiveFrom: string;
  status: "active" | "retired";
}

// ---------------------------------------------------------------------------
// Firma: dos etapas (revisión 3 — corrige la revisión 2, que ya no
// persistía la imagen en el contrato definitivo pero seguía escribiendo el
// archivo en el almacén privado ANTES de verificar el OTP, sin ciclo de
// vida propio para ese estado intermedio).
// ---------------------------------------------------------------------------

export type SignatureUploadStatus = "temporary" | "promoted" | "discarded";

/**
 * Etapa 1 — temporal. La firma dibujada se sube antes de verificar el
 * OTP, a almacenamiento privado **temporal**: no es evidencia definitiva,
 * no es visible para el cliente ni para EspoCRM, y tiene TTL igual o
 * ligeramente superior al del OtpChallenge asociado (`otpChallengeId`).
 * Un job de limpieza (Fase 4) borra los archivos vencidos; si el OTP
 * caduca, queda bloqueado (`OtpVerificationResult` "locked"/"expired") o
 * el usuario abandona, el archivo se marca `discarded` y se elimina —
 * nunca queda huérfano en silencio.
 */
export interface TemporarySignatureUpload {
  id: string;
  /** Referencia opaca al almacenamiento temporal privado, nunca una URL pública ni un Data URL. */
  fileRef: string;
  mimeType: string;
  size: number;
  createdAt: string;
  expiresAt: string;
  otpChallengeId: string;
  status: SignatureUploadStatus;
}

/**
 * Pasos ordenados de la promoción, para poder reanudarla de forma
 * idempotente si falla a mitad: verificar OTP -> promover el archivo (
 * mover de temporal a definitivo + calcular/verificar hash) -> registrar
 * ConsentSignature en EspoCRM. Si falla EspoCRM después de promover el
 * archivo, un reintento con la misma `idempotencyKey` retoma desde
 * `espocrm_recorded` sin volver a mover el archivo ni crear un
 * ConsentSignature duplicado.
 */
export type SignaturePromotionStep = "otp_verified" | "file_promoted" | "espocrm_recorded";

export interface SignaturePromotionState {
  temporaryUploadId: string;
  idempotencyKey: IdempotencyKey;
  lastCompletedStep: SignaturePromotionStep | null;
  /** Se rellena en cuanto se completa "espocrm_recorded". */
  consentSignatureId: string | null;
}

/**
 * Etapa 2 — evidencia definitiva. Solo existe tras verificar el OTP con
 * éxito y promover el archivo. Se conserva la versión exacta del texto
 * aceptado (no solo el id de versión) porque el texto puede cambiar y el
 * histórico debe seguir siendo fiel. El código de verificación (OTP) que
 * confirmó la firma no se guarda aquí — ver otp.ts: se consume y se
 * descarta, nunca se persiste ni se audita.
 */
export interface ConsentSignature {
  id: string;
  consentVersionId: string;
  acceptedText: string;
  clientId: string;
  signedAt: string;
  /** Referencia privada al archivo ya promovido a almacenamiento definitivo (no el temporal). */
  signatureFileRef: string;
  /** Hash criptográfico (p. ej. SHA-256) del contenido del archivo de firma, verificado tras promover. */
  signatureHash: string;
  mimeType: string;
  size: number;
  createdAt: string;
  /** Momento en que el OTP asociado se verificó con éxito. */
  verifiedAt: string | null;
  ip: string;
  userAgent: string;
  revokedAt: string | null;
  /** Permite reintentar la promoción/registro de forma idempotente si EspoCRM falla tras mover el archivo. */
  idempotencyKey: IdempotencyKey;
}

export interface PendingRequirement {
  meetingId: string;
  type: "questionnaire" | "consent";
  referenceId: string;
  mandatory: boolean;
}
