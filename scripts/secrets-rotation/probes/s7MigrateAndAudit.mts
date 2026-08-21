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
//
// --- Pausa de prueba (Bloque 10 — validación dedicada de S7) ---
// `GAPSSA_ROTATION_TEST_MIGRATION_PAUSE` (ausente por defecto, cero
// efecto en cualquier ejecución real): permite a un arnés de pruebas
// interrumpir (SIGINT real al proceso de bash que orquesta S7, que
// alcanza también a este hijo) EN MITAD de la migración multi-fase, en
// vez de solo antes/después de la invocación completa — la única forma
// de demostrar de verdad "convivencia dual conservada e idempotencia"
// si la interrupción cae ENTRE la fase AES y la de email-lookup, o
// entre v1 y v2 de la propia fase AES. Puntos cerrados: "after-aes-v1",
// "after-aes-v2", "after-email-lookup". Exige la MISMA
// `GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL` (patrón de proyecto
// desechable) que lib/atomicSecretsFileMutate.mjs — si la pausa está
// pedida pero la etiqueta falta o no casa, o el valor no es uno de los
// 3 cerrados, este script aborta (exit 1) ANTES de tocar Postgres,
// nunca "la pausa no aplica, sigo normalmente". El marcador de progreso
// y cualquier mensaje de esta guarda van SIEMPRE a stderr, nunca a
// stdout (el contrato de arriba exige stdout limpio para
// validateProbeJson.mjs).

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

const TEST_MIGRATION_PAUSE_POINTS = ['after-aes-v1', 'after-aes-v2', 'after-email-lookup'] as const
const DISPOSABLE_LABEL_PATTERN = /^gapssa-[a-z0-9]+(-[a-z0-9]+)*-(rehearsal|tests?)-[0-9a-f]{6,}$/

/**
 * Valida, UNA VEZ al arrancar, que si `GAPSSA_ROTATION_TEST_MIGRATION_PAUSE`
 * está presente el contexto es desechable — misma guarda que
 * lib/atomicSecretsFileMutate.mjs::resolveTestFailpoint. Devuelve el
 * punto pedido o null.
 */
function resolveTestMigrationPause(): string | null {
  const requested = process.env.GAPSSA_ROTATION_TEST_MIGRATION_PAUSE
  if (!requested) return null
  if (!(TEST_MIGRATION_PAUSE_POINTS as readonly string[]).includes(requested)) {
    console.error(`ERROR: GAPSSA_ROTATION_TEST_MIGRATION_PAUSE="${requested}" no es uno de los valores cerrados (${TEST_MIGRATION_PAUSE_POINTS.join(', ')}) — abortado.`)
    process.exit(1)
  }
  const label = process.env.GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL
  if (!label || !DISPOSABLE_LABEL_PATTERN.test(label)) {
    console.error('ERROR: GAPSSA_ROTATION_TEST_MIGRATION_PAUSE está presente sin una GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL válida — abortado antes de tocar Postgres.')
    process.exit(1)
  }
  return requested
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Marcador de progreso a stderr + pausa acotada si `point` es el pedido — no-op en cualquier otro caso (incluida la ejecución real, donde la variable nunca está presente). */
async function maybePauseAtTestPoint(activePause: string | null, point: string): Promise<void> {
  if (activePause !== point) return
  const ms = Number(process.env.GAPSSA_ROTATION_TEST_MIGRATION_PAUSE_MS ?? '5000')
  console.error(`GAPSSA_ROTATION_TEST_MIGRATION_PAUSE_REACHED=${point}`)
  await sleep(Number.isFinite(ms) && ms > 0 ? ms : 5000)
}

async function main() {
  assertRotationEnvironmentAllowed()
  const activePause = resolveTestMigrationPause()

  const allowlist = await verifyNoUnlistedEncryptedColumns(bookingDb)

  await rotatePendingGuestIdentities(bookingDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
  await rotatePendingAuthenticatedContactDetails(bookingDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
  await maybePauseAtTestPoint(activePause, 'after-aes-v1')
  await rotatePendingGuestIdentities(bookingDb, { fromVersion: 'v2', toVersion: 'v3', dryRun: false })
  await rotatePendingAuthenticatedContactDetails(bookingDb, { fromVersion: 'v2', toVersion: 'v3', dryRun: false })
  await maybePauseAtTestPoint(activePause, 'after-aes-v2')

  const aesRemainingV1 = await countRowsStillOnVersion(bookingDb, 'v1')
  const aesRemainingV2 = await countRowsStillOnVersion(bookingDb, 'v2')
  const aesDecryptOk = await verifyAllRowsDecryptableWithCurrentMap()

  await rotateEmailLookupHmac(bookingDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
  const emailLookupRemainingV1 = await countRowsStillOnEmailLookupHmacVersion(bookingDb, 'v1')
  await maybePauseAtTestPoint(activePause, 'after-email-lookup')

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
