/**
 * Fase 3 — Autenticación y base del portal privado del cliente
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6, `docs/fase3-autenticacion.md`).
 *
 * `ClientAccount` es la identidad del portal (`gapssa_auth`, Postgres),
 * **nunca** la colección `users` de Payload (esa sigue siendo exclusiva
 * del staff que entra en `/admin` — ver `apps/web/src/collections/Users.ts`)
 * y **nunca** la ficha completa del cliente, que sigue viviendo en
 * `Contact` de EspoCRM (`PROJECT_CONTEXT.md` §11). `ClientAccount` solo
 * guarda lo necesario para autenticar, dar de baja/recuperar acceso, y un
 * vínculo opaco con el `Contact` correspondiente — nunca duplica la ficha
 * operativa.
 *
 * Divergencia deliberada frente a `booking.ts`/`PendingGuestIdentity`: ahí
 * el correo se cifra porque es un dato de paso, propiedad final de
 * EspoCRM. Aquí el correo es la propia identidad de inicio de sesión de un
 * registro duradero (no un puente hacia otro sistema) — se guarda en claro
 * con índice único normalizado (minúsculas, sin espacios), igual que la
 * colección `users` de Payload en este mismo repositorio. Cifrarlo
 * impediría consultarlo para el login y para enviar los correos
 * operativos sin inventar un mecanismo de cifrado determinista redundante
 * con un hash. Ver `docs/fase3-autenticacion.md` §2 para el razonamiento
 * completo.
 */

import type { IdempotencyKey } from "./idempotency.ts";

// ---------------------------------------------------------------------------
// Cuenta de cliente
// ---------------------------------------------------------------------------

export const CLIENT_ACCOUNT_STATUSES = [
  "pending_verification",
  "active",
  "suspended",
  "pending_deletion",
] as const;
export type ClientAccountStatus = (typeof CLIENT_ACCOUNT_STATUSES)[number];

/**
 * Estado de la vinculación con un `Contact` de EspoCRM
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6.3): nunca se fusiona automáticamente
 * una coincidencia dudosa. `linked` solo se alcanza tras revisión manual de
 * Gapssa (o al no encontrar ninguna coincidencia y crear un `Contact`
 * nuevo, que tampoco es una fusión).
 */
export const ESPO_LINK_STATUSES = [
  "unlinked",
  "pending_review",
  "linked",
  "rejected",
] as const;
export type EspoLinkStatus = (typeof ESPO_LINK_STATUSES)[number];

/**
 * Nunca se persiste como campo mutable derivado de la edad (quedaría
 * obsoleto): se calcula siempre a partir de `dateOfBirth` con
 * `decideAccountAgeCategory`. La mayoría de edad civil en España son 18
 * años (Código Civil, art. 315) — un hecho legal, no una decisión de
 * negocio de las que `PROJECT_CONTEXT.md`/`PLAN_DESARROLLO_WEB_PORTAL.md`
 * piden no inventar.
 */
export const SPANISH_CIVIL_MAJORITY_AGE_YEARS = 18;
export type AccountAgeCategory = "adult" | "minor";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export interface ParsedIsoDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Parsea y valida "YYYY-MM-DD" como una fecha de calendario real — nunca
 * delega en `new Date(string)`, que normaliza silenciosamente fechas
 * imposibles (`new Date("2026-02-31")` se convierte en el 3 de marzo en
 * vez de fallar). Devuelve `null` ante cualquier formato, mes, día o 29 de
 * febrero fuera de un año bisiesto que no sea real — nunca lanza.
 */
export function parseStrictIsoDate(value: string): ParsedIsoDate | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    return null;
  }

  const maxDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  if (day < 1 || day > maxDay) {
    return null;
  }

  return { year, month, day };
}

/**
 * true si `value` es "YYYY-MM-DD" para una fecha de calendario real que no
 * está en el futuro. Comparación por componentes de calendario en UTC
 * (nunca `Date#getTime()`/`new Date(string)`), para no depender de la zona
 * horaria del proceso que ejecuta la comprobación.
 */
export function isValidDateOfBirth(value: string, now: Date): boolean {
  const parsed = parseStrictIsoDate(value);
  if (!parsed) {
    return false;
  }

  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();

  if (parsed.year > nowYear) return false;
  if (parsed.year === nowYear && parsed.month > nowMonth) return false;
  if (parsed.year === nowYear && parsed.month === nowMonth && parsed.day > nowDay) return false;
  return true;
}

