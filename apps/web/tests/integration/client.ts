import { inject } from 'vitest'

function baseUrl(): string {
  return inject('integrationBaseUrl')
}

type JsonRecord = Record<string, unknown>

export type ApiResponse = {
  body: JsonRecord
  status: number
}

/**
 * `Authorization: JWT <token>`, no cookies: es uno de los métodos oficiales
 * de extracción de token de Payload (`extractJWT.js`, estrategia `JWT`) y
 * evita reimplementar un cookie-jar solo para estas pruebas.
 */
function authHeader(token?: string): Record<string, string> {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function request(
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST',
  path: string,
  options: { body?: JsonRecord; token?: string } = {},
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(options.token),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const body = (await response.json().catch(() => ({}))) as JsonRecord
  return { body, status: response.status }
}

/**
 * Subida real multipart/form-data — la API REST de Payload para
 * colecciones `upload: true` (`media`) no acepta JSON con el archivo en
 * base64, exige `multipart/form-data` de verdad. Separado de `request()`
 * porque ese helper siempre serializa `body` como JSON.
 */
async function upload(path: string, form: FormData, token?: string): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: authHeader(token),
    body: form,
  })
  const body = (await response.json().catch(() => ({}))) as JsonRecord
  return { body, status: response.status }
}

export const api = {
  get: (path: string, token?: string) => request('GET', path, { token }),
  post: (path: string, body?: JsonRecord, token?: string) => request('POST', path, { body, token }),
  patch: (path: string, body?: JsonRecord, token?: string) => request('PATCH', path, { body, token }),
  delete: (path: string, token?: string) => request('DELETE', path, { token }),
  upload,
}

export async function login(email: string, password: string): Promise<string> {
  const { body, status } = await api.post('/api/users/login', { email, password })
  if (status !== 200 || typeof body.token !== 'string') {
    throw new Error(`Login falló para ${email}: ${status} ${JSON.stringify(body)}`)
  }
  return body.token
}

/**
 * Campos que Payload nunca debe devolver en una respuesta pública o de
 * editor. No incluye `sessions`: es un campo base propio de Payload
 * (`node_modules/payload/dist/auth/baseFields/sessions.js`) con su propio
 * `access.read: ({req, doc}) => req.user?.id === doc?.id` — nunca visible
 * para nadie salvo el propio usuario leyendo su propia ficha (comprobado
 * en ejecución), y su contenido son metadatos de sesión (`id`, fechas),
 * nunca el token en sí. Tratarlo como filtración sería una falsa alarma:
 * ya está tan restringido como `hash`/`salt`, solo que por auto-lectura en
 * vez de estar oculto por completo.
 */
export const FORBIDDEN_RESPONSE_FIELDS = ['salt', 'hash', 'password', 'resetPasswordToken'] as const

export function assertNoSensitiveFields(body: unknown, path: string[] = []): void {
  if (Array.isArray(body)) {
    body.forEach((item, index) => assertNoSensitiveFields(item, [...path, String(index)]))
    return
  }
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body)) {
      if ((FORBIDDEN_RESPONSE_FIELDS as readonly string[]).includes(key)) {
        throw new Error(`Campo sensible "${[...path, key].join('.')}" presente en la respuesta.`)
      }
      assertNoSensitiveFields(value, [...path, key])
    }
  }
}
