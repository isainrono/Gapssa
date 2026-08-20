import { describe, expect, it } from 'vitest'

import { getDictionary } from '@/lib/i18n/dictionary'

import { precioLabel } from './tratamientos'

describe('precioLabel', () => {
  const dict = getDictionary('es')

  it('devuelve el texto "Consultar" para consultar', () => {
    expect(precioLabel('consultar', dict)).toBe(dict.common.consultar)
  })

  it('devuelve el texto de precio pendiente', () => {
    expect(precioLabel('pendiente', dict)).toBe(dict.common.precioPendiente)
  })

  it('devuelve undefined para oculto — nunca una cadena vacía', () => {
    expect(precioLabel('oculto', dict)).toBeUndefined()
  })
})
