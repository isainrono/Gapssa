// scripts/secrets-rotation/probes/s7TestFixtureVerify.mts — Bloque 10
// (validación dedicada de S7 contra Postgres desechable real).
//
// Verifica, usando EXCLUSIVAMENTE las funciones reales de producción
// (`decryptField`, el mismo `serverEnv` que lee el `$SECRETS_FILE`
// actual — nunca un mapa aparte construido para la prueba), que cada
// fila sembrada por s7TestFixtureSeed.mts sigue siendo lógicamente
// EQUIVALENTE al dato original (mismo plaintext, columnas fijas y
// conocidas por este mismo arnés) tras recifrar/retirar — nunca compara
// ciphertext, que cambia legítimamente en cada recifrado. Se ejecuta
// tantas veces como haga falta durante un ensayo (antes de migrar, tras
// migrar, tras retirar) — siempre contra el mapa que HAYA en
// `$SECRETS_FILE` en ese momento exacto (buildChildEnv real, nunca un
// mapa "final" simulado aparte).
//
// SOLO EJECUTABLE CONTRA UN PROYECTO DESECHABLE — misma guarda cerrada
// que s7TestFixtureSeed.mts.
//
// Uso: node --import tsx s7TestFixtureVerify.mts   (spec JSON por stdin,
// resultado JSON por stdout — SOLO ids/booleanos/versiones, JAMÁS
// plaintext/ciphertext/HMAC).
//
// stdin: { "rows": [{ "kind": "guest"|"authenticated", "identityId": "<uuid>", "expectCorrupt"?: true }, ...] }
//   "expectCorrupt": true invierte el veredicto para esa fila — se
//   espera que NO descifre (fila deliberadamente corrupta de
//   s7TestFixtureSeed.mts); si SÍ descifrara, sería en sí mismo un
//   fallo (evidencia de que el failpoint/corrupción no se aplicó).
//
// stdout: { "rows": [{ "identityId", "decryptable": bool, "logicallyEquivalent": bool, "keyVersions": {campo: versión, ...} }, ...],
//           "allOk": bool }
//   "allOk" exige, para cada fila SIN expectCorrupt: decryptable=true Y
//   logicallyEquivalent=true; para cada fila CON expectCorrupt:
//   decryptable=false en el campo deliberadamente corrompido.

import { eq } from 'drizzle-orm'

import { bookingDb } from '../../../apps/web/src/server/booking/db/client'
import { pendingGuestIdentities, pendingAuthenticatedContactDetails } from '../../../apps/web/src/server/booking/db/schema'
import { decryptField, FieldCryptoError } from '../../../apps/web/src/server/crypto/fieldCrypto'

const DISPOSABLE_LABEL_PATTERN = /^gapssa-[a-z0-9]+(-[a-z0-9]+)*-(rehearsal|tests?)-[0-9a-f]{6,}$/

function assertDisposableContext(): void {
  const label = process.env.GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL
  if (!label || !DISPOSABLE_LABEL_PATTERN.test(label)) {
    console.error('ERROR: falta o no casa GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL — este verificador NUNCA se ejecuta sin esa guarda.')
    process.exit(1)
  }
}

// Plaintexts FIJOS usados por s7TestFixtureSeed.mts — únicos valores
// contra los que se compara "equivalencia lógica" (el email de invitado
// varía por fila con un UUID, así que ese campo solo comprueba
// descifrado, nunca igualdad contra un valor fijo).
const EXPECTED = {
  guestFirstName: 'nombre de invitada ficticio',
  guestLastName: 'apellido de invitada ficticio',
  guestPhone: '+34600000001',
  authFirstName: 'nombre de cliente ficticio',
  authLastName: 'apellido de cliente ficticio',
  authPhone: '+34600000003',
}

interface RowIn {
  kind: 'guest' | 'authenticated'
  identityId: string
  expectCorrupt?: boolean
}
interface FieldResult {
  decrypted: boolean
  equivalent: boolean
  keyVersion: string
}
interface RowOut {
  identityId: string
  decryptable: boolean
  logicallyEquivalent: boolean
  keyVersions: Record<string, string>
}

