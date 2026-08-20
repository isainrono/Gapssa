import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type { EncryptedField } from '@gapssa/contracts'

import { serverEnv } from '../env'

/**
 * Cifrado autenticado de campo (AES-256-GCM) para `PendingGuestIdentity`
 * (`packages/contracts/src/booking.ts`, `EncryptedField`) —
 * implementación real de la abstracción que ese contrato deja como
 * "diseño de Fase 4". `node:crypto`, no Web Crypto: este módulo solo se
 * ejecuta en el runtime Node de las rutas API (`import 'server-only'`),
 * igual que `server/auth/password.ts` (Argon2id nativo).
 *
 * Versionado (`keyVersion`, `BOOKING_FIELD_ENCRYPTION_KEYS` en
 * `server/env.ts`): cifrar usa siempre la versión activa
 * (`BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION`); descifrar acepta
 * cualquier versión presente en el mapa — así se puede rotar la clave
 * activa sin invalidar de golpe los `PendingGuestIdentity` ya cifrados con
 * la anterior (se retira del mapa solo cuando ya no queda ningún dato
 * cifrado con ella; dado que `PendingGuestIdentity` se purga en minutos u
 * horas por diseño, esa ventana es corta).
 */

const ALGORITHM = 'aes-256-gcm'
const NONCE_BYTES = 12
const AUTH_TAG_BYTES = 16

export class FieldCryptoError extends Error {}

function getKeyBuffer(keyVersion: string): Buffer {
  const encoded = serverEnv.BOOKING_FIELD_ENCRYPTION_KEYS[keyVersion]
  if (!encoded) {
    // Nunca se alcanza con una configuración válida (server/env.ts ya
    // exige que la versión activa exista en el mapa al arrancar), pero un
    // EncryptedField persistido con una keyVersion retirada del mapa
    // (rotación mal gestionada) debe fallar con un error claro, nunca con
    // una excepción críptica de node:crypto.
    throw new FieldCryptoError(`No hay clave de cifrado registrada para keyVersion="${keyVersion}".`)
  }
  return Buffer.from(encoded, 'base64')
}

/** Cifra `plaintext` con la clave activa. Nunca registra ni el valor de entrada ni el de salida — el llamante decide qué hacer con el resultado. */
export function encryptField(plaintext: string): EncryptedField {
  return encryptFieldWithVersion(plaintext, serverEnv.BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION)
}

/**
 * Cifra `plaintext` con una versión de clave explícita — usado por la
 * rotación versionada (`fieldEncryptionRotation.ts`) para recifrar con la
 * versión destino incluso si todavía no es (o ya dejó de ser) la versión
 * activa, y por sus pruebas para construir fixtures ya cifrados con una
 * versión concreta sin depender de qué versión esté activa en `serverEnv`
 * en el momento de ejecutar la prueba. `encryptField` es el caso especial
 * "usar la versión activa" — nunca al revés.
 */
export function encryptFieldWithVersion(plaintext: string, keyVersion: string): EncryptedField {
  const key = getKeyBuffer(keyVersion)
  const nonce = randomBytes(NONCE_BYTES)

  const cipher = createCipheriv(ALGORITHM, key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    keyVersion,
    nonce: nonce.toString('base64'),
    // Tag de autenticación de GCM concatenado al final — mismo formato
    // que documenta EncryptedField.ciphertext ("incluye el tag de
    // autenticación").
    ciphertext: Buffer.concat([ciphertext, authTag]).toString('base64'),
  }
}

/** Descifra `field`. Lanza FieldCryptoError si el tag de autenticación no verifica (clave incorrecta, dato corrupto o manipulado) — nunca devuelve un valor parcial o no autenticado. */
export function decryptField(field: EncryptedField): string {
  const key = getKeyBuffer(field.keyVersion)
  const nonce = Buffer.from(field.nonce, 'base64')
  const combined = Buffer.from(field.ciphertext, 'base64')

  if (nonce.length !== NONCE_BYTES || combined.length < AUTH_TAG_BYTES) {
    throw new FieldCryptoError('EncryptedField con nonce o ciphertext de longitud inválida.')
  }

  const ciphertext = combined.subarray(0, combined.length - AUTH_TAG_BYTES)
  const authTag = combined.subarray(combined.length - AUTH_TAG_BYTES)

  const decipher = createDecipheriv(ALGORITHM, key, nonce)
  decipher.setAuthTag(authTag)

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plaintext.toString('utf8')
  } catch {
    // node:crypto lanza al fallar la verificación del tag — nunca se
    // propaga el mensaje nativo (podría variar entre versiones/plataformas
    // sin aportar nada útil), solo un error propio y claro.
    throw new FieldCryptoError('No se pudo descifrar el campo: tag de autenticación inválido o clave incorrecta.')
  }
}
