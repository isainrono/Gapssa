import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Revisión 2 de Fase 3: `getClientIp` confiaba ciegamente en la PRIMERA
 * entrada de `X-Forwarded-For` — aportada por quien hace la petición,
 * falsificable a voluntad si la aplicación queda alguna vez accesible sin
 * un proxy que sanee la cabecera. Estas pruebas fijan
 * `TRUSTED_PROXY_HOP_COUNT` por caso (vía `vi.resetModules` +
 * reimportación, porque `server/env.ts` congela el valor al cargar el
 * módulo) y comprueban la topología documentada: con N saltos de confianza,
 * la IP del cliente es la entrada N-ésima contando desde la derecha.
 */

async function loadGetClientIp(trustedProxyHopCount: string) {
  vi.resetModules()
  vi.stubEnv('TRUSTED_PROXY_HOP_COUNT', trustedProxyHopCount)
  const mod = await import('./httpHelpers')
  return mod
}

function requestWithForwardedFor(value: string | null): Request {
  const headers = new Headers()
  if (value !== null) {
    headers.set('x-forwarded-for', value)
  }
  return new Request('http://localhost/api/auth/login', { headers })
}

describe('getClientIp', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('with 1 trusted hop (default topology), takes the LAST entry — the one the immediate proxy appended', async () => {
    const { getClientIp } = await loadGetClientIp('1')
    const request = requestWithForwardedFor('1.2.3.4, 203.0.113.9')
    expect(getClientIp(request)).toBe('203.0.113.9')
  })

  it('with 1 trusted hop, a spoofed single-entry header is still trusted (it IS the only entry, i.e. the proxy-appended one)', async () => {
    const { getClientIp } = await loadGetClientIp('1')
    const request = requestWithForwardedFor('203.0.113.9')
    expect(getClientIp(request)).toBe('203.0.113.9')
  })

  it('with 2 trusted hops (proxy chain), takes the second-to-last entry', async () => {
    const { getClientIp } = await loadGetClientIp('2')
    const request = requestWithForwardedFor('1.2.3.4, 198.51.100.7, 203.0.113.9')
    expect(getClientIp(request)).toBe('198.51.100.7')
  })

  it('returns CLIENT_IP_UNKNOWN when the header is missing', async () => {
    const { getClientIp, CLIENT_IP_UNKNOWN } = await loadGetClientIp('1')
    expect(getClientIp(requestWithForwardedFor(null))).toBe(CLIENT_IP_UNKNOWN)
  })

  it('returns CLIENT_IP_UNKNOWN when there are fewer entries than trusted hops', async () => {
    const { getClientIp, CLIENT_IP_UNKNOWN } = await loadGetClientIp('2')
    expect(getClientIp(requestWithForwardedFor('203.0.113.9'))).toBe(CLIENT_IP_UNKNOWN)
  })

  it('returns CLIENT_IP_UNKNOWN when the candidate entry is not a valid IPv4/IPv6 address', async () => {
    const { getClientIp, CLIENT_IP_UNKNOWN } = await loadGetClientIp('1')
    expect(getClientIp(requestWithForwardedFor('1.2.3.4, not-an-ip'))).toBe(CLIENT_IP_UNKNOWN)
    expect(getClientIp(requestWithForwardedFor('1.2.3.4, ../../etc/passwd'))).toBe(CLIENT_IP_UNKNOWN)
  })

  it('accepts a valid IPv6 candidate', async () => {
    const { getClientIp } = await loadGetClientIp('1')
    expect(getClientIp(requestWithForwardedFor('1.2.3.4, 2001:db8::1'))).toBe('2001:db8::1')
  })

  it('returns CLIENT_IP_UNKNOWN when TRUSTED_PROXY_HOP_COUNT is 0, even with a well-formed header', async () => {
    const { getClientIp, CLIENT_IP_UNKNOWN } = await loadGetClientIp('0')
    expect(getClientIp(requestWithForwardedFor('1.2.3.4, 203.0.113.9'))).toBe(CLIENT_IP_UNKNOWN)
  })

  it('returns CLIENT_IP_UNKNOWN for an oversized header instead of parsing it', async () => {
    const { getClientIp, CLIENT_IP_UNKNOWN } = await loadGetClientIp('1')
    const huge = `${'1.2.3.4, '.repeat(200)}203.0.113.9`
    expect(getClientIp(requestWithForwardedFor(huge))).toBe(CLIENT_IP_UNKNOWN)
  })

  it('tolerates extra whitespace around entries', async () => {
    const { getClientIp } = await loadGetClientIp('1')
    expect(getClientIp(requestWithForwardedFor('  1.2.3.4  ,  203.0.113.9  '))).toBe('203.0.113.9')
  })
})
