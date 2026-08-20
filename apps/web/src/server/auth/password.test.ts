import { describe, expect, it } from 'vitest'

import { getDecoyPasswordHash, hashPassword, isPasswordStrongEnough, verifyPassword } from './password'

describe('hashPassword / verifyPassword', () => {
  it('hashes a password and verifies the same plaintext against it', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-42')
    expect(hash).not.toContain('Correct-Horse-Battery-42')
    await expect(verifyPassword('Correct-Horse-Battery-42', hash)).resolves.toBe(true)
  })

  it('rejects an incorrect plaintext', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-42')
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('Correct-Horse-Battery-42')
    const b = await hashPassword('Correct-Horse-Battery-42')
    expect(a).not.toBe(b)
  })

  it('verifyPassword returns false (never throws) for a malformed stored hash', async () => {
    await expect(verifyPassword('anything', 'not-a-real-argon2-hash')).resolves.toBe(false)
  })
})

describe('getDecoyPasswordHash', () => {
  it('returns a stable, cached hash across calls', async () => {
    const a = await getDecoyPasswordHash()
    const b = await getDecoyPasswordHash()
    expect(a).toBe(b)
  })

  it('is a real, verifiable Argon2 hash', async () => {
    const decoy = await getDecoyPasswordHash()
    await expect(verifyPassword('decoy-password-never-used-for-a-real-account', decoy)).resolves.toBe(true)
  })
})

describe('isPasswordStrongEnough', () => {
  it('rejects passwords shorter than the minimum length', () => {
    expect(isPasswordStrongEnough('Ab1!Ab1!Ab1')).toBe(false) // 11 chars
  })

  it('rejects a long password missing a digit', () => {
    expect(isPasswordStrongEnough('Abcdefghijkl!')).toBe(false)
  })

  it('rejects a long password missing a symbol', () => {
    expect(isPasswordStrongEnough('Abcdefghijkl1')).toBe(false)
  })

  it('rejects a long password missing a letter', () => {
    expect(isPasswordStrongEnough('123456789012!')).toBe(false)
  })

  it('accepts a password meeting length + letter + digit + symbol', () => {
    expect(isPasswordStrongEnough('Correct-Horse-Battery-42')).toBe(true)
  })
})