/**
 * Reutiliza `parseStrictIsoDate` — nunca `new Date(dateOfBirth)` (ver el
 * razonamiento de esa función). `dateOfBirth` ya debe haber pasado por
 * `isValidDateOfBirth` al registrar la cuenta; si llega aquí una cadena
 * corrupta (dato ya persistido de forma inválida), falla explícitamente en
 * vez de calcular una edad silenciosamente incorrecta.
 */
export function decideAccountAgeCategory(dateOfBirth: string, now: Date): AccountAgeCategory {
  const parsed = parseStrictIsoDate(dateOfBirth);
  if (!parsed) {
    throw new Error(`decideAccountAgeCategory: dateOfBirth inválida: ${dateOfBirth}`);
  }

  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();

  let age = nowYear - parsed.year;
  const hasNotHadBirthdayYet =
    nowMonth < parsed.month || (nowMonth === parsed.month && nowDay < parsed.day);
  if (hasNotHadBirthdayYet) {
    age -= 1;
  }
  return age >= SPANISH_CIVIL_MAJORITY_AGE_YEARS ? "adult" : "minor";
}

export const INDEPENDENCE_STATUSES = ["not_applicable", "pending", "granted"] as const;
export type IndependenceStatus = (typeof INDEPENDENCE_STATUSES)[number];

/**
 * Identidad del portal. Sin datos operativos del cliente (tratamientos,
 * citas, consentimientos): esos siguen en EspoCRM, accesibles solo tras
 * vincular `espoContactId`.
 */
