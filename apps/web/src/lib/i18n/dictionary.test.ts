import { describe, expect, it } from 'vitest'

import { ca } from './dictionaries/ca'
import { en } from './dictionaries/en'
import { es } from './dictionaries/es'
import { fr } from './dictionaries/fr'
import { it as itDict } from './dictionaries/it'
import { pt } from './dictionaries/pt'
import { getDictionary } from './dictionary'
import { LOCALES } from './locales'

function sortedKeyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix]
  }
  return Object.keys(value)
    .sort()
    .flatMap((key) => sortedKeyPaths((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key))
}

const OTHER_DICTIONARIES = { ca, en, it: itDict, fr, pt }

describe('dictionary', () => {
  const esKeys = sortedKeyPaths(es)

  it('es no está vacío', () => {
    expect(esKeys.length).toBeGreaterThan(20)
  })

  it.each(Object.entries(OTHER_DICTIONARIES))('%s tiene exactamente las mismas claves que es', (_locale, dict) => {
    expect(sortedKeyPaths(dict)).toEqual(esKeys)
  })

  it.each(Object.entries(OTHER_DICTIONARIES))('%s no tiene ningún string vacío', (_locale, dict) => {
    const emptyPaths = sortedKeyPaths(dict).filter((path) => {
      const value = path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], dict)
      return value === ''
    })
    expect(emptyPaths).toEqual([])
  })

  it('getDictionary devuelve el diccionario correcto para cada locale', () => {
    for (const locale of LOCALES) {
      expect(getDictionary(locale).nav.inicio).toBeTruthy()
    }
  })
})
