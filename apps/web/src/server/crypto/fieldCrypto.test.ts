import { describe, expect, it } from 'vitest'

import { decryptField, encryptField, FieldCryptoError } from './fieldCrypto'

describe('encryptField / decryptField', () => {
  it('encrypts a plaintext and decrypts it back to the same value', () => {
    const field = encryptField('Juana Ejemplo')
    expect(field.ciphertext).not.toContain('Juana Ejemplo')
    expect(decryptField(field)).toBe('Juana Ejemplo')
  })

  it('produces a different nonce/ciphertext each time (never reuses a nonce)', () => {
    const a = encryptField('same-plaintext@example.test')
    const b = encryptField('same-plaintext@example.test')
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('tags the encrypted field with the active key version', () => {
    const field = encryptField('+34 600 000 000')
    expect(field.keyVersion).toBe('v1')
  })

  it('rejects a ciphertext tampered after encryption (authentication tag fails)', () => {
    const field = encryptField('sensitive-value')
    const tamperedBytes = Buffer.from(field.ciphertext, 'base64')
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 0xff
    const tampered = { ...field, ciphertext: tamperedBytes.toString('base64') }

    expect(() => decryptField(tampered)).toThrow(FieldCryptoError)
  })

  it('rejects a nonce swapped for a different valid nonce (authentication tag fails)', () => {
    const a = encryptField('value-a')
    const b = encryptField('value-b')
    const swapped = { ...a, nonce: b.nonce }

    expect(() => decryptField(swapped)).toThrow(FieldCryptoError)
  })

  it('rejects an unknown keyVersion with a clear error, never a raw node:crypto exception', () => {
    const field = encryptField('value')
    const withUnknownVersion = { ...field, keyVersion: 'v999-never-registered' }

    expect(() => decryptField(withUnknownVersion)).toThrow(FieldCryptoError)
  })

  it('rejects a malformed EncryptedField (ciphertext too short to contain an auth tag)', () => {
    const field = encryptField('value')
    const malformed = { ...field, ciphertext: Buffer.from('short').toString('base64') }

    expect(() => decryptField(malformed)).toThrow(FieldCryptoError)
  })

  it('round-trips empty strings and unicode content', () => {
    expect(decryptField(encryptField(''))).toBe('')
    expect(decryptField(encryptField('Ñoño García 你好 🎉'))).toBe('Ñoño García 你好 🎉')
  })
})