export interface ClientAccount {
  id: string;
  /** Normalizado (minúsculas, sin espacios) antes de guardar o comparar. */
  email: string;
  status: ClientAccountStatus;
  emailVerifiedAt: string | null;
  dateOfBirth: string;
  /** Idioma preferido para correos y UI — uno de los 6 locales del portal. */
  locale: string;
  espoLinkStatus: EspoLinkStatus;
  /** Identificador opaco del `Contact` de EspoCRM — nunca la ficha completa. */
  espoContactId: string | null;
  independenceStatus: IndependenceStatus;
  createdAt: string;
  updatedAt: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

/**
 * Cerrado a un único tipo por ahora: contraseña. Modelado como tabla propia
 * (no como columnas sueltas en `ClientAccount`) para poder añadir más
 * adelante credenciales adicionales (p. ej. una clave pública de WebAuthn)
 * sin migrar `client_accounts` de nuevo.
 */
export const CREDENTIAL_TYPES = ["password"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

/**
 * Parámetros de Argon2id — valores técnicos propuestos (no una decisión de
 * negocio), siguiendo el mínimo recomendado por el OWASP Password Storage
 * Cheat Sheet para Argon2id (m=19 MiB, t=2, p=1). Configurables por
 * variable de entorno (`ARGON2_MEMORY_COST_KIB`/`ARGON2_TIME_COST`/
 * `ARGON2_PARALLELISM`, ver `apps/web/src/server/auth/password.ts`) para no
 * fijar en código un parámetro de seguridad que conviene poder subir sin
 * desplegar código nuevo. Pendiente de confirmación explícita, igual que
 * el resto de valores técnicos de `otp.ts`/`booking.ts`.
 */
export const ARGON2ID_DEFAULT_MEMORY_COST_KIB = 19_456;
export const ARGON2ID_DEFAULT_TIME_COST = 2;
export const ARGON2ID_DEFAULT_PARALLELISM = 1;

export interface Credential {
  id: string;
  accountId: string;
  type: CredentialType;
  /** Nunca la contraseña en claro — cadena codificada de Argon2id (algoritmo + parámetros + sal + hash, formato PHC). */
  secretHash: string;
  createdAt: string;
  updatedAt: string;
  /** Se actualiza cada vez que la contraseña cambia — usado para invalidar sesiones anteriores (ver Session). */
  rotatedAt: string;
}

export const PASSWORD_MIN_LENGTH = 12;

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

/**
 * `PLAN_DESARROLLO_WEB_PORTAL.md` §6.2: cerrar sesión tras 30 minutos de
 * inactividad — valor de negocio fijado por el plan, no técnico.
 */
export const SESSION_IDLE_TIMEOUT_MINUTES = 30;

/**
 * Vida máxima absoluta de una sesión aunque haya actividad continua — valor
 * técnico sugerido (no fijado por el plan), a confirmar en Fase 3.
 * Justificación: limita la ventana de un token de sesión robado incluso si
 * el usuario nunca cierra el navegador.
 */
export const SESSION_ABSOLUTE_TTL_DAYS = 30;

export const SESSION_REVOKED_REASONS = [
  "user_logout",
  "user_revoked_other_session",
  "password_changed",
  "admin_action",
  "expired_idle",
  "expired_absolute",
  /**
   * `PLAN_DESARROLLO_WEB_PORTAL.md` §15.1: "una solicitud de eliminación
   * bloquea el acceso de inmediato" — motivo propio, distinto de
   * `user_logout`, para que quede claro en la auditoría por qué se cerró
   * la sesión sin que el usuario pidiera cerrar sesión explícitamente.
   */
  "account_deletion_requested",
] as const;
export type SessionRevokedReason = (typeof SESSION_REVOKED_REASONS)[number];

/**
 * El token en sí (secreto de sesión) nunca se persiste: solo su hash
 * (`tokenHash`, SHA-256), igual que un OTP — ver `otp.ts`. La cookie del
 * navegador lleva el token en claro; el servidor lo rehashea en cada
 * petición y compara contra `tokenHash` en tiempo constante.
 */
export interface Session {
  id: string;
  accountId: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** Volcado mínimo, sin más contexto del dispositivo que esto. */
  ipAddress: string | null;
  userAgent: string | null;
  revokedAt: string | null;
  revokedReason: SessionRevokedReason | null;
}

export function isSessionIdleExpired(
  lastSeenAt: string,
  now: Date,
  idleTimeoutMinutes: number = SESSION_IDLE_TIMEOUT_MINUTES,
): boolean {
  const idleSince = now.getTime() - new Date(lastSeenAt).getTime();
  return idleSince >= idleTimeoutMinutes * 60_000;
}

export function isSessionAbsoluteExpired(expiresAt: string, now: Date): boolean {
  return now.getTime() >= new Date(expiresAt).getTime();
}

/** true si la sesión sigue utilizable: no revocada, no vencida por inactividad ni por su TTL absoluto. */
export function isSessionUsable(
  session: Pick<Session, "revokedAt" | "lastSeenAt" | "expiresAt">,
  now: Date,
): boolean {
  if (session.revokedAt !== null) {
    return false;
  }
  if (isSessionAbsoluteExpired(session.expiresAt, now)) {
    return false;
  }
  return !isSessionIdleExpired(session.lastSeenAt, now);
}

// ---------------------------------------------------------------------------
// Verificación de correo y recuperación de contraseña — registros
// duraderos en Postgres. El código/hash del OTP en sí vive en Redis
// (otp.ts): estas tablas solo llevan el ESTADO de la solicitud, mismo
// patrón que BookingRequestRecord frente a OtpChallenge (booking.ts).
// ---------------------------------------------------------------------------

export const EMAIL_VERIFICATION_REQUEST_STATUSES = [
  "pending",
  "verified",
  "expired",
] as const;
export type EmailVerificationRequestStatus =
  (typeof EMAIL_VERIFICATION_REQUEST_STATUSES)[number];

export interface EmailVerificationRequest {
  id: string;
  accountId: string;
  status: EmailVerificationRequestStatus;
  /** Referencia opaca al OtpChallenge.id emitido en Redis para esta solicitud. */
  otpChallengeId: string;
  createdAt: string;
  expiresAt: string;
  verifiedAt: string | null;
}

export const PASSWORD_RESET_REQUEST_STATUSES = [
  "pending",
  "consumed",
  "expired",
] as const;
export type PasswordResetRequestStatus = (typeof PASSWORD_RESET_REQUEST_STATUSES)[number];

export interface PasswordResetRequest {
  id: string;
  accountId: string;
  status: PasswordResetRequestStatus;
  otpChallengeId: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  idempotencyKey: IdempotencyKey;
}

/**
 * Ventana tras verificar el código de recuperación durante la cual se
 * puede fijar la nueva contraseña sin repetir el OTP — valor técnico
 * sugerido, a confirmar.
 */
export const PASSWORD_RESET_SESSION_MINUTES = 10;

// ---------------------------------------------------------------------------
// Tutores y menores (PLAN_DESARROLLO_WEB_PORTAL.md §10 / PROJECT_CONTEXT.md
// §7.2) — solo modelo de identidad, permisos y estados: sin
// consentimientos ni visibilidad de ficha todavía.
// ---------------------------------------------------------------------------

/**
 * `PROJECT_CONTEXT.md` §3.1/decisiones ya documentadas: máximo dos
 * tutores por menor.
 */
export const MAX_GUARDIANS_PER_MINOR = 2;

export const GUARDIAN_LINK_STATUSES = [
  "pending_minor_confirmation",
  "active",
  "revoked",
] as const;
export type GuardianLinkStatus = (typeof GUARDIAN_LINK_STATUSES)[number];

/**
 * Vínculo entre la cuenta de un tutor (adulto) y la cuenta independiente
 * de un menor. Ambas partes tienen su propia `ClientAccount` — el menor
 * usa su propio dispositivo/cuenta (`PLAN_DESARROLLO_WEB_PORTAL.md` §10:
 * "uso del móvil propio del joven"). El vínculo en sí no concede
 * automáticamente visibilidad de ficha: `PROJECT_CONTEXT.md` §7.3 exige
 * que el cliente decida el alcance de acceso — ese control granular es
 * diseño de una fase posterior (consentimientos); aquí solo existe el
 * estado del vínculo, no permisos por tratamiento.
 */
export interface GuardianLink {
  id: string;
  guardianAccountId: string;
  minorAccountId: string;
  status: GuardianLinkStatus;
  createdAt: string;
  /** Quién inició la solicitud — siempre el tutor: el menor solo confirma o ignora. */
  requestedBy: string;
  confirmedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

/**
 * Parte pura de la regla "máximo dos tutores por menor": dado cuántos
 * vínculos ya están en `pending_minor_confirmation` o `active` para un
 * menor, decide si se puede crear uno más. El conteo real (con el bloqueo
 * de fila necesario para que dos solicitudes concurrentes no superen el
 * límite) es responsabilidad del repositorio — ver
 * `apps/web/src/server/auth/guardian.ts`, mismo patrón de bloqueo que
 * `protectAdminRole.ts` usa para "último administrador".
 */
export function canAddGuardianLink(activeOrPendingLinksForMinor: number): boolean {
  return activeOrPendingLinksForMinor < MAX_GUARDIANS_PER_MINOR;
}

// ---------------------------------------------------------------------------
// Independencia al alcanzar la mayoría de edad
// ---------------------------------------------------------------------------

export const INDEPENDENCE_REQUEST_STATUSES = ["pending", "confirmed", "rejected", "expired"] as const;
export type IndependenceRequestStatus = (typeof INDEPENDENCE_REQUEST_STATUSES)[number];

/**
 * Nunca automática (`PLAN_DESARROLLO_WEB_PORTAL.md` §10): el propio joven
 * debe solicitarla y confirmar su identidad. `identityConfirmationMethod`
 * es descriptivo del mecanismo usado (p. ej. "email_otp_reconfirmation"),
 * nunca contiene el dato de identidad en sí.
 */
export interface IndependenceRequest {
  id: string;
  minorAccountId: string;
  status: IndependenceRequestStatus;
  requestedAt: string;
  otpChallengeId: string;
  identityConfirmationMethod: "email_otp_reconfirmation";
  confirmedAt: string | null;
  resolvedAt: string | null;
}

export interface IndependenceEligibilityInput {
  dateOfBirth: string;
  /** true si el menor tiene al menos un GuardianLink (activo o no) — sin vínculo alguno no hay de qué independizarse. */
  hasAnyGuardianLink: boolean;
  independenceStatus: IndependenceStatus;
}

/**
 * Elegible solo si: ya cumplió la mayoría de edad civil, existe al menos
 * un vínculo de tutela histórico, y todavía no se concedió la
 * independencia. No exige que el vínculo siga `active` (pudo haber sido
 * revocado antes) ni bloquea una segunda solicitud tras un `rejected`
 * (rechazar una solicitud de identidad dudosa no debe cerrar la puerta
 * definitivamente).
 */
export function isEligibleForIndependenceRequest(
  input: IndependenceEligibilityInput,
  now: Date,
): boolean {
  if (input.independenceStatus === "granted") {
    return false;
  }
  if (!input.hasAnyGuardianLink) {
    return false;
  }
  return decideAccountAgeCategory(input.dateOfBirth, now) === "adult";
}

// ---------------------------------------------------------------------------
// Registro/login — DTOs de entrada, validación real en el servidor
// (apps/web/src/server/auth/), no aquí.
// ---------------------------------------------------------------------------

export interface RegisterAccountInput {
  email: string;
  password: string;
  dateOfBirth: string;
  locale: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

/**
 * Resultado deliberadamente uniforme entre "no existe la cuenta" y
 * "contraseña incorrecta": `PLAN_DESARROLLO_WEB_PORTAL.md` §6.2 prohíbe
 * revelar si un correo existe. El backend debe tardar un tiempo
 * equivalente en ambos casos (ver `apps/web/src/server/auth/session.ts`,
 * verificación con hash señuelo) para no filtrarlo por temporización.
 */
export type LoginOutcome =
  | { outcome: "success"; accountId: string }
  | { outcome: "invalid_credentials" }
  | { outcome: "account_not_verified" }
  | { outcome: "account_suspended" }
  | { outcome: "rate_limited" };
