import { describe, expect, it } from 'vitest'

import { TESTIMONIOS_PUBLICOS_WHERE } from './testimonios'

describe('TESTIMONIOS_PUBLICOS_WHERE', () => {
  it('exige _status publicado, visible y autorizacionRegistrada simultáneamente', () => {
    expect(TESTIMONIOS_PUBLICOS_WHERE).toEqual({
      and: [{ _status: { equals: 'published' } }, { visible: { equals: true } }, { autorizacionRegistrada: { equals: true } }],
    })
  })
})
