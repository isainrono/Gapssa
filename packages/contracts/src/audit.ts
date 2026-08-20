import { ESTADOS_RESERVA, ESTADOS_MEETING_NATIVOS } from "./estado-reserva.ts";
import {
  BOOKING_REQUEST_STATUSES,
  BOOKING_REQUEST_RESOLUTIONS,
  BOOKING_LOCK_PHASES,
  BOOKING_REVIEW_STATUSES,
  CANCELLATION_REQUEST_STATUSES,
  PENDING_GUEST_IDENTITY_STATUSES,
} from "./booking.ts";
import {
  CLIENT_ACCOUNT_STATUSES,
  ESPO_LINK_STATUSES,
  INDEPENDENCE_STATUSES,
  SESSION_REVOKED_REASONS,
  EMAIL_VERIFICATION_REQUEST_STATUSES,
  PASSWORD_RESET_REQUEST_STATUSES,
  GUARDIAN_LINK_STATUSES,
  INDEPENDENCE_REQUEST_STATUSES,
} from "./auth.ts";

/**
 * Registro de auditoría genérico: PROJECT_CONTEXT.md §14 exige valor
 * anterior, valor nuevo, fecha, usuario o sistema, canal y motivo en cada
 * cambio sensible. PLAN_DESARROLLO_WEB_PORTAL.md §15 prohíbe registrar
 * cuerpos de cuestionarios, firmas, tokens o contraseñas en logs.
 *
 * Revisión 4: la revisión 3 solo limitaba el *tamaño* de
 * `previousValue`/`newValue`/`redactedValue`/`reason` — eso no impedía
 * guardar una contraseña corta, un OTP, un token corto o una respuesta
 * breve de cuestionario, todos ellos igual de cortos que un enum
 * legítimo. Esta revisión sustituye el límite de tamaño por una política
 * de **dominio verificable**:
 *
 * - Valores en crudo: solo se aceptan si pertenecen literalmente al enum
 *   real de ese campo (§A) — cualquier otro valor se rechaza, sea cual
 *   sea su longitud.
 * - `redactedValue`: deja de ser texto libre; es un objeto estructurado
 *   con formato de hash validado (§B).
 * - `reason` desaparece de `AuditEntry`: se sustituye por `reasonCode`
 *   (enum cerrado de motivos técnicos). Cualquier nota humana vive en el
 *   sistema responsable (EspoCRM), no aquí — ver §C y
 *   docs/contratos-portal-v1.md.
 */

export type AuditActor =
  | { type: "user"; id: string }
  /**
   * Referencia opaca al invitado (= BookingRequestRecord.id), nunca su
   * correo ni teléfono — ni siquiera indirectamente vía
   * PendingGuestIdentity, que ni siquiera guarda esos datos en claro (ver
   * booking.ts).
   */
  | { type: "guest"; guestId: string }
  | { type: "system"; name: "n8n" | "espocrm" | "bff" | "gcs-sweep" };

export const AUDIT_CHANNELS = [
  "web",
  "admin_espocrm",
  "n8n",
  "google_calendar",
  "email",
] as const;
export type AuditChannel = (typeof AUDIT_CHANNELS)[number];

/**
 * Motivos técnicos cerrados. Un rechazo humano de Gapssa (por ejemplo) se
 * registra aquí como `"RejectedByStaff"`; el texto que Gapssa haya escrito
 * al rechazar, si lo hay, vive en EspoCRM (p. ej. en el propio Meeting o
 * en `CSolicitudCancelacion.motivo`) — la auditoría referencia que hubo
 * una decisión y de qué tipo, nunca copia la nota. Ver
 * docs/contratos-portal-v1.md §7 para la separación completa entre
 * evento estructurado (aquí) y nota operativa (en el sistema responsable).
 */
