/**
 * Código de un solo uso (OTP) compartido por los flujos que lo necesitan:
 * verificación de correo del invitado (booking.ts) y firma de
 * consentimiento (consent.ts). Regla dura: el código en claro **nunca** se
 * persiste ni se audita — solo su hash, en Redis, con TTL.
 *
 * Revisión 4, dos correcciones sobre la revisión 3:
 * - El HMAC firmaba solo el código: dos retos distintos con el mismo
 *   código (coincidencia con 10^6 combinaciones, no es improbable)
 *   producían el mismo `codeHash`, así que un hash robado de un reto
 *   podía reutilizarse para verificar otro. Ahora el HMAC incluye el
 *   contexto del reto (`challengeId`, `purpose`, `subjectRef`) — ver
 *   `OtpHashContext`.
 * - `generateOtpCode` sacaba el dígito de `Uint32 % 10`, sesgado (2^32 no
 *   es múltiplo de 10). Ahora usa descarte por rechazo (rejection
 *   sampling) sobre bytes, sin ese sesgo.
 */

export type OtpPurpose =
  | "guest_email_verification"
  | "consent_signature"
  | "passwordless_login"
  /**
   * Fase 3 (auth.ts): verificación de correo al registrar una cuenta de
   * cliente (`ClientAccount`). Contexto distinto de
   * "guest_email_verification" aunque ambos verifiquen un correo: el
   * `subjectRef` de este propósito es un `ClientAccount.id`, no un
   * `BookingRequestRecord.id`, y el HMAC contextualizado de arriba (§HMAC
   * contextualizado) ya impide que un hash de uno sirva para el otro.
   */
  | "account_email_verification"
  /**
   * Fase 3: reconfirmación de identidad al solicitar la independencia de
   * una cuenta de menor al alcanzar la mayoría de edad
   * (`PLAN_DESARROLLO_WEB_PORTAL.md` §10: "requiere confirmación e
   * identidad verificada"). Propósito propio, distinto de
   * `account_email_verification`, aunque ambos verifiquen un correo: son
   * hechos de negocio distintos y el HMAC contextualizado ya impide
   * reutilizar el hash de uno para el otro.
   */
  | "independence_confirmation"
  /**
   * Fase 3: recuperación de contraseña. Reutiliza el mismo mecanismo de
   * código de un solo uso en vez de inventar un sistema de token de enlace
   * aparte — `subjectRef` es el `ClientAccount.id` cuya contraseña se va a
   * restablecer. Un código verificado con éxito abre una ventana corta
   * (ver auth.ts, `PASSWORD_RESET_SESSION_MINUTES`) para fijar la nueva
   * contraseña, tras la cual el reto ya está consumido igual que cualquier
   * otro OTP.
   */
  | "password_reset";

/**
 * Valores técnicos sugeridos, no una regla de negocio de
 * PROJECT_CONTEXT.md/PLAN_DESARROLLO_WEB_PORTAL.md: confirmar en Fase 1.
 * La única duración fijada por el plan es GUEST_VERIFICATION_HOLD_MINUTES
 * (booking.ts), que gobierna el caso "guest_email_verification".
 */
export const OTP_DEFAULT_TTL_MINUTES = 10;
export const OTP_DEFAULT_MAX_ATTEMPTS = 5;
/** Tras superar OTP_DEFAULT_MAX_ATTEMPTS, el reto queda bloqueado aunque el TTL no haya vencido. */
export const OTP_LOCKOUT_MINUTES = 15;
export const OTP_CODE_LENGTH = 6;

/**
 * Límites de solicitud de código nuevo, por sujeto, IP y propósito —
 * independiente del límite de intentos de verificación de un código ya
 * emitido. Valores técnicos sugeridos, a confirmar en Fase 1; la
 * aplicación real (contadores en Redis por `subjectRef:ip:purpose`) es
 * responsabilidad del BFF.
 */
export const OTP_REQUEST_RATE_LIMIT = {
  maxPerSubjectPerHour: 5,
  maxPerIpPerHour: 20,
} as const;

/**
 * Representa el reto en el momento de guardarlo (en Redis). `codeHash` es
 * el HMAC-SHA-256 del código **junto con el contexto del reto** (ver
 * `hashOtpCode`), nunca el código en claro ni un hash sin contexto. Un
 * solo uso: `consumedAt` se rellena al verificar con éxito, de forma
 * atómica (compare-and-swap en el almacén — responsabilidad del BFF), y a
 * partir de ahí el reto debe eliminarse o quedar inutilizable, no
 * reutilizarse aunque el TTL no haya vencido.
 */
export interface OtpChallenge {
  id: string;
  purpose: OtpPurpose;
  /**
   * Referencia opaca al sujeto (p. ej. `BookingRequestRecord.id`) —
   * **nunca** el correo, el teléfono ni ningún otro dato personal.
   */
  subjectRef: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  maxAttempts: number;
  attemptsUsed: number;
  consumedAt: string | null;
  /** Se activa al superar maxAttempts; bloquea nuevos intentos aunque el TTL no haya vencido. */
  lockedAt: string | null;
}

