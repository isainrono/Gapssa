import { describe, expect, it } from 'vitest'

import { LOCALES } from '@/lib/i18n/locales'

import { TRATAMIENTOS_SEED } from './tratamientos'

/**
 * Revisión 2 de Fase 2: el catálogo debe ser realmente multilingüe desde el
 * inicio (`PROJECT_CONTEXT.md` §3.1) — el fallback a español no cuenta como
 * traducción. Estas pruebas fallan si falta cualquier idioma o campo
 * traducible obligatorio para cualquiera de los 57 tratamientos, no solo
 * para los destacados.
 */
describe('TRATAMIENTOS_SEED — cobertura multilingüe', () => {
  it('contiene los 67 tratamientos del catálogo oficial de GAPSSA', () => {
    expect(TRATAMIENTOS_SEED).toHaveLength(67)
  })

  it('tiene slugs únicos y estables (no localizados)', () => {
    const slugs = TRATAMIENTOS_SEED.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  for (const tratamiento of TRATAMIENTOS_SEED) {
    describe(tratamiento.slug, () => {
      for (const locale of LOCALES) {
        it(`tiene título, descripción y al menos un beneficio en "${locale}"`, () => {
          const traduccion = tratamiento.porLocale[locale]
          expect(traduccion, `falta el idioma "${locale}" en "${tratamiento.slug}"`).toBeDefined()
          expect(traduccion.titulo.trim()).not.toBe('')
          expect(traduccion.descripcion.trim()).not.toBe('')
          expect(traduccion.beneficios.length).toBeGreaterThan(0)
          for (const beneficio of traduccion.beneficios) {
            expect(beneficio.trim()).not.toBe('')
          }
        })
      }

      it('tiene el mismo número de beneficios en los 6 idiomas', () => {
        const conteos = LOCALES.map((locale) => tratamiento.porLocale[locale].beneficios.length)
        expect(new Set(conteos).size).toBe(1)
      })
    })
  }

  it('el fallback a español no sustituye a una traducción real en ningún idioma no-español para ningún tratamiento', () => {
    const sinTraducirDeVerdad: string[] = []
    for (const tratamiento of TRATAMIENTOS_SEED) {
      const es = tratamiento.porLocale.es
      for (const locale of LOCALES) {
        if (locale === 'es') continue
        const traduccion = tratamiento.porLocale[locale]
        if (traduccion.titulo === es.titulo && traduccion.descripcion === es.descripcion) {
          sinTraducirDeVerdad.push(`${tratamiento.slug} (${locale})`)
        }
      }
    }
    expect(sinTraducirDeVerdad).toEqual([])
  })

  it('caso representativo: "masaje-descontracturante" (no destacado) tiene contenido propio en catalán e inglés', () => {
    const tratamiento = TRATAMIENTOS_SEED.find((t) => t.slug === 'masaje-descontracturante')
    expect(tratamiento).toBeDefined()
    expect(tratamiento!.destacado).not.toBe(true)

    const es = tratamiento!.porLocale.es
    const ca = tratamiento!.porLocale.ca
    const en = tratamiento!.porLocale.en

    expect(ca.titulo).not.toBe(es.titulo)
    expect(ca.descripcion).not.toBe(es.descripcion)
    expect(en.titulo).not.toBe(es.titulo)
    expect(en.descripcion).not.toBe(es.descripcion)
  })
})
