import { describe, expect, it, vi } from 'vitest'

import { assertSafeEspoSelect, EspoPiiQuerySafetyError, espoPiiSelectAllowlist } from './espoQuerySafety'

/**
 * Fase 4B, revisión 2, punto 7 — incidente de PII
 * (`docs/fase4b-integracion-http.md` §1: un `GET /User` sin `select=`
 * devolvió, y se imprimió por error, nombre/correo/teléfono reales de una
 * profesional). Estas pruebas demuestran que la guarda rechaza la consulta
 * ANTES de que exista cualquier oportunidad de tocar la red — se pasa
 * aquí un `fetch` que fallaría si se llegara a invocar, para probar que
 * nunca se invoca.
 */

const ALLOWLIST = espoPiiSelectAllowlist('cGapssaAccountId')

describe('assertSafeEspoSelect — User/Contact', () => {
  it('rechaza un GET a /api/v1/User sin select, antes de llamar a la red', () => {
    expect(() => assertSafeEspoSelect('GET', '/api/v1/User/abc123', undefined, ALLOWLIST)).toThrow(EspoPiiQuerySafetyError)
  })

  it('rechaza un GET a /api/v1/Contact sin select', () => {
    expect(() => assertSafeEspoSelect('GET', '/api/v1/Contact', {}, ALLOWLIST)).toThrow(EspoPiiQuerySafetyError)
  })

  it('rechaza un select vacío ("")', () => {
    expect(() => assertSafeEspoSelect('GET', '/api/v1/User/abc123', { select: '' }, ALLOWLIST)).toThrow(EspoPiiQuerySafetyError)
  })

  it('rechaza un select con campos fuera de la allowlist de User (p. ej. emailAddress)', () => {
    expect(() => assertSafeEspoSelect('GET', '/api/v1/User/abc123', { select: 'id,name,emailAddress' }, ALLOWLIST)).toThrow(
      EspoPiiQuerySafetyError,
    )
  })

  it('rechaza un select con campos fuera de la allowlist de Contact (p. ej. address)', () => {
    expect(() => assertSafeEspoSelect('GET', '/api/v1/Contact', { select: 'id,firstName,address' }, ALLOWLIST)).toThrow(
      EspoPiiQuerySafetyError,
    )
  })

  it('acepta un select de User dentro de la allowlist', () => {
    expect(() => assertSafeEspoSelect('GET', '/api/v1/User/abc123', { select: 'id,name,isActive' }, ALLOWLIST)).not.toThrow()
  })

  it('acepta un select de Contact dentro de la allowlist, incluido el campo real de cuenta Gapssa', () => {
    expect(() =>
      assertSafeEspoSelect('GET', '/api/v1/Contact', { select: 'id,firstName,lastName,emailAddress,phoneNumber,cGapssaAccountId' }, ALLOWLIST),
    ).not.toThrow()
  })

  it('no aplica a entidades sin PII (Meeting/CTratamiento/CZonaAtencion) — nunca exige select ahí', () => {
    expect(() => assertSafeEspoSelect('GET', '/api/v1/Meeting', undefined, ALLOWLIST)).not.toThrow()
    expect(() => assertSafeEspoSelect('GET', '/api/v1/CTratamiento', {}, ALLOWLIST)).not.toThrow()
  })

  it('no aplica a POST/PUT (select es un parámetro exclusivo de GET en la API de EspoCRM)', () => {
    expect(() => assertSafeEspoSelect('POST', '/api/v1/Contact', undefined, ALLOWLIST)).not.toThrow()
    expect(() => assertSafeEspoSelect('PUT', '/api/v1/User/abc123', undefined, ALLOWLIST)).not.toThrow()
  })

  it('lanza síncronamente, antes de que cualquier fetch pueda ejecutarse — la propia llamada a fetch nunca ocurre', () => {
    const fetchSpy = vi.fn()
    let threw = false
    try {
      assertSafeEspoSelect('GET', '/api/v1/User/abc123', undefined, ALLOWLIST)
      fetchSpy() // solo se alcanzaría si la guarda NO lanzara
    } catch (error) {
      threw = error instanceof EspoPiiQuerySafetyError
    }
    expect(threw).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
