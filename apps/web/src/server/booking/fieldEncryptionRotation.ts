import 'server-only'
import { eq, or } from 'drizzle-orm'

import { decryptField, encryptFieldWithVersion } from '../crypto/fieldCrypto'
import type { BookingDbClient } from './db/client'
import { pendingAuthenticatedContactDetails, pendingGuestIdentities } from './db/schema'

/**
 * Recifrado versionado de `pending_guest_identities`/
 * `pending_authenticated_contact_details` — herramienta de rotación de
 * `BOOKING_FIELD_ENCRYPTION_KEYS`, nunca invocada por el flujo de reservas
 * en sí. Reutiliza el mismo formato `EncryptedField` (`server/crypto/fieldCrypto.ts`)
 * y nunca inventa uno propio.
 *
 * Diseño:
 * - Recifra por FILA, no por tabla completa de una vez — cada fila se
 *   procesa en su propia transacción con `SELECT ... FOR UPDATE`
 *   (bloqueo de fila), así una escritura concurrente del propio flujo de
 *   reservas (creación/consumo/purga) nunca se pisa con la migración.
 * - Recifra CAMPO A CAMPO: una fila puede tener campos en distintas
 *   versiones (migración interrumpida a mitad) — cada campo se recifra
 *   solo si su `*KeyVersion` sigue siendo `fromVersion` en el momento de
 *   la transacción (releído dentro de ella, no reutilizando lo leído en el
 *   listado inicial) — así una re-ejecución tras una interrupción es
 *   idempotente: los campos ya migrados a `toVersion` se dejan intactos.
 * - Nunca registra plaintext, ciphertext, nonce ni ningún dato de
 *   identidad — el resultado es exclusivamente un conteo.
 */

export interface FieldEncryptionRotationOptions {
  fromVersion: string
  toVersion: string
  /** Nunca escribe — decodifica y vuelve a codificar en memoria para validar el camino completo, pero no persiste el resultado. */
  dryRun: boolean
  /** Filas por lote — nunca la tabla completa de una sola vez. */
  batchSize?: number
}

export interface FieldEncryptionRotationResult {
  table: string
  rowsScanned: number
  rowsMigrated: number
  rowsAlreadyOnTarget: number
  fieldsMigrated: number
}

const DEFAULT_BATCH_SIZE = 200

function reencryptIfNeeded(
  ciphertext: string,
  nonce: string,
  keyVersion: string,
  fromVersion: string,
  toVersion: string,
): { ciphertext: string; nonce: string; keyVersion: string; changed: boolean } {
  if (keyVersion !== fromVersion) {
    // Ya migrado (re-ejecución idempotente) o en una versión distinta a la
    // esperada — nunca se toca un campo que no está exactamente en
    // `fromVersion`, para no enmascarar una configuración de rotación
    // incorrecta forzándolo a `toVersion` de todas formas.
    return { ciphertext, nonce, keyVersion, changed: false }
  }
  const plaintext = decryptField({ ciphertext, nonce, keyVersion })
  const reencrypted = encryptFieldWithVersion(plaintext, toVersion)
  return { ciphertext: reencrypted.ciphertext, nonce: reencrypted.nonce, keyVersion: reencrypted.keyVersion, changed: true }
}

