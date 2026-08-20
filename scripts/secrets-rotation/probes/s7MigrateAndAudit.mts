// scripts/secrets-rotation/probes/s7MigrateAndAudit.mts
//
// Sustituye al heredoc `ts_migrate` que antes generaba
// rotate-all-interactive.sh::gate_s7() en tiempo de ejecución dentro de
// apps/web/. Recifrado AES por versión, reindexado de email-lookup HMAC,
// auditoría de columnas cifradas y recuentos EN FRESCO — reutiliza
// exactamente las mismas funciones de producción que el heredoc ya
// importaba, sin duplicar ninguna regla de migración ni criptografía.
//
// Contrato de stdout (schema "s7-migrate"): un único documento JSON,
// sin filtrado de línea final — se verificó que ninguno de los módulos
// importados aquí escribe nunca a stdout por su cuenta.

import { assertRotationEnvironmentAllowed, countLiveBookingRequestsReferencingFingerprintVersions, countLiveBookingRequestsReferencingAccessTokenVersions } from '../../../apps/web/src/server/booking/rotationSafetyChecks'
import { rotatePendingGuestIdentities, rotatePendingAuthenticatedContactDetails, countRowsStillOnVersion } from '../../../apps/web/src/server/booking/fieldEncryptionRotation'
import { rotateEmailLookupHmac, countRowsStillOnEmailLookupHmacVersion } from '../../../apps/web/src/server/booking/emailLookupHmacRotation'
import { verifyNoUnlistedEncryptedColumns } from '../../../apps/web/src/server/booking/encryptedColumnsAllowlist'
import { bookingDb } from '../../../apps/web/src/server/booking/db/client'
import { pendingGuestIdentities, pendingAuthenticatedContactDetails } from '../../../apps/web/src/server/booking/db/schema'
import { decryptField } from '../../../apps/web/src/server/crypto/fieldCrypto'

async function verifyAllRowsDecryptableWithCurrentMap(): Promise<boolean> {
  const guestRows = await bookingDb.select().from(pendingGuestIdentities)
  const contactRows = await bookingDb.select().from(pendingAuthenticatedContactDetails)
  try {
    for (const row of guestRows) {
      decryptField({ ciphertext: row.firstNameCiphertext, nonce: row.firstNameNonce, keyVersion: row.firstNameKeyVersion })
      decryptField({ ciphertext: row.lastNameCiphertext, nonce: row.lastNameNonce, keyVersion: row.lastNameKeyVersion })
      decryptField({ ciphertext: row.emailCiphertext, nonce: row.emailNonce, keyVersion: row.emailKeyVersion })
      decryptField({ ciphertext: row.phoneCiphertext, nonce: row.phoneNonce, keyVersion: row.phoneKeyVersion })
    }
    for (const row of contactRows) {
      decryptField({ ciphertext: row.firstNameCiphertext, nonce: row.firstNameNonce, keyVersion: row.firstNameKeyVersion })
      decryptField({ ciphertext: row.lastNameCiphertext, nonce: row.lastNameNonce, keyVersion: row.lastNameKeyVersion })
      decryptField({ ciphertext: row.phoneCiphertext, nonce: row.phoneNonce, keyVersion: row.phoneKeyVersion })
    }
    return true
  } catch {
    return false
  }
}

async function main() {
  assertRotationEnvironmentAllowed()

  const allowlist = await verifyNoUnlistedEncryptedColumns(bookingDb)

  for (const fromVersion of ['v1', 'v2'] as const) {
    await rotatePendingGuestIdentities(bookingDb, { fromVersion, toVersion: 'v3', dryRun: false })
    await rotatePendingAuthenticatedContactDetails(bookingDb, { fromVersion, toVersion: 'v3', dryRun: false })
  }
  const aesRemainingV1 = await countRowsStillOnVersion(bookingDb, 'v1')
  const aesRemainingV2 = await countRowsStillOnVersion(bookingDb, 'v2')
  const aesDecryptOk = await verifyAllRowsDecryptableWithCurrentMap()

  await rotateEmailLookupHmac(bookingDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
  const emailLookupRemainingV1 = await countRowsStillOnEmailLookupHmacVersion(bookingDb, 'v1')

  // Recuentos EN FRESCO (nunca reutilizados de antes de migrar).
  const fingerprintRemaining = await countLiveBookingRequestsReferencingFingerprintVersions(bookingDb, ['v1', 'v2'])
  const accessTokenRemaining = await countLiveBookingRequestsReferencingAccessTokenVersions(bookingDb, ['v1'])

  console.log(
    JSON.stringify({
      allowlistOk: allowlist.ok,
      allowlistUnlisted: allowlist.unlisted,
      allowlistMissing: allowlist.missing,
      aesRemainingV1,
      aesRemainingV2,
      aesDecryptOk,
      emailLookupRemainingV1,
      fingerprintRemaining,
      accessTokenRemaining,
    }),
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
