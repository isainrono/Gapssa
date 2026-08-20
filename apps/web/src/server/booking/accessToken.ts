import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

import { serverEnv } from '../env'

/**
 * Token de acceso opaco para una solicitud de reserva de INVITADO (sin
 * sesión) — `PLAN_DESARROLLO_WEB_PORTAL.md`/el encargo de Fase 4A piden
 * "consultar el estado opaco de la solicitud" sin exponer un panel ni
 * requerir cuenta. Sin este token, conocer el `id` (UUID) de una solicitud
 * ajena (p. ej. observado en la red, o adivinado) bastaría para consultar
 * su estado o intentar verificarla — igual de sensible que adivinar el
 * `challengeId` de un OTP. `POST /api/booking/v1/requests` devuelve este
 * token una sola vez, en la respuesta 202; el cliente debe reenviarlo
 * (cabecera `X-Booking-Access-Token`) en cualquier petición posterior
 * sobre esa misma solicitud.
 *
 * HMAC-SHA-256(bookingRequestId, secreto) en hex — no un JWT ni un token
 * con estado propio propio: no hace falta revocarlo por separado, expira
 * implícitamente en cuanto la propia solicitud se resuelve (los endpoints
 * dejan de aceptar operaciones sobre una solicitud `resolved`, no el
 * token en sí).
 *
 * Versionado (`BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS`, mismo patrón
 * que `server/crypto/fieldCrypto.ts`/`identityFingerprint.ts`): firmar
 * usa siempre la versión activa; `booking_request_records.accessTokenKeyVersion`
 * guarda, por fila, con qué versión se firmó SU token al crearse — nunca
 * recalculada después. Verificar usa exclusivamente esa versión guardada
 * (nunca "probar todas las del mapa": eso no demostraría qué clave firmó
 * de verdad el token en la mano del invitado, ver incidente de revisión).
 * Retirar una versión del mapa solo es seguro cuando
 * `rotationSafetyChecks.ts::countLiveBookingRequestsReferencingAccessTokenVersions`
 * para esa versión llega a 0.
 */

function getSecretForVersion(keyVersion: string): string {
  const secret = serverEnv.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS[keyVersion]
  if (!secret) {
    // Solo alcanzable si una fila persistida referencia una
    // accessTokenKeyVersion ya retirada del mapa (rotación mal
    // gestionada) — nunca una configuración válida en arranque (la
    // versión activa se comprueba en server/env.ts). Falla explícito,
    // nunca acepta en silencio.
    throw new Error(`No hay secreto de token de acceso registrado para keyVersion="${keyVersion}".`)
  }
  return secret
}

/** Firma con la versión ACTIVA — único caso al crear una solicitud nueva. */
export function signBookingRequestAccessToken(bookingRequestId: string): { token: string; keyVersion: string } {
  const keyVersion = serverEnv.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION
  const token = createHmac('sha256', getSecretForVersion(keyVersion)).update(bookingRequestId).digest('hex')
  return { token, keyVersion }
}

/**
 * Firma con una versión EXPLÍCITA ya conocida (la que una fila existente
 * ya tiene persistida en `accessTokenKeyVersion`) — usado por los caminos
 * de replay idempotente, donde la versión activa pudo cambiar desde que
 * la fila se creó. `keyVersion === null` (fila del flujo autenticado) es
 * un error de programación: nunca debería intentarse firmar un token de
 * acceso para una solicitud que nunca lo tuvo.
 */
export function signBookingRequestAccessTokenWithVersion(bookingRequestId: string, keyVersion: string | null): string {
  if (keyVersion === null) {
    throw new Error(`No se puede firmar un token de acceso para la solicitud ${bookingRequestId}: accessTokenKeyVersion es null (fila del flujo autenticado).`)
  }
  return createHmac('sha256', getSecretForVersion(keyVersion)).update(bookingRequestId).digest('hex')
}

/**
 * Verifica contra la versión EXACTA con la que se firmó el token de esta
 * fila (`keyVersion`, leído por el llamante de `booking_request_records.accessTokenKeyVersion`)
 * — nunca prueba otras versiones. `keyVersion === null` (fila del flujo
 * autenticado, que nunca emite token de acceso) siempre rechaza — no hay
 * ningún token válido posible para esa fila. Comparación en tiempo
 * constante — nunca `===`.
 */
export function verifyBookingRequestAccessToken(bookingRequestId: string, keyVersion: string | null, candidateToken: string): boolean {
  if (keyVersion === null) {
    return false
  }
  const expected = createHmac('sha256', getSecretForVersion(keyVersion)).update(bookingRequestId).digest('hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  const candidateBuffer = Buffer.from(candidateToken, 'hex')

  if (candidateBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, candidateBuffer)
}