export async function rotatePendingGuestIdentities(
  db: BookingDbClient,
  options: FieldEncryptionRotationOptions,
): Promise<FieldEncryptionRotationResult> {
  const { fromVersion, toVersion, dryRun } = options
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const result: FieldEncryptionRotationResult = {
    table: 'pending_guest_identities',
    rowsScanned: 0,
    rowsMigrated: 0,
    rowsAlreadyOnTarget: 0,
    fieldsMigrated: 0,
  }

  for (;;) {
    const candidates = await db
      .select({ id: pendingGuestIdentities.id })
      .from(pendingGuestIdentities)
      .where(
        or(
          eq(pendingGuestIdentities.firstNameKeyVersion, fromVersion),
          eq(pendingGuestIdentities.lastNameKeyVersion, fromVersion),
          eq(pendingGuestIdentities.emailKeyVersion, fromVersion),
          eq(pendingGuestIdentities.phoneKeyVersion, fromVersion),
        ),
      )
      .limit(batchSize)

    if (candidates.length === 0) {
      break
    }

    for (const candidate of candidates) {
      result.rowsScanned += 1
      const migrated = await migrateGuestIdentityRow(db, candidate.id, fromVersion, toVersion, dryRun)
      if (migrated.changed) {
        result.rowsMigrated += 1
        result.fieldsMigrated += migrated.fieldsChanged
      } else {
        result.rowsAlreadyOnTarget += 1
      }
    }

    if (dryRun) {
      // En dry-run nunca se persiste ningún cambio — releer el mismo lote
      // repetiría indefinidamente los mismos candidatos, así que se corta
      // tras el primer lote (suficiente para validar el camino completo
      // sin necesitar recorrer toda la tabla en modo simulación).
      break
    }
  }

  return result
}

async function migrateGuestIdentityRow(
  db: BookingDbClient,
  id: string,
  fromVersion: string,
  toVersion: string,
  dryRun: boolean,
): Promise<{ changed: boolean; fieldsChanged: number }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(pendingGuestIdentities)
      .where(eq(pendingGuestIdentities.id, id))
      .for('update')

    if (!row) {
      // Purgada entre el listado y esta transacción (TTL corto por diseño)
      // — nada que migrar, no es un error.
      return { changed: false, fieldsChanged: 0 }
    }

    const firstName = reencryptIfNeeded(row.firstNameCiphertext, row.firstNameNonce, row.firstNameKeyVersion, fromVersion, toVersion)
    const lastName = reencryptIfNeeded(row.lastNameCiphertext, row.lastNameNonce, row.lastNameKeyVersion, fromVersion, toVersion)
    const email = reencryptIfNeeded(row.emailCiphertext, row.emailNonce, row.emailKeyVersion, fromVersion, toVersion)
    const phone = reencryptIfNeeded(row.phoneCiphertext, row.phoneNonce, row.phoneKeyVersion, fromVersion, toVersion)

    const fieldsChanged = [firstName, lastName, email, phone].filter((f) => f.changed).length
    if (fieldsChanged === 0) {
      return { changed: false, fieldsChanged: 0 }
    }

    if (!dryRun) {
      await tx
        .update(pendingGuestIdentities)
        .set({
          firstNameCiphertext: firstName.ciphertext,
          firstNameNonce: firstName.nonce,
          firstNameKeyVersion: firstName.keyVersion,
          lastNameCiphertext: lastName.ciphertext,
          lastNameNonce: lastName.nonce,
          lastNameKeyVersion: lastName.keyVersion,
          emailCiphertext: email.ciphertext,
          emailNonce: email.nonce,
          emailKeyVersion: email.keyVersion,
          phoneCiphertext: phone.ciphertext,
          phoneNonce: phone.nonce,
          phoneKeyVersion: phone.keyVersion,
        })
        .where(eq(pendingGuestIdentities.id, id))
    }

    return { changed: true, fieldsChanged }
  })
}