export const AUDIT_REASON_CODES = [
  "ApprovedByStaff",
  "RejectedByStaff",
  "ApprovalExpired",
  "VerificationExpired",
  "RecoveryWindowExceeded",
  "ClientRequested",
  "SystemReconciliation",
  // --- Fase 4B (booking.ts, matching de Contact contra EspoCRM real) ---
  "ContactAmbiguous",
  // --- Revisión 2 de Fase 4B: catálogo cerrado 1:1 con
  // BOOKING_REVIEW_CONFLICT_TYPES (booking.ts) — "ContactAmbiguous" queda
  // como el motivo de "contact_multiple_matches"; los siguientes cinco
  // cubren el resto de conflictType posibles de BookingReviewRecord, y las
  // dos últimas los cierres terminales de una revisión que no vincula
  // Meeting (rechazo/caducidad, ver BOOKING_REASON_CODES en booking.ts).
  "ContactConflictingSignals",
  "MeetingDuplicate",
  "MeetingContactMissing",
  "MeetingContactMismatch",
  "MeetingMultipleContacts",
  "ContactReviewRejectedByStaff",
  "ContactReviewExpired",
  // --- Revisión 3 de Fase 4B, punto 2: workflow durable de resolución ---
  "MeetingIncompatibleDuringResume",
  "ContactReviewReplaced",
  // --- Puerta 5B-2A: mecanismo TEMPORAL de pruebas controladas, no una
  // regla de negocio normal — ver "meeting_gcs_exclusion_mismatch" en
  // BOOKING_REVIEW_CONFLICT_TYPES (booking.ts). ---
  "MeetingGcsExclusionMismatch",
  // --- Revisión 4 de Fase 4B, punto 2: barrido cierra una revisión activa
  // cuya solicitud ya demuestra un resultado durable de éxito (Meeting
  // vinculado) — nunca una decisión de Contact, solo bookkeeping.
  "ContactReviewReconciledAfterBookingLinked",
  // --- Fase 3 (auth.ts) ---
  "AccountRegistered",
  "AccountEmailVerified",
  "LoginSucceeded",
  "LoginFailedInvalidCredentials",
  "LoginFailedAccountNotVerified",
  "LoginFailedAccountSuspended",
  "LoginRateLimited",
  "LogoutRequested",
  "SessionRevokedByUser",
  "SessionRevokedByAdmin",
  "SessionRevokedByPasswordChange",
  "SessionExpiredIdle",
  "SessionExpiredAbsolute",
  "PasswordResetRequested",
  "PasswordResetCompleted",
  "GuardianLinkRequested",
  "GuardianLinkConfirmed",
  "GuardianLinkRevoked",
  "IndependenceRequested",
  "IndependenceGranted",
  "IndependenceRejected",
  "AccountDeletionRequested",
  "EspoLinkProposed",
  "EspoLinkApprovedByStaff",
  "EspoLinkRejectedByStaff",
] as const;
export type AuditReasonCode = (typeof AUDIT_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// §A. Valores en crudo: un validador de dominio real por cada
// combinación Entity.field, no un límite de tamaño. Cualquier valor que no
// pertenezca literalmente al enum correspondiente se rechaza.
// ---------------------------------------------------------------------------

type RawValueValidator = (value: unknown) => boolean;

function enumValidator(allowed: readonly string[]): RawValueValidator {
  return (value: unknown) => typeof value === "string" && allowed.includes(value);
}

function nullableEnumValidator(allowed: readonly string[]): RawValueValidator {
  return (value: unknown) => value === null || (typeof value === "string" && allowed.includes(value));
}

/**
 * Única fuente de verdad de qué combinaciones `Entity.field` pueden llevar
 * `previousValue`/`newValue` en crudo, y contra qué dominio se validan.
 * Añadir un campo nuevo a esta lista exige traer su enum real, no inventar
 * una regex o un límite de longitud.
 */
const RAW_VALUE_VALIDATORS: ReadonlyMap<string, RawValueValidator> = new Map([
  ["Meeting.cEstadoReserva", enumValidator(ESTADOS_RESERVA)],
  ["Meeting.status", enumValidator(ESTADOS_MEETING_NATIVOS)],
  ["CSolicitudCancelacion.estado", enumValidator(CANCELLATION_REQUEST_STATUSES)],
  ["BookingRequestRecord.status", enumValidator(BOOKING_REQUEST_STATUSES)],
  ["BookingRequestRecord.resolution", nullableEnumValidator(BOOKING_REQUEST_RESOLUTIONS)],
  ["BookingLock.phase", enumValidator(BOOKING_LOCK_PHASES)],
  // nullable: la primera transición de una revisión nueva es null -> "pending".
  ["BookingReviewRecord.status", nullableEnumValidator(BOOKING_REVIEW_STATUSES)],
  ["PendingGuestIdentity.status", enumValidator(PENDING_GUEST_IDENTITY_STATUSES)],
  // Revisión 3 de Fase 4B, punto 6: PendingAuthenticatedContactDetails
  // comparte el mismo catálogo de estados que PendingGuestIdentity
  // (PENDING_GUEST_IDENTITY_STATUSES, ver booking.ts §PendingContactDetailsPurgeTrigger)
  // pero es una ENTIDAD distinta a efectos de auditoría — antes de esta
  // revisión, repository.ts auditaba las purgas del cliente autenticado
  // bajo "PendingGuestIdentity", mezclando dos entidades reales distintas
  // bajo el mismo nombre en booking_audit_log.
  ["PendingAuthenticatedContactDetails.status", enumValidator(PENDING_GUEST_IDENTITY_STATUSES)],
  // --- Fase 3 (auth.ts) ---
  ["ClientAccount.status", enumValidator(CLIENT_ACCOUNT_STATUSES)],
  ["ClientAccount.espoLinkStatus", enumValidator(ESPO_LINK_STATUSES)],
  ["ClientAccount.independenceStatus", enumValidator(INDEPENDENCE_STATUSES)],
  ["Session.revokedReason", nullableEnumValidator(SESSION_REVOKED_REASONS)],
  ["EmailVerificationRequest.status", enumValidator(EMAIL_VERIFICATION_REQUEST_STATUSES)],
  ["PasswordResetRequest.status", enumValidator(PASSWORD_RESET_REQUEST_STATUSES)],
  ["GuardianLink.status", enumValidator(GUARDIAN_LINK_STATUSES)],
  ["IndependenceRequest.status", enumValidator(INDEPENDENCE_REQUEST_STATUSES)],
]);

/** true si `entity.field` tiene un validador de dominio registrado (y por tanto puede llevar valores en crudo). */
export function isRawValueAuditable(entity: string, field: string): boolean {
  return RAW_VALUE_VALIDATORS.has(`${entity}.${field}`);
}

/** true si `value` pertenece al dominio permitido de `entity.field`. false también si el campo no está en la allowlist. */
export function isValidRawValue(entity: string, field: string, value: unknown): boolean {
  const validator = RAW_VALUE_VALIDATORS.get(`${entity}.${field}`);
  return validator !== undefined && validator(value);
}

// ---------------------------------------------------------------------------
// §B. redactedValue estructurado: nunca texto libre. Un hash con
// metadatos mínimos y no sensibles sobre qué cambió.
// ---------------------------------------------------------------------------

export const REDACTED_VALUE_ALGORITHMS = ["sha256", "hmac-sha256"] as const;
export type RedactedValueAlgorithm = (typeof REDACTED_VALUE_ALGORITHMS)[number];

/**
 * Categoría no sensible de qué tipo de cambio se redactó — nunca el
 * contenido. Cerrado a propósito: si hace falta una categoría nueva, se
 * añade aquí explícitamente, nunca como texto libre.
 */
export const REDACTED_VALUE_CHANGE_KINDS = [
  "signature_replaced",
  "questionnaire_answered",
  "document_uploaded",
  "note_updated",
  "credential_rotated",
] as const;
export type RedactedValueChangeKind = (typeof REDACTED_VALUE_CHANGE_KINDS)[number];

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;

export interface RedactedValue {
  algorithm: RedactedValueAlgorithm;
  /** Dígito hexadecimal en minúsculas, 64 caracteres (salida de SHA-256/HMAC-SHA-256). */
  digest: string;
  changeKind: RedactedValueChangeKind;
}

function isValidRedactedValue(value: unknown): value is RedactedValue {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate["algorithm"] === "string" &&
    (REDACTED_VALUE_ALGORITHMS as readonly string[]).includes(candidate["algorithm"]) &&
    typeof candidate["digest"] === "string" &&
    HEX_64_PATTERN.test(candidate["digest"]) &&
    typeof candidate["changeKind"] === "string" &&
    (REDACTED_VALUE_CHANGE_KINDS as readonly string[]).includes(candidate["changeKind"])
  );
}

