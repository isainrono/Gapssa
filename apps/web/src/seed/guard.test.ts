import { describe, expect, it } from 'vitest'

import { assertSeedAllowedInEnv, SeedProductionGuardError } from './guard'

describe('assertSeedAllowedInEnv', () => {
  it('lanza en producción', () => {
    expect(() => assertSeedAllowedInEnv('production')).toThrow(SeedProductionGuardError)
  })

  it('permite development, test, y ausente', () => {
    expect(() => assertSeedAllowedInEnv('development')).not.toThrow()
    expect(() => assertSeedAllowedInEnv('test')).not.toThrow()
    expect(() => assertSeedAllowedInEnv(undefined)).not.toThrow()
  })
})
