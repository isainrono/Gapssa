import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, isLocale, LOCALES } from './locales'

describe('locales', () => {
  it('has exactly the 6 idiomas de la V1, español primero', () => {
    expect(LOCALES).toEqual(['es', 'ca', 'en', 'it', 'fr', 'pt'])
  })

  it('DEFAULT_LOCALE es español', () => {
    expect(DEFAULT_LOCALE).toBe('es')
  })

  it('isLocale acepta los 6 códigos válidos', () => {
    for (const locale of LOCALES) {
      expect(isLocale(locale)).toBe(true)
    }
  })

  it('isLocale rechaza códigos no soportados', () => {
    expect(isLocale('de')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale('ES')).toBe(false)
  })
})
