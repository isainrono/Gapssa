import { describe, expect, it } from 'vitest'

import { computeIdentityFingerprint, normalizeIdentityText, normalizePhone } from './identityFingerprint'
import { serverEnv } from '../env'

const ACTIVE_VERSION = serverEnv.BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION

describe('normalizeIdentityText', () => {
  it('trims, lowercases and collapses internal whitespace', () => {
    expect(normalizeIdentityText('  María   Pérez  ')).toBe('maría   pérez'.replace(/\s+/g, ' '))
    expect(normalizeIdentityText('María')).toBe(normalizeIdentityText(' MARÍA ')) // case/whitespace-insensitive
  })
})

describe('normalizePhone', () => {
  it('strips visual separators but keeps digits and a leading +', () => {
    expect(normalizePhone('+34 612 345 678')).toBe('+34612345678')
    expect(normalizePhone('612-345-678')).toBe('612345678')
    expect(normalizePhone('(612) 345.678')).toBe('612345678')
  })
})

describe('computeIdentityFingerprint', () => {
  it('is deterministic for the same normalized fields and key version', async () => {
    const fields = { firstName: 'ana', lastName: 'lopez', email: 'ana@example.com', phone: '+34600000000' }
    const a = await computeIdentityFingerprint('booking-guest-identity', fields, ACTIVE_VERSION)
    const b = await computeIdentityFingerprint('booking-guest-identity', fields, ACTIVE_VERSION)
    expect(a.value).toBe(b.value)
    expect(a.keyVersion).toBe(ACTIVE_VERSION)
  })

  it('produces a 64-char lowercase hex digest that never contains the raw input substrings', async () => {
    const fields = { firstName: 'ana', lastName: 'lopez', email: 'ana@example.com', phone: '+34600000000' }
    const result = await computeIdentityFingerprint('booking-guest-identity', fields, ACTIVE_VERSION)
    expect(result.value).toMatch(/^[0-9a-f]{64}$/)
    expect(result.value).not.toContain('ana')
    expect(result.value).not.toContain('lopez')
    expect(result.value).not.toContain('600000000')
  })

  it('changes when any single field changes', async () => {
    const base = { firstName: 'ana', lastName: 'lopez', email: 'ana@example.com', phone: '+34600000000' }
    const baseline = await computeIdentityFingerprint('booking-guest-identity', base, ACTIVE_VERSION)

    const variants = [
      { ...base, firstName: 'ane' },
      { ...base, lastName: 'lopeza' },
      { ...base, email: 'ana2@example.com' },
      { ...base, phone: '+34600000001' },
    ]
    for (const variant of variants) {
      const result = await computeIdentityFingerprint('booking-guest-identity', variant, ACTIVE_VERSION)
      expect(result.value).not.toBe(baseline.value)
    }
  })

  it('separates domains — same fields under a different domain produce a different fingerprint', async () => {
    const fields = { firstName: 'ana', lastName: 'lopez', phone: '+34600000000' }
    const guest = await computeIdentityFingerprint('booking-guest-identity', fields, ACTIVE_VERSION)
    const authenticated = await computeIdentityFingerprint('booking-authenticated-contact', fields, ACTIVE_VERSION)
    expect(guest.value).not.toBe(authenticated.value)
  })

  it('is insensitive to field insertion order (canonical payload sorts keys)', async () => {
    const a = await computeIdentityFingerprint('booking-guest-identity', { firstName: 'ana', lastName: 'lopez' }, ACTIVE_VERSION)
    const b = await computeIdentityFingerprint('booking-guest-identity', { lastName: 'lopez', firstName: 'ana' }, ACTIVE_VERSION)
    expect(a.value).toBe(b.value)
  })

  it('throws a clear error for an unregistered key version instead of a cryptic crypto error', async () => {
    await expect(
      computeIdentityFingerprint('booking-guest-identity', { firstName: 'ana' }, 'v-does-not-exist'),
    ).rejects.toThrow(/no hay secreto/i)
  })
})
