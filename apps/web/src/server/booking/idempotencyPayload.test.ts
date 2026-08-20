import { describe, expect, it } from 'vitest'

import { computePayloadHash, generateIdempotencyKey } from '@gapssa/contracts'

import { toCanonicalAuthenticatedBookingPayload, type AuthenticatedBookingCreateInput } from './authenticatedFlow'
import { toCanonicalGuestBookingPayload, type GuestBookingCreateInput } from './guestFlow'
import { serverEnv } from '../env'

/**
 * Revisión 2 de Fase 4A, punto 2: el payload canónico de idempotencia
 * NUNCA debe contener PII en claro (solo la huella HMAC,
 * `identityFingerprint.ts`), y el hash resultante debe reaccionar a
 * cualquier variación de dato personal O de dato de reserva (tratamiento,
 * profesional, zona, hora) — misma clave + mismos datos normalizados debe
 * ser indistinguible de un replay; cualquier otra variación debe producir
 * un hash distinto (que el llamante interpreta como conflicto).
 */

const ACTIVE_VERSION = serverEnv.BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION

const BASE_GUEST_INPUT: GuestBookingCreateInput = {
  idempotencyKey: generateIdempotencyKey(),
  treatmentId: 'treatment-a',
  professionalId: 'professional-a',
  zoneId: 'zone-a',
  startAt: '2026-09-01T09:00:00.000Z',
  guest: { firstName: 'Ana', lastName: 'López', phone: '+34 612 345 678', email: 'ana@example.com' },
}

async function hashGuest(input: GuestBookingCreateInput): Promise<string> {
  const payload = await toCanonicalGuestBookingPayload(input, ACTIVE_VERSION)
  return computePayloadHash(payload)
}

describe('toCanonicalGuestBookingPayload — no PII in the hashed payload', () => {
  it('never contains raw name/email/phone substrings anywhere in the serialized payload', async () => {
    const payload = await toCanonicalGuestBookingPayload(BASE_GUEST_INPUT, ACTIVE_VERSION)
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toMatch(/ana/i)
    expect(serialized).not.toMatch(/lópez|lopez/i)
    expect(serialized).not.toContain('612345678')
    expect(serialized).not.toContain('example.com')
  })

  it('same idempotencyKey + same normalized data ⇒ identical hash (replay)', async () => {
    const a = await hashGuest(BASE_GUEST_INPUT)
    // Variación no significativa (espacios, mayúsculas) — normalizeEmail /
    // normalizeIdentityText / normalizePhone deben absorberla.
    const b = await hashGuest({
      ...BASE_GUEST_INPUT,
      guest: { ...BASE_GUEST_INPUT.guest, firstName: '  ANA  ', email: '  Ana@Example.com ' },
    })
    expect(a).toBe(b)
  })

  it('a different first/last name changes the hash', async () => {
    const a = await hashGuest(BASE_GUEST_INPUT)
    const b = await hashGuest({ ...BASE_GUEST_INPUT, guest: { ...BASE_GUEST_INPUT.guest, firstName: 'Elena' } })
    const c = await hashGuest({ ...BASE_GUEST_INPUT, guest: { ...BASE_GUEST_INPUT.guest, lastName: 'García' } })
    expect(b).not.toBe(a)
    expect(c).not.toBe(a)
  })

  it('a different phone changes the hash', async () => {
    const a = await hashGuest(BASE_GUEST_INPUT)
    const b = await hashGuest({ ...BASE_GUEST_INPUT, guest: { ...BASE_GUEST_INPUT.guest, phone: '+34 699 999 999' } })
    expect(b).not.toBe(a)
  })

  it('a different email changes the hash', async () => {
    const a = await hashGuest(BASE_GUEST_INPUT)
    const b = await hashGuest({ ...BASE_GUEST_INPUT, guest: { ...BASE_GUEST_INPUT.guest, email: 'otra@example.com' } })
    expect(b).not.toBe(a)
  })

  it('a different treatment changes the hash', async () => {
    const a = await hashGuest(BASE_GUEST_INPUT)
    const b = await hashGuest({ ...BASE_GUEST_INPUT, treatmentId: 'treatment-b' })
    expect(b).not.toBe(a)
  })

  it('a different professional changes the hash', async () => {
    const a = await hashGuest(BASE_GUEST_INPUT)
    const b = await hashGuest({ ...BASE_GUEST_INPUT, professionalId: 'professional-b' })
    expect(b).not.toBe(a)
  })

  it('a different zone changes the hash', async () => {
    const a = await hashGuest(BASE_GUEST_INPUT)
    const b = await hashGuest({ ...BASE_GUEST_INPUT, zoneId: 'zone-b' })
    expect(b).not.toBe(a)
  })

  it('a different startAt changes the hash', async () => {
    const a = await hashGuest(BASE_GUEST_INPUT)
    const b = await hashGuest({ ...BASE_GUEST_INPUT, startAt: '2026-09-01T10:00:00.000Z' })
    expect(b).not.toBe(a)
  })

  it('the idempotencyKey itself never enters the canonical payload', async () => {
    const payload = await toCanonicalGuestBookingPayload(BASE_GUEST_INPUT, ACTIVE_VERSION)
    expect(JSON.stringify(payload)).not.toContain(BASE_GUEST_INPUT.idempotencyKey)
  })
})

