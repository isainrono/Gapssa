import { describe, expect, it } from 'vitest'

import { wouldPublishWithoutAuthorization } from './testimonioAuthorization'

describe('wouldPublishWithoutAuthorization', () => {
  it('bloquea crear un testimonio visible sin autorización', () => {
    expect(wouldPublishWithoutAuthorization({ visible: true, autorizacionRegistrada: false }, undefined)).toBe(true)
  })

  it('bloquea publicarlo (_status published) sin autorización', () => {
    expect(wouldPublishWithoutAuthorization({ _status: 'published', autorizacionRegistrada: false }, undefined)).toBe(true)
  })

  it('permite crearlo como borrador, no visible, sin autorización (el caso de los testimonios de ejemplo del seed)', () => {
    expect(wouldPublishWithoutAuthorization({ _status: 'draft', visible: false, autorizacionRegistrada: false }, undefined)).toBe(false)
  })

  it('permite publicar/hacer visible cuando sí hay autorización', () => {
    expect(wouldPublishWithoutAuthorization({ visible: true, _status: 'published', autorizacionRegistrada: true }, undefined)).toBe(false)
  })

  it('en una actualización parcial, usa el documento original para los campos no incluidos en esta petición', () => {
    const originalDoc = { visible: false, _status: 'draft', autorizacionRegistrada: false }

    // PATCH que solo cambia `orden`: no debe dispararse aunque el doc original no tenga autorización.
    expect(wouldPublishWithoutAuthorization({}, originalDoc)).toBe(false)

    // PATCH que intenta poner visible:true sobre un doc sin autorización: sí debe dispararse.
    expect(wouldPublishWithoutAuthorization({ visible: true }, originalDoc)).toBe(true)
  })

  it('en una actualización parcial, un documento ya autorizado no se bloquea al no tocar ninguno de los tres campos', () => {
    const originalDoc = { visible: true, _status: 'published', autorizacionRegistrada: true }

    expect(wouldPublishWithoutAuthorization({}, originalDoc)).toBe(false)
  })

  it('bloquea si el PATCH intenta quitar la autorización de un testimonio que seguirá visible', () => {
    const originalDoc = { visible: true, _status: 'published', autorizacionRegistrada: true }

    expect(wouldPublishWithoutAuthorization({ autorizacionRegistrada: false }, originalDoc)).toBe(true)
  })

  it('un PATCH que no toca ninguno de los tres campos no se dispara', () => {
    const originalDoc = { visible: false, _status: 'draft', autorizacionRegistrada: false }

    expect(wouldPublishWithoutAuthorization({}, originalDoc)).toBe(false)
  })
})
