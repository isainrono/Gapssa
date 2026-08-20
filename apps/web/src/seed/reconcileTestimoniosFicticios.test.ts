import { describe, expect, it } from 'vitest'

import { TESTIMONIOS_SEED } from './data/testimonios'
import {
  computeTestimonioFicticioCorrection,
  esTestimonioFicticioSembrado,
  TESTIMONIO_FICTICIO_ESTADO_SEGURO,
} from './reconcileTestimoniosFicticios'

describe('esTestimonioFicticioSembrado', () => {
  it('reconoce los 4 testimonios de TESTIMONIOS_SEED por autor + texto exactos', () => {
    for (const testimonio of TESTIMONIOS_SEED) {
      expect(
        esTestimonioFicticioSembrado({ autor: testimonio.autorPorLocale.es, texto: testimonio.textoPorLocale.es }),
      ).toBe(true)
    }
  })

  it('no reconoce un testimonio real que comparte el nombre pero tiene un texto distinto', () => {
    const nombreDelSeed = TESTIMONIOS_SEED[0]!.autorPorLocale.es // "María G."
    expect(
      esTestimonioFicticioSembrado({
        autor: nombreDelSeed,
        texto: 'Reseña real y distinta escrita por otra clienta que también se llama así.',
      }),
    ).toBe(false)
  })

  it('no reconoce un testimonio real con texto parecido pero autor distinto', () => {
    const textoDelSeed = TESTIMONIOS_SEED[0]!.textoPorLocale.es
    expect(esTestimonioFicticioSembrado({ autor: 'Otra Clienta R.', texto: textoDelSeed })).toBe(false)
  })

  it('no revienta ni da falso positivo con autor/texto ausentes', () => {
    expect(esTestimonioFicticioSembrado({ autor: null, texto: null })).toBe(false)
    expect(esTestimonioFicticioSembrado({ autor: undefined, texto: undefined })).toBe(false)
    expect(esTestimonioFicticioSembrado({ autor: 'María G.', texto: null })).toBe(false)
    expect(esTestimonioFicticioSembrado({ autor: '', texto: '' })).toBe(false)
  })
})

describe('computeTestimonioFicticioCorrection', () => {
  it('corrige el estado histórico problemático: publicado, visible, sin autorización', () => {
    expect(computeTestimonioFicticioCorrection({ visible: true, autorizacionRegistrada: false, _status: 'published' })).toEqual(
      TESTIMONIO_FICTICIO_ESTADO_SEGURO,
    )
  })

  it('corrige también si solo una de las tres condiciones es insegura', () => {
    expect(computeTestimonioFicticioCorrection({ visible: true, autorizacionRegistrada: false, _status: 'draft' })).toEqual(
      TESTIMONIO_FICTICIO_ESTADO_SEGURO,
    )
    expect(computeTestimonioFicticioCorrection({ visible: false, autorizacionRegistrada: false, _status: 'published' })).toEqual(
      TESTIMONIO_FICTICIO_ESTADO_SEGURO,
    )
  })

  it('es idempotente: un documento ya en el estado seguro no genera ninguna corrección', () => {
    expect(
      computeTestimonioFicticioCorrection({ visible: false, autorizacionRegistrada: false, _status: 'draft' }),
    ).toBeNull()
  })

  it('trata un autorizacionRegistrada:true residual como inseguro y lo vuelve a poner a false (nunca deja un ficticio con autorización)', () => {
    expect(computeTestimonioFicticioCorrection({ visible: false, autorizacionRegistrada: true, _status: 'draft' })).toEqual(
      TESTIMONIO_FICTICIO_ESTADO_SEGURO,
    )
  })
})
