import 'server-only'
import { and, eq } from 'drizzle-orm'

import { hmacSubjectId } from '@gapssa/contracts'

import { decryptField } from '../crypto/fieldCrypto'
import type { BookingDbClient } from './db/client'
import { pendingGuestIdentities } from './db/schema'

/**
 * Reindexado versionado de `pending_guest_identities.emailLookupHmac` —
 * herramienta de rotación de `BOOKING_EMAIL_LOOKUP_HMAC_SECRETS`, nunca
 * invocada por el flujo de reservas en sí. A diferencia de
 * `fieldEncryptionRotation.ts` (que RECIFRA un valor ya cifrado), aquí no
 * hay nada que "recifrar": un HMAC es de un solo sentido, así que la
 * única forma correcta de recalcularlo con una versión nueva es partir
 * del CORREO DESCIFRADO (`decryptField` sobre `email*`, la clave AES,
 * independiente del secreto HMAC que se está rotando) y volver a aplicar
 * `hmacSubjectId` con el secreto de la versión destino — "reindexado
 * desde identidad cifrada", nunca desde el propio HMAC.
 *
 * Diseño (mismo patrón que fieldEncryptionRotation.ts):
 * - Por fila, transacción con `SELECT ... FOR UPDATE` — releída dentro de
 *   la transacción (nunca reutiliza lo leído en el listado inicial), así
 *   una re-ejecución tras una interrupción es idempotente: una fila ya
 *   migrada a `toVersion` no vuelve a tocarse.
 * - Solo candidatas: `status = 'active' AND emailLookupHmacKeyVersion =
 *   fromVersion` — una identidad ya purgada/consumida (`status !=
 *   'active'`) se excluye desde el propio SELECT, nunca se migra (no hace
 *   falta: las búsquedas ya filtran por `status = 'active'`) y nunca
 *   cuenta como error.
 * - Si `decryptField` lanza `FieldCryptoError` para una fila que sí
 *   debería migrarse (p. ej. su AES keyVersion quedó en un estado
 *   inconsistente), el error se propaga tal cual — la migración falla
 *   para esa fila, nunca la marca migrada en silencio.
 * - Nunca registra el correo en claro, el HMAC ni ningún dato de
 *   identidad — el resultado es exclusivamente un conteo.
 */

export interface EmailLookupHmacRotationOptions {
  fromVersion: string
  toVersion: string
  /** Nunca escribe — descifra y vuelve a calcular el HMAC en memoria para validar el camino completo, pero no persiste el resultado. */
  dryRun: boolean
  batchSize?: number
}

export interface EmailLookupHmacRotationResult {
  rowsScanned: number
  rowsMigrated: number
}

const DEFAULT_BATCH_SIZE = 200

export async function rotateEmailLookupHmac(
  db: BookingDbClient,
  options: EmailLookupHmacRotationOptions,
): Promise<EmailLookupHmacRotationResult> {
  const { fromVersion, toVersion, dryRun } = options
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const result: EmailLookupHmacRotationResult = { rowsScanned: 0, rowsMigrated: 0 }

  for (;;) {
    const candidates = await db
      .select({ id: pendingGuestIdentities.id })
      .from(pendingGuestIdentities)
      .where(and(eq(pendingGuestIdentities.status, 'active'), eq(pendingGuestIdentities.emailLookupHmacKeyVersion, fromVersion)))
      .limit(batchSize)

    if (candidates.length === 0) {
      break
    }

    for (const candidate of candidates) {
      result.rowsScanned += 1
      const migrated = await migrateRow(db, candidate.id, fromVersion, toVersion, dryRun)
      if (migrated) {
        result.rowsMigrated += 1
      }
    }

    if (dryRun) {
      // En dry-run nunca se persiste ningún cambio — releer el mismo lote
      // repetiría indefinidamente los mismos candidatos (igual que
      // fieldEncryptionRotation.ts), así que se corta tras el primer lote.
      break
    }
  }

  return result
}

async function migrateRow(db: BookingDbClient, id: string, fromVersion: string, toVersion: string, dryRun: boolean): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(pendingGuestIdentities)
      .where(and(eq(pendingGuestIdentities.id, id), eq(pendingGuestIdentities.status, 'active')))
      .for('update')

    if (!row || row.emailLookupHmacKeyVersion !== fromVersion) {
      // Purgada (TTL corto por diseño) o ya migrada por una ejecución
      // anterior/concurrente entre el listado y esta transacción — nada
      // que hacer, no es un error.
      return false
    }

    // Reindexado desde el correo DESCIFRADO — nunca desde el HMAC
    // anterior (imposible invertir un HMAC). `decryptField` lanza
    // `FieldCryptoError` si la versión AES de este campo ya no está en
    // el mapa — se propaga tal cual, nunca se atrapa aquí: esta fila
    // debe quedar sin migrar y hacer fallar la puerta que invocó esta
    // función, no marcarse migrada en silencio.
    const decryptedEmail = decryptField({ ciphertext: row.emailCiphertext, nonce: row.emailNonce, keyVersion: row.emailKeyVersion })
    const secretForToVersion = await resolveSecretForVersion(toVersion)
    const newHmac = await hmacSubjectId('booking-guest-email', decryptedEmail, secretForToVersion)

    if (!dryRun) {
      await tx
        .update(pendingGuestIdentities)
        .set({ emailLookupHmac: newHmac, emailLookupHmacKeyVersion: toVersion })
        .where(eq(pendingGuestIdentities.id, id))
    }

    return true
  })
}

/**
 * Se resuelve de forma perezosa (import diferido) para no forzar a cada
 * consumidor de este módulo a que `serverEnv` esté ya validado en
 * cabecera — mismo motivo que el resto de módulos de rotación
 * (`fieldEncryptionRotation.ts` no necesita esto porque recibe la clave
 * indirectamente vía `encryptFieldWithVersion`; aquí se necesita el
 * secreto HMAC de la versión DESTINO explícitamente).
 */
async function resolveSecretForVersion(keyVersion: string): Promise<string> {
  const { serverEnv } = await import('../env')
  const secret = serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS[keyVersion]
  if (!secret) {
    throw new Error(`No hay secreto de email-lookup HMAC registrado para keyVersion="${keyVersion}".`)
  }
  return secret
}

/**
 * Conteo de identidades de invitado ACTIVAS que TODAVÍA referencian
 * `version` — criterio real de retirada para
 * `BOOKING_EMAIL_LOOKUP_HMAC_SECRETS` (nunca se retira mientras este
 * conteo sea mayor que cero). A diferencia de
 * `countActivePendingGuestIdentities` (rotationSafetyChecks.ts, cuenta
 * TODAS las activas, señal humana informativa), este conteo es por
 * VERSIÓN exacta — el que de verdad decide si una versión concreta puede
 * retirarse del mapa.
 */
export async function countRowsStillOnEmailLookupHmacVersion(db: BookingDbClient, version: string): Promise<number> {
  const rows = await db
    .select({ id: pendingGuestIdentities.id })
    .from(pendingGuestIdentities)
    .where(and(eq(pendingGuestIdentities.status, 'active'), eq(pendingGuestIdentities.emailLookupHmacKeyVersion, version)))
  return rows.length
}
