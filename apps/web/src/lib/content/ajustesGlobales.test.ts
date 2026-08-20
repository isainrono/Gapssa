import { describe, expect, it } from 'vitest'

import type { AjustesGlobale } from '@/payload-types'

import { contactoConfigurado, googleMapsUrl, redesConfiguradas } from './ajustesGlobales'

const BASE: AjustesGlobale = {
  id: 1,
  nombreComercial: 'GAPSSA by Nana',
  updatedAt: '',
  createdAt: '',
}

describe('googleMapsUrl', () => {
  it('devuelve undefined sin calle ni ciudad', () => {
    expect(googleMapsUrl(BASE)).toBeUndefined()
  })

  it('construye una URL de búsqueda con la dirección codificada', () => {
    const url = googleMapsUrl({
      ...BASE,
      direccion: { calle: 'Carrer de Gayarre 24', ciudad: 'Barcelona', codigoPostal: '08014', pais: 'España' },
    })
    expect(url).toContain('https://www.google.com/maps/search/?api=1&query=')
    expect(url).toContain(encodeURIComponent('Carrer de Gayarre 24'))
  })
})

describe('contactoConfigurado', () => {
  it('omite campos vacíos en vez de devolver cadenas vacías', () => {
    expect(contactoConfigurado(BASE)).toEqual({ telefono: undefined, whatsapp: undefined, correoPublico: undefined })
  })

  it('conserva los campos configurados', () => {
    const result = contactoConfigurado({ ...BASE, contacto: { telefono: '600000000' } })
    expect(result.telefono).toBe('600000000')
    expect(result.whatsapp).toBeUndefined()
  })
})

describe('redesConfiguradas', () => {
  it('filtra redes sin URL', () => {
    expect(redesConfiguradas(BASE)).toEqual([])
  })
})
