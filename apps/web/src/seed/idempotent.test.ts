import { describe, expect, it } from 'vitest'

import { shouldCreateDocument, shouldSeedGlobalField } from './idempotent'

describe('shouldCreateDocument', () => {
  it('crea cuando no existe', () => {
    expect(shouldCreateDocument(undefined)).toBe(true)
    expect(shouldCreateDocument(null)).toBe(true)
  })

  it('no crea cuando ya existe, sin force', () => {
    expect(shouldCreateDocument({ id: 1 })).toBe(false)
  })

  it('fuerza la creación con force, exista o no', () => {
    expect(shouldCreateDocument({ id: 1 }, true)).toBe(true)
    expect(shouldCreateDocument(undefined, true)).toBe(true)
  })
})

describe('shouldSeedGlobalField', () => {
  it('rellena un campo vacío o ausente', () => {
    expect(shouldSeedGlobalField(undefined)).toBe(true)
    expect(shouldSeedGlobalField(null)).toBe(true)
    expect(shouldSeedGlobalField('')).toBe(true)
    expect(shouldSeedGlobalField('   ')).toBe(true)
    expect(shouldSeedGlobalField([])).toBe(true)
  })

  it('nunca pisa un campo ya rellenado, sin force', () => {
    expect(shouldSeedGlobalField('GAPSSA by Nana')).toBe(false)
    expect(shouldSeedGlobalField([{ id: 1 }])).toBe(false)
  })

  it('fuerza el relleno con force', () => {
    expect(shouldSeedGlobalField('GAPSSA by Nana', true)).toBe(true)
  })
})
