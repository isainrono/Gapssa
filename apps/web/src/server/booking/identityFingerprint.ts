import 'server-only'

import { canonicalizePayload, hmacSubjectId } from '@gapssa/contracts'

import { serverEnv } from '../env'

/**
 * Huella HMAC de identidad/contacto para el payload canónico de
 * idempotencia — revisión 2 de Fase 4A, punto 2. Sustituye la inclusión en
 * claro del correo del invitado (`guestFlow.ts`, versión anterior) por un
 * HMAC-SHA-256 versionado, con dominio específico, sobre los campos de
 * identidad NORMALIZADOS. Nunca reversible por fuerza bruta sin el secreto
 * de servidor (a diferencia de `SHA-256(correo)` sin sal, que sí lo era
 * contra un espacio de correos conocidos/adivinables) — mismo principio que
 * `emailLookupHmac` (`server/crypto` no, aquí: `hmacSubjectId`,
 * `packages/contracts/src/security.ts`), pero con su propio secreto
 * versionado (`BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS`,
 * distinto de `BOOKING_EMAIL_LOOKUP_HMAC_SECRET`: uno identifica al
 * invitado para contar solicitudes pendientes, el otro solo detecta si dos
 * intentos de creación son "la misma operación" — nunca deben mezclarse ni
 * permitir invertir el otro).
 *
 * Rotación (mismo patrón que `server/crypto/fieldCrypto.ts`,
 * `BOOKING_FIELD_ENCRYPTION_KEYS`): `computeIdentityFingerprint` con una
 * versión concreta permite recalcular la huella de un `BookingRequestRecord`
 * ya persistido usando la versión con la que se creó
 * (`identityFingerprintKeyVersion`, columna nueva), nunca la versión activa
 * actual — así cambiar `BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION` no
 * rompe la detección de replay de una solicitud todavía viva
 * (`pending_verification`/`verification_processing`/`pending_approval`).
 * Retirar una versión del mapa de secretos solo es seguro cuando ya no
 * queda ningún `BookingRequestRecord` sin resolver que la referencie — como
 * mucho `APPROVAL_HOLD_HOURS` (la ventana más larga del ciclo de vida) tras
 * dejar de ser la versión activa es una cota superior segura para
 * conservarla antes de retirarla.
 */

export interface IdentityFingerprint {
  keyVersion: string
  value: string
}

function getSecretForVersion(keyVersion: string): string {
  const secret = serverEnv.BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS[keyVersion]
  if (!secret) {
    // Solo alcanzable si un `BookingRequestRecord` persistido referencia una
    // `identityFingerprintKeyVersion` que ya se retiró del mapa de secretos
    // — rotación mal gestionada (retirada antes de que caducara el último
    // registro que la usaba), nunca una configuración válida en arranque
    // (la versión activa se comprueba en `server/env.ts`).
    throw new Error(`No hay secreto de huella de identidad registrado para keyVersion="${keyVersion}".`)
  }
  return secret
}

/** Normaliza texto libre (nombre/apellidos) para que variaciones de espacio/mayúsculas no cambien la huella. */
export function normalizeIdentityText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Normaliza un teléfono a solo dígitos (+ inicial opcional) — separadores visuales (espacios, guiones, paréntesis) no deben cambiar la huella. */
export function normalizePhone(value: string): string {
  const trimmed = value.trim()
  const hasLeadingPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  return hasLeadingPlus ? `+${digits}` : digits
}

/** Calcula la huella con una versión de secreto concreta — usado tanto para huellas nuevas (versión activa) como para recalcular sobre un registro ya persistido (su propia versión guardada). */
export async function computeIdentityFingerprint(
  domain: string,
  fields: Record<string, string>,
  keyVersion: string,
): Promise<IdentityFingerprint> {
  const secret = getSecretForVersion(keyVersion)
  const canonicalFields = canonicalizePayload(fields)
  const value = await hmacSubjectId(domain, canonicalFields, secret)
  return { keyVersion, value }
}

/** Calcula la huella con la versión activa actual — único caso en el que se usa al CREAR una solicitud nueva. */
export async function computeIdentityFingerprintForActiveKey(
  domain: string,
  fields: Record<string, string>,
): Promise<IdentityFingerprint> {
  return computeIdentityFingerprint(domain, fields, serverEnv.BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION)
}
