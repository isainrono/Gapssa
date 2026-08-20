import { describe, expect, it } from 'vitest'

import { sanitizeRedirectTarget } from './redirectSafety'

const FALLBACK = '/es/mi-cuenta'

describe('sanitizeRedirectTarget', () => {
  it('accepts a plain relative path', () => {
    expect(sanitizeRedirectTarget('/es/mi-cuenta/citas', FALLBACK)).toBe('/es/mi-cuenta/citas')
  })

  it('accepts a relative path with a query string', () => {
    expect(sanitizeRedirectTarget('/es/mi-cuenta?tab=citas', FALLBACK)).toBe('/es/mi-cuenta?tab=citas')
  })

  it('falls back for null/undefined/empty input', () => {
    expect(sanitizeRedirectTarget(null, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeRedirectTarget(undefined, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeRedirectTarget('', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeRedirectTarget('   ', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects an absolute URL to another origin', () => {
    expect(sanitizeRedirectTarget('https://evil.example/phish', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeRedirectTarget('//evil.example/phish', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects the backslash open-redirect trick', () => {
    expect(sanitizeRedirectTarget('/\\evil.example', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects a target not starting with a single slash', () => {
    expect(sanitizeRedirectTarget('mi-cuenta', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeRedirectTarget('javascript:alert(1)', FALLBACK)).toBe(FALLBACK)
  })

  it('rejects control characters (e.g. CRLF header injection attempts)', () => {
    expect(sanitizeRedirectTarget('/es/mi-cuenta\r\nSet-Cookie:%20evil=1', FALLBACK)).toBe(FALLBACK)
    expect(sanitizeRedirectTarget('/es/mi-cuenta\x00', FALLBACK)).toBe(FALLBACK)
  })
})
