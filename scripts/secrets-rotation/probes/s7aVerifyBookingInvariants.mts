// scripts/secrets-rotation/probes/s7aVerifyBookingInvariants.mts
//
// Subpuerta S7A — verificación de SOLO LECTURA, tras aplicar las
// migraciones pendientes de `gapssa_booking`, de los invariantes que la
// migración 0008 (apps/web/drizzle/booking/migrations/0008_freezing_matthew_murdock.sql)
// documenta explícitamente en su backfill de `access_token_key_version`:
//
//   - Toda solicitud de INVITADO histórica (client_account_id IS NULL)
//     debe haber quedado con access_token_key_version = 'v1' tras el
//     backfill — nunca NULL (perdería verificabilidad de cualquier token
//     de invitado ya emitido).
//   - Ninguna solicitud del flujo AUTENTICADO (client_account_id IS NOT
//     NULL) debe tener access_token_key_version — ese flujo nunca emite
//     ni persiste token de acceso (ver accessToken.ts).
//   - `email_lookup_hmac_key_version` (NOT NULL desde 0008) no debe tener
//     ninguna fila con valor NULL en `pending_guest_identities`.
//
// Únicamente recuentos (`count(*)`) — cero PII, cero ciphertext, cero
// dato de negocio.
//
// Contrato de stdout (schema "s7a-verify"): un único documento JSON.

import { sql } from 'drizzle-orm'

import { assertRotationEnvironmentAllowed } from '../../../apps/web/src/server/booking/rotationSafetyChecks'
import { bookingDb } from '../../../apps/web/src/server/booking/db/client'

async function countRows(query: ReturnType<typeof sql>): Promise<number> {
  const result = (await bookingDb.execute(query)) as unknown as { rows: Array<{ n: number }> }
  return result.rows[0]?.n ?? 0
}

async function main() {
  assertRotationEnvironmentAllowed()

  const guestAccessTokenBackfillMissing = await countRows(
    sql`select count(*)::int as n from booking_request_records where client_account_id is null and access_token_key_version is null`,
  )
  const authenticatedAccessTokenVersionShouldBeNull = await countRows(
    sql`select count(*)::int as n from booking_request_records where client_account_id is not null and access_token_key_version is not null`,
  )
  const emailLookupKeyVersionNullCount = await countRows(
    sql`select count(*)::int as n from pending_guest_identities where email_lookup_hmac_key_version is null`,
  )

  const invariantsOk =
    guestAccessTokenBackfillMissing === 0 &&
    authenticatedAccessTokenVersionShouldBeNull === 0 &&
    emailLookupKeyVersionNullCount === 0

  console.log(
    JSON.stringify({
      guestAccessTokenBackfillMissing,
      authenticatedAccessTokenVersionShouldBeNull,
      emailLookupKeyVersionNullCount,
      invariantsOk,
    }),
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
