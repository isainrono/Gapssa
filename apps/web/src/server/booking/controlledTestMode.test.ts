import { describe, expect, it, beforeEach, vi } from 'vitest'

/**
 * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas: pruebas
 * unitarias puras de `resolveControlledTestGcsExclusion()`/
 * `controlledTestRunIdSuffix()`, decidiendo exclusivamente a partir de un
 * `serverEnv` mockeado (`env.ts` ya garantiza, por validación de arranque,
 * que la combinación real siempre es segura — ver `env.test.ts`; aquí solo
 * se prueba que esta función LEE ese valor y nada más).
 */

vi.mock('server-only', () => ({}))

const mockedServerEnv: { ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: boolean; ESPOCRM_CONTROLLED_TEST_RUN_ID?: string } = {
  ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: false,
  ESPOCRM_CONTROLLED_TEST_RUN_ID: undefined,
}
vi.mock('../env', () => ({ serverEnv: mockedServerEnv }))

const { resolveControlledTestGcsExclusion } = await import('./controlledTestMode')

beforeEach(() => {
  mockedServerEnv.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS = false
  mockedServerEnv.ESPOCRM_CONTROLLED_TEST_RUN_ID = undefined
})

describe('resolveControlledTestGcsExclusion', () => {
  it('devuelve undefined cuando el modo está ausente/false — operación normal, sin regresión', () => {
    expect(resolveControlledTestGcsExclusion()).toBeUndefined()
  })

  it('devuelve exactamente true cuando serverEnv.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS es true', () => {
    mockedServerEnv.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS = true
    expect(resolveControlledTestGcsExclusion()).toBe(true)
  })

  it('nunca devuelve false explícito — solo true o undefined (el llamante nunca envía false derivado de esto)', () => {
    mockedServerEnv.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS = false
    expect(resolveControlledTestGcsExclusion()).not.toBe(false)
  })
})
