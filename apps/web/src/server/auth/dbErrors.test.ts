import { describe, expect, it } from 'vitest'

import { isUniqueViolation } from './dbErrors'

describe('isUniqueViolation', () => {
  it('detects a raw pg error with a top-level code', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('detects a drizzle-orm DrizzleQueryError wrapping the pg error in .cause (inside a transaction)', () => {
    // Reproduce la forma real observada al ejecutar
    // createAccountWithPasswordCredential dentro de authDb.transaction():
    // drizzle-orm mueve el error original (con .code) a error.cause en vez
    // de exponerlo en el nivel superior.
    const wrapped = new Error('Failed query: insert into "client_accounts" ...')
    ;(wrapped as unknown as { cause: unknown }).cause = { code: '23505', constraint: 'client_accounts_email_key' }
    expect(isUniqueViolation(wrapped)).toBe(true)
  })

  it('rejects an unrelated error code', () => {
    expect(isUniqueViolation({ code: '23502' })).toBe(false)
  })

  it('rejects an unrelated error wrapped in .cause', () => {
    const wrapped = new Error('Failed query')
    ;(wrapped as unknown as { cause: unknown }).cause = { code: '23502' }
    expect(isUniqueViolation(wrapped)).toBe(false)
  })

  it('rejects non-object values without throwing', () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation('some string')).toBe(false)
    expect(isUniqueViolation(42)).toBe(false)
  })

  it('rejects a plain Error with no .cause and no .code', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
  })
})