const BASE_AUTH_INPUT: AuthenticatedBookingCreateInput = {
  idempotencyKey: generateIdempotencyKey(),
  treatmentId: 'treatment-a',
  professionalId: 'professional-a',
  zoneId: 'zone-a',
  startAt: '2026-09-01T09:00:00.000Z',
  contact: { firstName: 'Ana', lastName: 'López', phone: '+34 612 345 678' },
}
const ACCOUNT_ID = 'account-1'

async function hashAuthenticated(input: AuthenticatedBookingCreateInput): Promise<string> {
  const payload = await toCanonicalAuthenticatedBookingPayload(ACCOUNT_ID, input, ACTIVE_VERSION)
  return computePayloadHash(payload)
}

describe('toCanonicalAuthenticatedBookingPayload — no PII in the hashed payload', () => {
  it('never contains raw name/phone substrings', async () => {
    const payload = await toCanonicalAuthenticatedBookingPayload(ACCOUNT_ID, BASE_AUTH_INPUT, ACTIVE_VERSION)
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toMatch(/ana/i)
    expect(serialized).not.toMatch(/lópez|lopez/i)
    expect(serialized).not.toContain('612345678')
  })

  it('same account + same normalized contact ⇒ identical hash (replay)', async () => {
    const a = await hashAuthenticated(BASE_AUTH_INPUT)
    const b = await hashAuthenticated({
      ...BASE_AUTH_INPUT,
      contact: { ...BASE_AUTH_INPUT.contact, firstName: '  ANA  ' },
    })
    expect(a).toBe(b)
  })

  it('a different contact name/phone for the SAME account+key changes the hash (guards against reusing a key with different personal data)', async () => {
    const a = await hashAuthenticated(BASE_AUTH_INPUT)
    const b = await hashAuthenticated({ ...BASE_AUTH_INPUT, contact: { ...BASE_AUTH_INPUT.contact, firstName: 'Elena' } })
    const c = await hashAuthenticated({ ...BASE_AUTH_INPUT, contact: { ...BASE_AUTH_INPUT.contact, phone: '+34 699 999 999' } })
    expect(b).not.toBe(a)
    expect(c).not.toBe(a)
  })

  it('a different treatment/professional/zone/startAt changes the hash', async () => {
    const a = await hashAuthenticated(BASE_AUTH_INPUT)
    expect(await hashAuthenticated({ ...BASE_AUTH_INPUT, treatmentId: 'treatment-b' })).not.toBe(a)
    expect(await hashAuthenticated({ ...BASE_AUTH_INPUT, professionalId: 'professional-b' })).not.toBe(a)
    expect(await hashAuthenticated({ ...BASE_AUTH_INPUT, zoneId: 'zone-b' })).not.toBe(a)
    expect(await hashAuthenticated({ ...BASE_AUTH_INPUT, startAt: '2026-09-01T10:00:00.000Z' })).not.toBe(a)
  })

  it('a different account for the same idempotencyKey changes the hash', async () => {
    const a = await hashAuthenticated(BASE_AUTH_INPUT)
    const payloadOtherAccount = await toCanonicalAuthenticatedBookingPayload('account-2', BASE_AUTH_INPUT, ACTIVE_VERSION)
    const b = await computePayloadHash(payloadOtherAccount)
    expect(b).not.toBe(a)
  })
})