// ---------------------------------------------------------------------------
// Contenido que nunca debe copiarse en un AuditEntry, en ningún campo —
// documental: la política estructurada de §A/§B/§C ya lo hace estructuralmente
// imposible (un validador de enum cerrado, o un digest con formato fijo, no
// tienen hueco para contenido real, sea cual sea su longitud).
// ---------------------------------------------------------------------------
export const AUDIT_FORBIDDEN_CONTENT = [
  "questionnaire_answers",
  "signature_image_or_file",
  "otp_code",
  "password",
  "auth_token",
  "session_token",
] as const;
export type AuditForbiddenContent = (typeof AUDIT_FORBIDDEN_CONTENT)[number];

// ---------------------------------------------------------------------------
// §D. Construcción: AuditEntry lleva una marca nominal (símbolo no
// exportado) que solo `createRawAuditEntry`, `createRedactedAuditEntry` y
// `validateAuditEntry` pueden producir. Un objeto literal construido a
// mano en otro módulo no satisface el tipo `AuditEntry` sin recurrir a un
// `as AuditEntry` explícito y visible en revisión de código — no hay una
// vía "fácil" o accidental de saltarse la validación.
// ---------------------------------------------------------------------------

// Símbolo real (no solo declarado a nivel de tipos) y no exportado: hace
// falta el valor en tiempo de ejecución para poder escribir la propiedad
// computada en los constructores de más abajo. Al no exportarse, ningún
// módulo externo puede producir un objeto que la incluya salvo pasando por
// esos constructores o por `validateAuditEntry`.
const AUDIT_ENTRY_BRAND: unique symbol = Symbol("AuditEntryBrand");

