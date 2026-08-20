import { describe, expect, it } from 'vitest'

import { parsePayloadEnv, PayloadEnvError } from './payload.env'

const validEnv = {
  PAYLOAD_SECRET: 'a'.repeat(32),
  DATABASE_URL_CMS: 'postgresql://user:pass@localhost:5433/gapssa_cms',
}

describe('parsePayloadEnv', () => {
  it('accepts a valid configuration', () => {
    const result = parsePayloadEnv(validEnv)
    expect(result).toEqual(validEnv)
  })

  it('rejects a missing PAYLOAD_SECRET instead of falling back to an empty string', () => {
    const { PAYLOAD_SECRET: _omit, ...rest } = validEnv
    expect(() => parsePayloadEnv(rest)).toThrow(PayloadEnvError)
  })

  it('rejects a PAYLOAD_SECRET shorter than 32 characters', () => {
    expect(() => parsePayloadEnv({ ...validEnv, PAYLOAD_SECRET: 'too-short' })).toThrow(PayloadEnvError)
  })

  it('rejects a missing DATABASE_URL_CMS instead of falling back to an empty string', () => {
    const { DATABASE_URL_CMS: _omit, ...rest } = validEnv
    expect(() => parsePayloadEnv(rest)).toThrow(PayloadEnvError)
  })

  it('rejects a DATABASE_URL_CMS that is not a valid URL', () => {
    expect(() => parsePayloadEnv({ ...validEnv, DATABASE_URL_CMS: 'not-a-url' })).toThrow(PayloadEnvError)
  })

  it('never echoes the actual secret value in the error message', () => {
    const secret = 'super-secret-value-that-must-not-leak-anywhere'
    try {
      parsePayloadEnv({ ...validEnv, PAYLOAD_SECRET: secret.slice(0, 10) })
      throw new Error('expected parsePayloadEnv to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadEnvError)
      expect((error as Error).message).not.toContain(secret)
    }
  })
})
