import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { signBookingRequestAccessToken, signBookingRequestAccessTokenWithVersion, verifyBookingRequestAccessToken } from './accessToken'

/**
 * Pruebas unitarias puras (sin DB) del mecanismo criptográfico versionado
 * — la cobertura de "qué versión queda persistida en una fila real" y "la
 * retirada de una versión vieja se bloquea/permite según
 * countLiveBookingRequestsReferencingAccessTokenVersions" vive en
 * tests/integration/rotation/accessToken.rotation.int.test.ts (necesita
 * Postgres real).
 */
describe('signBookingRequestAccessToken / verifyBookingRequestAccessToken', () => {
  it('verifies a token signed for the same requestId with its own keyVersion', () => {
    const id = randomUUID()
    const { token, keyVersion } = signBookingRequestAccessToken(id)
    expect(verifyBookingRequestAccessToken(id, keyVersion, token)).toBe(true)
  })

  it('rejects a token signed for a different requestId', () => {
    const { token, keyVersion } = signBookingRequestAccessToken(randomUUID())
    expect(verifyBookingRequestAccessToken(randomUUID(), keyVersion, token)).toBe(false)
  })

  it('rejects a tampered token', () => {
    const id = randomUUID()
    const { token, keyVersion } = signBookingRequestAccessToken(id)
    const tampered = `${token.slice(0, -1)}${token.at(-1) === '0' ? '1' : '0'}`
    expect(verifyBookingRequestAccessToken(id, keyVersion, tampered)).toBe(false)
  })

  it('rejects an empty or malformed token without throwing', () => {
    const id = randomUUID()
    const { keyVersion } = signBookingRequestAccessToken(id)
    expect(verifyBookingRequestAccessToken(id, keyVersion, '')).toBe(false)
    expect(verifyBookingRequestAccessToken(id, keyVersion, 'not-hex-!!!')).toBe(false)
  })

  it('rejects a null keyVersion (authenticated-flow row, never issued an access token)', () => {
    const id = randomUUID()
    const { token } = signBookingRequestAccessToken(id)
    expect(verifyBookingRequestAccessToken(id, null, token)).toBe(false)
  })

  it('is deterministic for the same requestId (same active version)', () => {
    const id = randomUUID()
    expect(signBookingRequestAccessToken(id)).toEqual(signBookingRequestAccessToken(id))
  })

  it('signBookingRequestAccessTokenWithVersion reproduces the exact same token as signing with the active version', () => {
    const id = randomUUID()
    const { token, keyVersion } = signBookingRequestAccessToken(id)
    expect(signBookingRequestAccessTokenWithVersion(id, keyVersion)).toBe(token)
  })

  it('signBookingRequestAccessTokenWithVersion throws on a null keyVersion — never signs for an authenticated-flow row', () => {
    const id = randomUUID()
    expect(() => signBookingRequestAccessTokenWithVersion(id, null)).toThrow()
  })

  it('never tries other versions — verifying against a keyVersion that does not match the one the token was signed with fails, even for an existing version', () => {
    // Con un único secreto activo configurado en las pruebas no hay una
    // segunda versión real disponible aquí — este caso (convivencia de
    // dos versiones reales, token de la vieja verificado con la vieja
    // pero rechazado si se pide verificar con la nueva) se cubre con
    // datos reales en accessToken.rotation.int.test.ts.
    const id = randomUUID()
    const { token } = signBookingRequestAccessToken(id)
    expect(() => verifyBookingRequestAccessToken(id, 'version-inexistente-nunca-registrada', token)).toThrow()
  })
})
