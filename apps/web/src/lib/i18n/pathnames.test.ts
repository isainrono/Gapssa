import { describe, expect, it } from 'vitest'

import { otherLocales, swapLocaleInPath } from './pathnames'

describe('swapLocaleInPath', () => {
  it('sustituye el locale en la portada', () => {
    expect(swapLocaleInPath('/es', 'en')).toBe('/en')
  })

  it('sustituye el locale preservando el resto de la ruta', () => {
    expect(swapLocaleInPath('/es/tratamientos/masaje-relajante', 'fr')).toBe('/fr/tratamientos/masaje-relajante')
  })

  it('devuelve la portada del nuevo locale si la ruta no tiene locale reconocible', () => {
    expect(swapLocaleInPath('/', 'pt')).toBe('/pt')
    expect(swapLocaleInPath('/admin', 'pt')).toBe('/pt')
  })
})

describe('otherLocales', () => {
  it('excluye el locale actual y mantiene los otros 5', () => {
    const result = otherLocales('es')
    expect(result).toHaveLength(5)
    expect(result).not.toContain('es')
  })
})
