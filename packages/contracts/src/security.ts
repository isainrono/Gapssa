/**
 * Primitivas de seguridad genéricas compartidas entre flujos —
 * actualmente solo la derivación de identificadores de sujeto para claves
 * de Redis (límites de frecuencia) a partir de un dato con significado
 * propio (p. ej. un correo). Mismo mecanismo que `otp.ts`
 * (`crypto.subtle`, HMAC-SHA-256, sin dependencias de Node): funciona
 * también en runtimes de borde.
 *
 * Revisión 2 de Fase 3: `login:subject:${sha256(email)}` (sin secreto) es
 * vulnerable a un ataque de diccionario — cualquiera puede precalcular
 * `sha256(email)` para una lista de correos candidatos y comparar contra
 * las claves observadas en Redis (p. ej. por acceso operativo, una fuga de
 * backup, o simplemente conociendo el prefijo `REDIS_KEY_PREFIX`). Un HMAC
 * con secreto de servidor hace ese diccionario inútil sin conocer el
 * secreto.
 */

async function importHmacKey(serverSecret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(serverSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

const SUBJECT_ID_HASH_VERSION = "v1";

/**
 * HMAC-SHA-256(`v1:<domain>:<value>`, serverSecret) en hex. `domain`
 * separa espacios de uso distintos (p. ej. `"login-subject"` frente a un
 * futuro `"password-reset-subject"`) bajo el mismo secreto, igual que
 * `challengeId`/`purpose`/`subjectRef` separan los HMAC de OTP
 * (`otp.ts`) — nunca reutilices el resultado de un dominio para otro.
 * `value` debe normalizarse (p. ej. `normalizeEmail`) antes de llamar a
 * esta función: dos formas distintas del mismo correo deben producir el
 * mismo identificador para que el límite de frecuencia sea efectivo.
 */
export async function hmacSubjectId(
  domain: string,
  value: string,
  serverSecret: string,
): Promise<string> {
  const key = await importHmacKey(serverSecret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${SUBJECT_ID_HASH_VERSION}:${domain}:${value}`),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
