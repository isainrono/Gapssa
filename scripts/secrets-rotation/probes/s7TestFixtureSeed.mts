// scripts/secrets-rotation/probes/s7TestFixtureSeed.mts — Bloque 10
// (validación dedicada de S7 contra Postgres desechable real).
//
// Siembra filas SINTÉTICAS (datos de negocio completamente ficticios,
// nunca copiados de ningún dato real) en `gapssa_booking` usando las
// funciones de PRODUCCIÓN reales — el mismo cifrado AES-256-GCM
// (`server/crypto/fieldCrypto.ts::encryptFieldWithVersion`), la misma
// huella de identidad HMAC (`server/booking/identityFingerprint.ts::computeIdentityFingerprint`),
// el mismo HMAC de email-lookup (`hmacSubjectId`, `@gapssa/contracts`) y
// el mismo esquema Drizzle (`server/booking/db/schema.ts`) que el flujo
// de reservas real — nunca una reimplementación paralela ni un valor
// inventado con la forma "parecida" a un `EncryptedField`. Se inserta
// DIRECTAMENTE vía Drizzle (sin pasar por `createGuestBooking`/
// `createAuthenticatedBooking`, que exigen Redis/EspoCRM/OTP reales,
// irrelevantes para probar rotación de secretos) — la rotación tampoco
// pasa por esas rutas, solo lee/escribe columnas de tabla.
//
// SOLO EJECUTABLE CONTRA UN PROYECTO DESECHABLE (misma guarda cerrada que
// lib/atomicSecretsFileMutate.mjs / probes/s7MigrateAndAudit.mts) — exige
// GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL con el patrón de proyecto
// desechable; aborta si falta o no casa, ANTES de tocar Postgres.
//
// Uso: node --import tsx s7TestFixtureSeed.mts   (spec JSON por stdin,
// resultado JSON por stdout — SOLO ids/kind/tabla, JAMÁS PII/ciphertext/
// HMAC/plaintext).
//
// stdin: { "rows": RowSpec[] }
//   RowSpec (invitado):
//     { "kind": "guest", "aesVersion": "v1"|"v2", "fingerprintVersion": "v1"|"v2",
//       "accessTokenVersion": "v1", "emailHmacVersion": "v1",
//       "status": <BookingRequestStatus>, "corrupt"?: true }
//   RowSpec (autenticado):
//     { "kind": "authenticated", "aesVersion": "v1"|"v2", "fingerprintVersion": "v1"|"v2",
//       "status": <BookingRequestStatus>, "corrupt"?: true }
//
// "corrupt": true tamperea el ciphertext del campo `email` (invitado) /
// `phone` (autenticado) tras cifrarlo de verdad con la versión pedida —
// el `keyVersion` guardado sigue siendo esa versión (así que la
// migración SÍ intenta recifrarlo), pero `decryptField` lanzará
// FieldCryptoError (tag de autenticación GCM inválido) al intentarlo —
// fila real, deliberadamente no descifrable, nunca un valor inventado
// sin forma de EncryptedField.

import { randomUUID, createHash } from 'node:crypto'

import { bookingDb } from '../../../apps/web/src/server/booking/db/client'
import { bookingRequestRecords, pendingGuestIdentities, pendingAuthenticatedContactDetails } from '../../../apps/web/src/server/booking/db/schema'
import { encryptFieldWithVersion } from '../../../apps/web/src/server/crypto/fieldCrypto'
import { computeIdentityFingerprint } from '../../../apps/web/src/server/booking/identityFingerprint'
import { signBookingRequestAccessTokenWithVersion } from '../../../apps/web/src/server/booking/accessToken'
import { hmacSubjectId, normalizeEmail } from '@gapssa/contracts'
import { serverEnv } from '../../../apps/web/src/server/env'

const DISPOSABLE_LABEL_PATTERN = /^gapssa-[a-z0-9]+(-[a-z0-9]+)*-(rehearsal|tests?)-[0-9a-f]{6,}$/
const GUEST_IDENTITY_FINGERPRINT_DOMAIN = 'booking-guest-identity'
const AUTHENTICATED_CONTACT_FINGERPRINT_DOMAIN = 'booking-authenticated-contact'