interface AuditEntryBase {
  entity: string;
  entityId: string;
  actor: AuditActor;
  channel: AuditChannel;
  occurredAt: string;
  reasonCode?: AuditReasonCode;
  readonly [AUDIT_ENTRY_BRAND]: true;
}

/** Solo construible para combinaciones `entity.field` con validador registrado, y solo si el valor pertenece a su dominio. */
export interface RawAuditEntry extends AuditEntryBase {
  valueRepresentation: "raw";
  field: string;
  previousValue: unknown;
  newValue: unknown;
}

/** Para cualquier cambio fuera de la allowlist de valores en crudo. */
export interface RedactedAuditEntry extends AuditEntryBase {
  valueRepresentation: "redacted";
  field?: string;
  redactedValue: RedactedValue;
}

/**
 * Fase 3 (auth.ts): para hechos auditables que no son la transición de un
 * campo — un login correcto o fallido, un cierre de sesión, una solicitud
 * bloqueada por límite de frecuencia. Ninguno de estos cambia el valor de
 * un campo de dominio cerrado (`ClientAccount.status` no cambia porque el
 * login falle), así que forzarlos dentro de `RawAuditEntry` exigiría un
 * `previousValue`/`newValue` idénticos — una transición falsa que no pasa
 * de verdad. `reasonCode` es aquí **obligatorio** (no opcional, a
 * diferencia de las otras dos variantes): sin un valor de campo que
 * describa qué ocurrió, un evento sin `reasonCode` no llevaría ninguna
 * información además de "algo pasó".
 */
export interface EventAuditEntry extends AuditEntryBase {
  valueRepresentation: "event";
  reasonCode: AuditReasonCode;
}

