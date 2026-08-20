import { inject } from 'vitest'

/**
 * Cliente de pruebas para `/api/auth/*` y páginas de `/mi-cuenta` — a
 * diferencia de `client.ts` (autenticación de Payload por cabecera
 * `Authorization: JWT`), la autenticación del portal es por cookies
 * (`gapssa_session`, `gapssa_csrf`). `fetch` de Node no persiste cookies
 * entre peticiones como un navegador: este jar mínimo lo hace a mano,
 * suficiente para las pruebas (no soporta `Domain`/`Path` reales, solo
 * nombre=valor, que es todo lo que este proyecto necesita en local).
 */

function baseUrl(): string {
  return inject('integrationBaseUrl')
}

export class CookieJar {
  private readonly cookies = new Map<string, string>()

  applyResponse(response: Response): void {
    const setCookieHeaders = response.headers.getSetCookie?.() ?? []
    for (const header of setCookieHeaders) {
      const [pair] = header.split(';')
      const separatorIndex = pair?.indexOf('=') ?? -1
      if (!pair || separatorIndex < 0) continue
      const name = pair.slice(0, separatorIndex).trim()
      const value = pair.slice(separatorIndex + 1).trim()
      this.cookies.set(name, value)
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)
  }

  clear(name: string): void {
    this.cookies.delete(name)
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }
}

type JsonRecord = Record<string, unknown>

export type AuthResponse = {
  status: number
  body: JsonRecord
}

/** GET de una página cualquiera del portal — como visitar el sitio en un navegador, planta la cookie CSRF vía proxy.ts. */
export async function visitPage(jar: CookieJar, path: string): Promise<void> {
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: { Cookie: jar.header() },
    redirect: 'manual',
  })
  jar.applyResponse(response)
}

async function send(
  jar: CookieJar,
  method: 'DELETE' | 'GET' | 'POST',
  path: string,
  body?: JsonRecord,
  options: { omitCsrf?: boolean } = {},
): Promise<AuthResponse> {
  const csrfToken = jar.get('gapssa_csrf')
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: jar.header(),
      ...(options.omitCsrf || !csrfToken ? {} : { 'x-csrf-token': csrfToken }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  jar.applyResponse(response)
  const responseBody = (await response.json().catch(() => ({}))) as JsonRecord
  return { status: response.status, body: responseBody }
}

export const authApi = {
  get: (jar: CookieJar, path: string) => send(jar, 'GET', path),
  post: (jar: CookieJar, path: string, body?: JsonRecord, options?: { omitCsrf?: boolean }) =>
    send(jar, 'POST', path, body, options),
  delete: (jar: CookieJar, path: string) => send(jar, 'DELETE', path),
}

interface MailboxMessage {
  to: string
  subject: string
  text: string
  receivedAt: string
}

async function readMailboxMessages(email: string): Promise<MailboxMessage[]> {
  const port = inject('integrationMailboxHttpPort')
  const response = await fetch(`http://127.0.0.1:${port}/messages?to=${encodeURIComponent(email.toLowerCase())}`)
  if (!response.ok) return []
  return (await response.json()) as MailboxMessage[]
}

/**
 * Último código OTP entregado a `email` a través del buzón SMTP efímero de
 * pruebas (`mailbox.ts`) — el canal de entrega real, nunca la base de
 * datos ni un log de auditoría, que nunca contienen el código en claro por
 * diseño. "Último" importa: un flujo puede reemitir un código
 * (`otpService.requestOtp` invalida el anterior).
 */
export async function getLatestOtpCodeForEmail(email: string): Promise<string | null> {
  const messages = await readMailboxMessages(email)
  const latest = messages[messages.length - 1]
  if (!latest) return null
  const match = latest.text.match(/(\d{4,12})/)
  return match?.[1] ?? null
}

/** Cuántos correos ha recibido `email` en total durante la ejecución — usado para probar que un reintento del outbox nunca envía MÁS de un correo por intento realmente ganado (revisión 2 de Fase 4A, punto 3). */
export async function countMailboxMessagesForEmail(email: string): Promise<number> {
  const messages = await readMailboxMessages(email)
  return messages.length
}