function assertDisposableContext(): void {
  const label = process.env.GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL
  if (!label || !DISPOSABLE_LABEL_PATTERN.test(label)) {
    console.error('ERROR: falta o no casa GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL (patrón de proyecto desechable) — este sembrador de fixtures NUNCA se ejecuta sin esa guarda, para que no pueda apuntar por error a Postgres real.')
    process.exit(1)
  }
}

interface GuestRowSpec {
  kind: 'guest'
  aesVersion: string
  fingerprintVersion: string
  accessTokenVersion: string
  emailHmacVersion: string
  status: string
  corrupt?: boolean
}
interface AuthenticatedRowSpec {
  kind: 'authenticated'
  aesVersion: string
  fingerprintVersion: string
  status: string
  corrupt?: boolean
}
type RowSpec = GuestRowSpec | AuthenticatedRowSpec

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateSpec(input: unknown): RowSpec[] {
  if (!isPlainObject(input) || !Array.isArray(input.rows)) {
    throw new Error('spec inválida: se esperaba { "rows": [...] }')
  }
  for (const [i, row] of input.rows.entries()) {
    if (!isPlainObject(row) || (row.kind !== 'guest' && row.kind !== 'authenticated')) {
      throw new Error(`rows[${i}]: "kind" debe ser "guest" o "authenticated"`)
    }
    if (typeof row.aesVersion !== 'string' || typeof row.fingerprintVersion !== 'string' || typeof row.status !== 'string') {
      throw new Error(`rows[${i}]: aesVersion/fingerprintVersion/status deben ser string`)
    }
    if (row.kind === 'guest' && (typeof row.accessTokenVersion !== 'string' || typeof row.emailHmacVersion !== 'string')) {
      throw new Error(`rows[${i}]: guest exige accessTokenVersion/emailHmacVersion string`)
    }
  }
  return input.rows as RowSpec[]
}

function corruptCiphertext(ciphertext: string): string {
  // Decodifica, invierte el ÚLTIMO byte (dentro del tag de autenticación
  // GCM, los últimos 16 bytes) y vuelve a codificar — sigue siendo
  // base64 válido y de la misma longitud, pero el tag ya NUNCA verifica.
  const buf = Buffer.from(ciphertext, 'base64')
  buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff
  return buf.toString('base64')
}

function fakePayloadHash(): string {
  return createHash('sha256').update(randomUUID()).digest('hex')
}

function futureWindow() {
  const now = Date.now()
  return {
    startAt: new Date(now + 24 * 3600 * 1000),
    endAt: new Date(now + 24 * 3600 * 1000 + 3600 * 1000),
    verificationExpiresAt: new Date(now + 15 * 60 * 1000),
  }
}

async function seedGuestRow(spec: GuestRowSpec) {
  const { startAt, endAt, verificationExpiresAt } = futureWindow()
  const fingerprint = await computeIdentityFingerprint(
    GUEST_IDENTITY_FINGERPRINT_DOMAIN,
    { firstName: 'invitada de prueba', lastName: 'apellido de prueba', email: `invitada-${randomUUID()}@ejemplo-ficticio.invalid`, phone: '+34600000000' },
    spec.fingerprintVersion,
  )
  const accessToken = signBookingRequestAccessTokenWithVersion(randomUUID(), spec.accessTokenVersion)
  void accessToken // el propio token no se persiste (se firma sobre el id real más abajo si hiciera falta) — solo demuestra que la versión pedida firma sin error.

  const [request] = await bookingDb
    .insert(bookingRequestRecords)
    .values({
      treatmentId: 'tratamiento-ficticio-fixture',
      professionalId: 'profesional-ficticio-fixture',
      zoneId: 'zona-ficticia-fixture',
      startAt,
      endAt,
      status: spec.status as (typeof bookingRequestRecords.$inferInsert)['status'],
      verificationExpiresAt,
      idempotencyKey: randomUUID(),
      payloadHash: fakePayloadHash(),
      identityFingerprintKeyVersion: fingerprint.keyVersion,
      accessTokenKeyVersion: spec.accessTokenVersion,
    })
    .returning({ id: bookingRequestRecords.id })

  const normalizedEmail = normalizeEmail(`invitada-${randomUUID()}@ejemplo-ficticio.invalid`)
  const emailSecret = serverEnv.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS[spec.emailHmacVersion]
  if (!emailSecret) throw new Error(`no hay secreto de email-lookup HMAC para la versión "${spec.emailHmacVersion}" — fixture inválida`)
  const emailLookupHmac = await hmacSubjectId('booking-guest-email', normalizedEmail, emailSecret)

  const first = encryptFieldWithVersion('nombre de invitada ficticio', spec.aesVersion)
  const last = encryptFieldWithVersion('apellido de invitada ficticio', spec.aesVersion)
  const email = encryptFieldWithVersion(normalizedEmail, spec.aesVersion)
  const phone = encryptFieldWithVersion('+34600000001', spec.aesVersion)
  if (spec.corrupt) {
    email.ciphertext = corruptCiphertext(email.ciphertext)
  }

  const [identity] = await bookingDb
    .insert(pendingGuestIdentities)
    .values({
      bookingRequestId: request.id,
      firstNameCiphertext: first.ciphertext,
      firstNameNonce: first.nonce,
      firstNameKeyVersion: first.keyVersion,
      lastNameCiphertext: last.ciphertext,
      lastNameNonce: last.nonce,
      lastNameKeyVersion: last.keyVersion,
      emailCiphertext: email.ciphertext,
      emailNonce: email.nonce,
      emailKeyVersion: email.keyVersion,
      phoneCiphertext: phone.ciphertext,
      phoneNonce: phone.nonce,
      phoneKeyVersion: phone.keyVersion,
      emailLookupHmac,
      emailLookupHmacKeyVersion: spec.emailHmacVersion,
      status: 'active',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    })
    .returning({ id: pendingGuestIdentities.id })

  return { table: 'pending_guest_identities', bookingRequestId: request.id, identityId: identity.id }
}