export type AuditEntry = RawAuditEntry | RedactedAuditEntry | EventAuditEntry;

export class AuditPolicyError extends Error {}

export interface CreateRawAuditEntryInput {
  entity: string;
  entityId: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
  actor: AuditActor;
  channel: AuditChannel;
  occurredAt: string;
  reasonCode?: AuditReasonCode;
}

/** Lanza AuditPolicyError si `entity.field` no tiene validador, o si previousValue/newValue no pertenecen a su dominio. */
export function createRawAuditEntry(input: CreateRawAuditEntryInput): RawAuditEntry {
  if (!isRawValueAuditable(input.entity, input.field)) {
    throw new AuditPolicyError(
      `${input.entity}.${input.field} no está en la allowlist de valores en crudo; usa createRedactedAuditEntry.`,
    );
  }

  if (!isValidRawValue(input.entity, input.field, input.previousValue)) {
    throw new AuditPolicyError(
      `previousValue no pertenece al dominio permitido de ${input.entity}.${input.field}.`,
    );
  }

  if (!isValidRawValue(input.entity, input.field, input.newValue)) {
    throw new AuditPolicyError(
      `newValue no pertenece al dominio permitido de ${input.entity}.${input.field}.`,
    );
  }

  assertValidChannel(input.channel);

  return {
    ...input,
    valueRepresentation: "raw",
    [AUDIT_ENTRY_BRAND]: true,
  } as RawAuditEntry;
}

export interface CreateRedactedAuditEntryInput {
  entity: string;
  entityId: string;
  field?: string;
  redactedValue: RedactedValue;
  actor: AuditActor;
  channel: AuditChannel;
  occurredAt: string;
  reasonCode?: AuditReasonCode;
}

/** Lanza AuditPolicyError si redactedValue no cumple el formato de §B. */
export function createRedactedAuditEntry(
  input: CreateRedactedAuditEntryInput,
): RedactedAuditEntry {
  if (!isValidRedactedValue(input.redactedValue)) {
    throw new AuditPolicyError(
      "redactedValue debe ser { algorithm, digest (64 hex), changeKind } válidos — no texto libre.",
    );
  }

  assertValidChannel(input.channel);

  return {
    ...input,
    valueRepresentation: "redacted",
    [AUDIT_ENTRY_BRAND]: true,
  } as RedactedAuditEntry;
}

export interface CreateEventAuditEntryInput {
  entity: string;
  entityId: string;
  actor: AuditActor;
  channel: AuditChannel;
  occurredAt: string;
  reasonCode: AuditReasonCode;
}

/** Lanza AuditPolicyError si el canal o el reasonCode no son válidos. */
export function createEventAuditEntry(input: CreateEventAuditEntryInput): EventAuditEntry {
  assertValidChannel(input.channel);
  assertValidReasonCode(input.reasonCode);

  return {
    ...input,
    valueRepresentation: "event",
    [AUDIT_ENTRY_BRAND]: true,
  } as EventAuditEntry;
}

function assertValidReasonCode(reasonCode: unknown): asserts reasonCode is AuditReasonCode {
  if (typeof reasonCode !== "string" || !(AUDIT_REASON_CODES as readonly string[]).includes(reasonCode)) {
    throw new AuditPolicyError(`reasonCode inválido: ${JSON.stringify(reasonCode)}.`);
  }
}

function assertValidChannel(channel: unknown): asserts channel is AuditChannel {
  if (typeof channel !== "string" || !(AUDIT_CHANNELS as readonly string[]).includes(channel)) {
    throw new AuditPolicyError(`channel inválido: ${JSON.stringify(channel)}.`);
  }
}

function isValidActor(actor: unknown): actor is AuditActor {
  if (typeof actor !== "object" || actor === null) {
    return false;
  }

  const candidate = actor as Record<string, unknown>;

  if (candidate["type"] === "user") {
    return typeof candidate["id"] === "string" && candidate["id"].length > 0;
  }

  if (candidate["type"] === "guest") {
    return typeof candidate["guestId"] === "string" && candidate["guestId"].length > 0;
  }

  if (candidate["type"] === "system") {
    return (
      typeof candidate["name"] === "string" &&
      ["n8n", "espocrm", "bff", "gcs-sweep"].includes(candidate["name"])
    );
  }

  return false;
}