function tryDecrypt(ciphertext: string, nonce: string, keyVersion: string, expected: string | null): FieldResult {
  try {
    const plaintext = decryptField({ ciphertext, nonce, keyVersion })
    return { decrypted: true, equivalent: expected === null || plaintext === expected, keyVersion }
  } catch (err) {
    if (err instanceof FieldCryptoError) {
      return { decrypted: false, equivalent: false, keyVersion }
    }
    throw err
  }
}

async function verifyGuestRow(identityId: string, expectCorrupt: boolean): Promise<RowOut> {
  const [row] = await bookingDb.select().from(pendingGuestIdentities).where(eq(pendingGuestIdentities.id, identityId))
  if (!row) throw new Error(`fila guest ${identityId} no encontrada`)

  const first = tryDecrypt(row.firstNameCiphertext, row.firstNameNonce, row.firstNameKeyVersion, EXPECTED.guestFirstName)
  const last = tryDecrypt(row.lastNameCiphertext, row.lastNameNonce, row.lastNameKeyVersion, EXPECTED.guestLastName)
  // El campo email es el deliberadamente corrompido por s7TestFixtureSeed.mts
  // cuando corrupt=true — se compara solo "descifra o no", nunca contra
  // un valor fijo (varía por fila).
  const email = tryDecrypt(row.emailCiphertext, row.emailNonce, row.emailKeyVersion, null)
  const phone = tryDecrypt(row.phoneCiphertext, row.phoneNonce, row.phoneKeyVersion, EXPECTED.guestPhone)

  const fields = { firstName: first, lastName: last, email, phone }
  const keyVersions = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.keyVersion]))

  if (expectCorrupt) {
    // Se espera EXACTAMENTE que "email" no descifre y los demás campos
    // (nunca tocados por la corrupción) sí, y sigan siendo equivalentes.
    const decryptable = !email.decrypted && first.decrypted && last.decrypted && phone.decrypted
    const logicallyEquivalent = first.equivalent && last.equivalent && phone.equivalent
    return { identityId, decryptable, logicallyEquivalent, keyVersions }
  }

  const decryptable = first.decrypted && last.decrypted && email.decrypted && phone.decrypted
  const logicallyEquivalent = first.equivalent && last.equivalent && email.equivalent && phone.equivalent
  return { identityId, decryptable, logicallyEquivalent, keyVersions }
}

async function verifyAuthenticatedRow(identityId: string, expectCorrupt: boolean): Promise<RowOut> {
  const [row] = await bookingDb.select().from(pendingAuthenticatedContactDetails).where(eq(pendingAuthenticatedContactDetails.id, identityId))
  if (!row) throw new Error(`fila authenticated ${identityId} no encontrada`)

  const first = tryDecrypt(row.firstNameCiphertext, row.firstNameNonce, row.firstNameKeyVersion, EXPECTED.authFirstName)
  const last = tryDecrypt(row.lastNameCiphertext, row.lastNameNonce, row.lastNameKeyVersion, EXPECTED.authLastName)
  // El campo phone es el deliberadamente corrompido para filas authenticated.
  const phone = tryDecrypt(row.phoneCiphertext, row.phoneNonce, row.phoneKeyVersion, expectCorrupt ? null : EXPECTED.authPhone)

  const fields = { firstName: first, lastName: last, phone }
  const keyVersions = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.keyVersion]))

  if (expectCorrupt) {
    const decryptable = !phone.decrypted && first.decrypted && last.decrypted
    const logicallyEquivalent = first.equivalent && last.equivalent
    return { identityId, decryptable, logicallyEquivalent, keyVersions }
  }

  const decryptable = first.decrypted && last.decrypted && phone.decrypted
  const logicallyEquivalent = first.equivalent && last.equivalent && phone.equivalent
  return { identityId, decryptable, logicallyEquivalent, keyVersions }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  assertDisposableContext()
  const raw = await readAllStdin()
  const parsed = JSON.parse(raw) as { rows: RowIn[] }

  const results: RowOut[] = []
  for (const row of parsed.rows) {
    const result = row.kind === 'guest' ? await verifyGuestRow(row.identityId, row.expectCorrupt === true) : await verifyAuthenticatedRow(row.identityId, row.expectCorrupt === true)
    results.push(result)
  }

  const allOk = results.every((r) => r.decryptable && r.logicallyEquivalent)
  console.log(JSON.stringify({ rows: results, allOk }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