async function seedAuthenticatedRow(spec: AuthenticatedRowSpec) {
  const { startAt, endAt, verificationExpiresAt } = futureWindow()
  const fingerprint = await computeIdentityFingerprint(
    AUTHENTICATED_CONTACT_FINGERPRINT_DOMAIN,
    { firstName: 'cliente de prueba', lastName: 'apellido de prueba', phone: '+34600000002' },
    spec.fingerprintVersion,
  )

  const [request] = await bookingDb
    .insert(bookingRequestRecords)
    .values({
      clientAccountId: randomUUID(),
      treatmentId: 'tratamiento-ficticio-fixture',
      professionalId: 'profesional-ficticio-fixture',
      zoneId: 'zona-ficticia-fixture',
      startAt,
      endAt,
      status: spec.status as (typeof bookingRequestRecords.$inferInsert)['status'],
      verificationExpiresAt,
      idempotencyKey: randomUUID(),
      payloadHash: fakePayloadHash(),
      identityFingerprintKeyVersion: fingerprint.keyVersion,
      accessTokenKeyVersion: null,
    })
    .returning({ id: bookingRequestRecords.id })

  const first = encryptFieldWithVersion('nombre de cliente ficticio', spec.aesVersion)
  const last = encryptFieldWithVersion('apellido de cliente ficticio', spec.aesVersion)
  const phone = encryptFieldWithVersion('+34600000003', spec.aesVersion)
  if (spec.corrupt) {
    phone.ciphertext = corruptCiphertext(phone.ciphertext)
  }

  const [contact] = await bookingDb
    .insert(pendingAuthenticatedContactDetails)
    .values({
      bookingRequestId: request.id,
      firstNameCiphertext: first.ciphertext,
      firstNameNonce: first.nonce,
      firstNameKeyVersion: first.keyVersion,
      lastNameCiphertext: last.ciphertext,
      lastNameNonce: last.nonce,
      lastNameKeyVersion: last.keyVersion,
      phoneCiphertext: phone.ciphertext,
      phoneNonce: phone.nonce,
      phoneKeyVersion: phone.keyVersion,
      status: 'active',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    })
    .returning({ id: pendingAuthenticatedContactDetails.id })

  return { table: 'pending_authenticated_contact_details', bookingRequestId: request.id, identityId: contact.id }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  assertDisposableContext()
  const raw = await readAllStdin()
  const rows = validateSpec(JSON.parse(raw))

  const created: Array<{ kind: string; table: string; bookingRequestId: string; identityId: string }> = []
  for (const row of rows) {
    if (row.kind === 'guest') {
      const result = await seedGuestRow(row)
      created.push({ kind: 'guest', ...result })
    } else {
      const result = await seedAuthenticatedRow(row)
      created.push({ kind: 'authenticated', ...result })
    }
  }

  console.log(JSON.stringify({ created }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
