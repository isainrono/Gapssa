import { describe, expect, it } from 'vitest'

import type { AjustesGlobale } from '@/payload-types'

import { buildBreadcrumbJsonLd, buildLocalBusinessJsonLd } from './jsonld'

const AJUSTES_MINIMOS: AjustesGlobale = {
  id: 1,
  nombreComercial: 'GAPSSA by Nana',
  updatedAt: '',
  createdAt: '',
}

const AJUSTES_COMPLETOS: AjustesGlobale = {
  id: 1,
  nombreComercial: 'GAPSSA by Nana',
  direccion: {
    calle: 'Carrer de Gayarre 24',
    ciudad: 'Barcelona',
    codigoPostal: '08014',
    pais: 'España',
  },
  contacto: {
    telefono: '600000000',
    correoPublico: 'hola@gapssa.es',
  },
  horario: [
    { dia: 'lunes', cerrado: false, franja: '09:00–21:00' },
    { dia: 'domingo', cerrado: true, franja: null },
  ],
  redesSociales: [{ plataforma: 'instagram', url: 'https://instagram.com/gapssa_bynana' }],
  updatedAt: '',
  createdAt: '',
}

describe('buildLocalBusinessJsonLd', () => {
  it('omite dirección, horario y redes cuando no hay datos confirmados', () => {
    const jsonld = buildLocalBusinessJsonLd({ ajustes: AJUSTES_MINIMOS, siteUrl: 'https://gapssa.es' })
    expect(jsonld['@type']).toBe('BeautySalon')
    expect(jsonld.address).toBeUndefined()
    expect(jsonld.telephone).toBeUndefined()
    expect(jsonld.openingHoursSpecification).toBeUndefined()
    expect(jsonld.sameAs).toBeUndefined()
  })

  it('incluye dirección, horario abierto y redes cuando están configurados', () => {
    const jsonld = buildLocalBusinessJsonLd({ ajustes: AJUSTES_COMPLETOS, siteUrl: 'https://gapssa.es' })
    expect(jsonld.address).toMatchObject({
      streetAddress: 'Carrer de Gayarre 24',
      addressLocality: 'Barcelona',
    })
    expect(jsonld.telephone).toBe('600000000')
    const opening = jsonld.openingHoursSpecification as unknown[]
    expect(opening).toHaveLength(1)
    expect(opening[0]).toMatchObject({ dayOfWeek: 'Monday', opens: '09:00', closes: '21:00' })
    expect(jsonld.sameAs).toEqual(['https://instagram.com/gapssa_bynana'])
  })

  it('nunca incluye un campo de precio', () => {
    const jsonld = buildLocalBusinessJsonLd({ ajustes: AJUSTES_COMPLETOS, siteUrl: 'https://gapssa.es' })
    expect(jsonld).not.toHaveProperty('priceRange')
  })
})

describe('buildBreadcrumbJsonLd', () => {
  it('construye una BreadcrumbList con posiciones 1-indexadas', () => {
    const jsonld = buildBreadcrumbJsonLd([
      { name: 'Inicio', url: 'https://gapssa.es/es' },
      { name: 'Tratamientos', url: 'https://gapssa.es/es/tratamientos' },
    ])
    expect(jsonld['@type']).toBe('BreadcrumbList')
    const items = jsonld.itemListElement as { position: number }[]
    expect(items.map((item) => item.position)).toEqual([1, 2])
  })
})