export type OtpVerificationResult =
  | { outcome: "verified"; challengeId: string }
  | { outcome: "invalid_code"; attemptsRemaining: number }
  | { outcome: "expired" }
  /**
   * Revisión 2 de Fase 3: `codeMatchesConsumedChallenge` distingue "alguien
   * reenvía el mismo código correcto que ya consumió este reto" (por
   * ejemplo, un reintento tras un fallo de infraestructura entre consumir
   * el OTP y completar la activación en Postgres) de "alguien prueba un
   * código cualquiera contra un reto ya gastado". Solo el primer caso
   * puede autorizar una recuperación idempotente — nunca el segundo, que
   * no demuestra conocer el código real. Recalculado con el mismo HMAC
   * contextualizado (`verifyOtpCode`), nunca a partir de un hash sin
   * contexto.
   *
   * `challengeId` (revisión 3 de Fase 3) siempre identifica el reto
   * consumido, con independencia de si `codeMatchesConsumedChallenge` es
   * `true` o `false` — el llamante lo necesita para atar cualquier
   * recuperación idempotente a la fila concreta de Postgres asociada a ese
   * reto exacto (nunca "la última solicitud pendiente de la cuenta", que
   * podría ser una distinta si hubo una reemisión de código entre medias).
   */
  | { outcome: "already_consumed"; challengeId: string; codeMatchesConsumedChallenge: boolean }
  | { outcome: "locked" };

// ---------------------------------------------------------------------------
// Funciones ejecutables (Web Crypto: crypto.subtle / crypto.getRandomValues,
// igual que idempotency.ts — sin dependencias de Node, funcionan también en
// runtimes de borde). No sustituyen el almacenamiento con TTL/bloqueo en
// Redis, que es responsabilidad del BFF; son la primitiva criptográfica.
// ---------------------------------------------------------------------------

/**
 * Contexto que ata un HMAC a un reto concreto. Sin esto, el mismo código
 * (coincidencia plausible sobre 10^6 combinaciones) produciría el mismo
 * hash en dos retos distintos, permitiendo reutilizar un hash filtrado de
 * un reto para "verificar" otro. Deliberadamente no incluye correo,
 * teléfono ni IP: solo identificadores opacos y el propósito.
 */
export interface OtpHashContext {
  challengeId: string;
  purpose: OtpPurpose;
  subjectRef: string;
}

const OTP_HASH_VERSION = "v1";

/**
 * Serialización no ambigua y versionada del contexto + código:
 * `v1:<challengeId>:<purpose>:<subjectRef>:<code>`. `challengeId` y
 * `subjectRef` son identificadores opacos (UUID) y `purpose` es un enum
 * cerrado, ninguno de los tres contiene ':'; `code` son solo dígitos. El
 * prefijo de versión permite cambiar el formato en el futuro sin
 * confundir hashes antiguos con nuevos.
 */
function buildOtpSigningInput(context: OtpHashContext, code: string): string {
  return [OTP_HASH_VERSION, context.challengeId, context.purpose, context.subjectRef, code].join(
    ":",
  );
}

/** Código de OTP_CODE_LENGTH dígitos, uniforme (rejection sampling, sin sesgo de módulo). No usa Math.random. */
export function generateOtpCode(length: number = OTP_CODE_LENGTH): string {
  const digits: string[] = [];

  // 256 no es múltiplo de 10: aceptar byte % 10 sin descartar nada
  // sesgaría los dígitos 0-5 (se producen desde 6 valores de byte más que
  // los dígitos 6-9 en el rango 250-255). Se descartan esos bytes y se
  // vuelve a pedir aleatoriedad — rejection sampling, no una aproximación.
  const REJECTION_THRESHOLD = 250;

  while (digits.length < length) {
    const buffer = new Uint8Array(length - digits.length);
    crypto.getRandomValues(buffer);

    for (const byte of buffer) {
      if (digits.length >= length) {
        break;
      }
      if (byte >= REJECTION_THRESHOLD) {
        continue;
      }
      digits.push((byte % 10).toString());
    }
  }

  return digits.join("");
}

async function importHmacKey(serverSecret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(serverSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * HMAC-SHA-256(`v1:challengeId:purpose:subjectRef:code`, serverSecret) en
 * hex. Esto es lo único que se guarda en OtpChallenge.codeHash. El mismo
 * código produce hashes distintos si cambia cualquier parte del contexto.
 */
export async function hashOtpCode(
  context: OtpHashContext,
  code: string,
  serverSecret: string,
): Promise<string> {
  const key = await importHmacKey(serverSecret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(buildOtpSigningInput(context, code)),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Comparación en tiempo constante para strings de igual longitud esperada
 * (un HMAC-SHA-256 en hex siempre son 64 caracteres, así que el
 * cortocircuito por longitud no depende del secreto ni filtra información
 * útil). No usar `===` para comparar hashes de códigos.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

/**
 * Recalcula el HMAC del código con el **mismo contexto** con el que se
 * emitió el reto y lo compara en tiempo constante contra el hash
 * guardado. Un código correcto con el contexto equivocado (otro
 * `challengeId`, `purpose` o `subjectRef`) no verifica.
 */
export async function verifyOtpCode(
  context: OtpHashContext,
  code: string,
  serverSecret: string,
  expectedHash: string,
): Promise<boolean> {
  const actualHash = await hashOtpCode(context, code, serverSecret);
  return constantTimeEqual(actualHash, expectedHash);
}