export async function rotatePendingAuthenticatedContactDetails(
  db: BookingDbClient,
  options: FieldEncryptionRotationOptions,
): Promise<FieldEncryptionRotationResult> {
  const { fromVersion, toVersion, dryRun } = options
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const result: FieldEncryptionRotationResult = {
    table: 'pending_authenticated_contact_details',
    rowsScanned: 0,
    rowsMigrated: 0,
    rowsAlreadyOnTarget: 0,
    fieldsMigrated: 0,
  }

  for (;;) {
    const candidates = await db
      .select({ id: pendingAuthenticatedContactDetails.id })
      .from(pendingAuthenticatedContactDetails)
      .where(
        or(
          eq(pendingAuthenticatedContactDetails.firstNameKeyVersion, fromVersion),
          eq(pendingAuthenticatedContactDetails.lastNameKeyVersion, fromVersion),
          eq(pendingAuthenticatedContactDetails.phoneKeyVersion, fromVersion),
        ),
      )
      .limit(batchSize)

    if (candidates.length === 0) {
      break
    }

    for (const candidate of candidates) {
      result.rowsScanned += 1
      const migrated = await migrateAuthenticatedContactRow(db, candidate.id, fromVersion, toVersion, dryRun)
      if (migrated.changed) {
        result.rowsMigrated += 1
        result.fieldsMigrated += migrated.fieldsChanged
      } else {
        result.rowsAlreadyOnTarget += 1
      }
    }

    if (dryRun) {
      break
    }
  }

  return result
}

async function migrateAuthenticatedContactRow(
  db: BookingDbClient,
  id: string,
  fromVersion: string,
  toVersion: string,
  dryRun: boolean,
): Promise<{ changed: boolean; fieldsChanged: number }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(pendingAuthenticatedContactDetails)
      .where(eq(pendingAuthenticatedContactDetails.id, id))
      .for('update')

    if (!row) {
      return { changed: false, fieldsChanged: 0 }
    }

    const firstName = reencryptIfNeeded(row.firstNameCiphertext, row.firstNameNonce, row.firstNameKeyVersion, fromVersion, toVersion)
    const lastName = reencryptIfNeeded(row.lastNameCiphertext, row.lastNameNonce, row.lastNameKeyVersion, fromVersion, toVersion)
    const phone = reencryptIfNeeded(row.phoneCiphertext, row.phoneNonce, row.phoneKeyVersion, fromVersion, toVersion)

    const fieldsChanged = [firstName, lastName, phone].filter((f) => f.changed).length
    if (fieldsChanged === 0) {
      return { changed: false, fieldsChanged: 0 }
    }

    if (!dryRun) {
      await tx
        .update(pendingAuthenticatedContactDetails)
        .set({
          firstNameCiphertext: firstName.ciphertext,
          firstNameNonce: firstName.nonce,
          firstNameKeyVersion: firstName.keyVersion,
          lastNameCiphertext: lastName.ciphertext,
          lastNameNonce: lastName.nonce,
          lastNameKeyVersion: lastName.keyVersion,
          phoneCiphertext: phone.ciphertext,
          phoneNonce: phone.nonce,
          phoneKeyVersion: phone.keyVersion,
        })
        .where(eq(pendingAuthenticatedContactDetails.id, id))
    }

    return { changed: true, fieldsChanged }
  })
}

/**
 * Conteo de filas que TODAVÍA referencian `version` en cualquiera de sus
 * campos — criterio objetivo para decidir si ya es seguro retirar esa
 * versión de `BOOKING_FIELD_ENCRYPTION_KEYS` (nunca se retira mientras
 * este conteo sea mayor que cero).
 */
export async function countRowsStillOnVersion(db: BookingDbClient, version: string): Promise<number> {
  const guestRows = await db
    .select({ id: pendingGuestIdentities.id })
    .from(pendingGuestIdentities)
    .where(
      or(
        eq(pendingGuestIdentities.firstNameKeyVersion, version),
        eq(pendingGuestIdentities.lastNameKeyVersion, version),
        eq(pendingGuestIdentities.emailKeyVersion, version),
        eq(pendingGuestIdentities.phoneKeyVersion, version),
      ),
    )
  const contactRows = await db
    .select({ id: pendingAuthenticatedContactDetails.id })
    .from(pendingAuthenticatedContactDetails)
    .where(
      or(
        eq(pendingAuthenticatedContactDetails.firstNameKeyVersion, version),
        eq(pendingAuthenticatedContactDetails.lastNameKeyVersion, version),
        eq(pendingAuthenticatedContactDetails.phoneKeyVersion, version),
      ),
    )
  return guestRows.length + contactRows.length
}