/**
 * Única puerta de entrada para revalidar un AuditEntry que no se construyó
 * con `createRawAuditEntry`/`createRedactedAuditEntry` — p. ej.
 * deserializado de Postgres o de una cola. **La capa de repositorio debe
 * llamar obligatoriamente a esta función antes de insertar cualquier
 * AuditEntry que no acabe de construirse en el mismo proceso**: es la
 * única forma de obtener un valor con el tipo `AuditEntry` a partir de un
 * `unknown`, precisamente para que no exista un atajo que lo evite.
 * Lanza AuditPolicyError con un mensaje descriptivo ante cualquier
 * incumplimiento; devuelve la entrada tipada y validada si todo es
 * correcto.
 */
export function validateAuditEntry(candidate: unknown): AuditEntry {
  if (typeof candidate !== "object" || candidate === null) {
    throw new AuditPolicyError("AuditEntry debe ser un objeto.");
  }

  const entry = candidate as Record<string, unknown>;

  if (typeof entry["entity"] !== "string" || entry["entity"].length === 0) {
    throw new AuditPolicyError("entity es obligatorio.");
  }

  if (typeof entry["entityId"] !== "string" || entry["entityId"].length === 0) {
    throw new AuditPolicyError("entityId es obligatorio.");
  }

  if (typeof entry["occurredAt"] !== "string" || entry["occurredAt"].length === 0) {
    throw new AuditPolicyError("occurredAt es obligatorio.");
  }

  assertValidChannel(entry["channel"]);

  if (!isValidActor(entry["actor"])) {
    throw new AuditPolicyError("actor inválido.");
  }

  if (entry["reasonCode"] !== undefined && !(AUDIT_REASON_CODES as readonly string[]).includes(entry["reasonCode"] as string)) {
    throw new AuditPolicyError(`reasonCode inválido: ${JSON.stringify(entry["reasonCode"])}.`);
  }

  if (entry["valueRepresentation"] === "raw") {
    const entity = entry["entity"] as string;
    const field = entry["field"];

    if (typeof field !== "string" || field.length === 0) {
      throw new AuditPolicyError("field es obligatorio en una entrada raw.");
    }

    if (!isValidRawValue(entity, field, entry["previousValue"])) {
      throw new AuditPolicyError(`previousValue no pertenece al dominio permitido de ${entity}.${field}.`);
    }

    if (!isValidRawValue(entity, field, entry["newValue"])) {
      throw new AuditPolicyError(`newValue no pertenece al dominio permitido de ${entity}.${field}.`);
    }

    return { ...entry, [AUDIT_ENTRY_BRAND]: true } as RawAuditEntry;
  }

  if (entry["valueRepresentation"] === "redacted") {
    if (!isValidRedactedValue(entry["redactedValue"])) {
      throw new AuditPolicyError("redactedValue no cumple el formato de §B.");
    }

    return { ...entry, [AUDIT_ENTRY_BRAND]: true } as RedactedAuditEntry;
  }

  if (entry["valueRepresentation"] === "event") {
    // A diferencia de las otras dos variantes, reasonCode es obligatorio
    // aquí (ver EventAuditEntry) — la comprobación genérica de arriba solo
    // valida el formato si el campo está presente; aquí además exige que
    // esté presente.
    if (entry["reasonCode"] === undefined) {
      throw new AuditPolicyError("reasonCode es obligatorio en una entrada event.");
    }

    return { ...entry, [AUDIT_ENTRY_BRAND]: true } as EventAuditEntry;
  }

  throw new AuditPolicyError(
    `valueRepresentation debe ser "raw", "redacted" o "event", recibido ${JSON.stringify(entry["valueRepresentation"])}.`,
  );
}
