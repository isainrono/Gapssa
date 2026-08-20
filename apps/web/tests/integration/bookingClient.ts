import { inject } from 'vitest'

import { CookieJar } from './authClient'

/** Cliente de pruebas para `/api/booking/v1/*` — mismo mecanismo de CSRF por doble envío que authClient.ts, más soporte opcional para `X-Booking-Access-Token` (invitado sin sesión) y cookies de sesión (cliente autenticado, Fase 4A punto 7). */

function baseUrl(): string {
  return inject('integrationBaseUrl')
}

type JsonRecord = Record<string, unknown>

export type BookingResponse = {
  status: number
  body: JsonRecord
}

async function send(
  jar: CookieJar,
  method: 'GET' | 'POST',
  path: string,
  body?: JsonRecord,
  options: { accessToken?: string } = {},
): Promise<BookingResponse> {
  const csrfToken = jar.get('gapssa_csrf')
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: jar.header(),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...(options.accessToken ? { 'x-booking-access-token': options.accessToken } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  jar.applyResponse(response)
  const responseBody = (await response.json().catch(() => ({}))) as JsonRecord
  return { status: response.status, body: responseBody }
}

export const bookingApi = {
  get: (jar: CookieJar, path: string, options?: { accessToken?: string }) => send(jar, 'GET', path, undefined, options),
  post: (jar: CookieJar, path: string, body?: JsonRecord, options?: { accessToken?: string }) =>
    send(jar, 'POST', path, body, options),
}

export { CookieJar, visitPage, getLatestOtpCodeForEmail, countMailboxMessagesForEmail } from './authClient'
