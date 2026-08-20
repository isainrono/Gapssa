'use client'

import { CSRF_COOKIE_NAME } from './cookieNames'

/**
 * `fetch` para las rutas de `/api/auth/*` — añade el token CSRF de doble
 * envío (`server/auth/csrf.ts`) como cabecera `x-csrf-token`, leído de la
 * cookie no `HttpOnly` que planta `proxy.ts` en cualquier visita de
 * página. Toda mutación (`POST`/`DELETE`) hacia `/api/auth/*` debe pasar
 * por aquí, nunca por un `fetch` directo sin esta cabecera.
 */
function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export interface AuthApiError {
  code: string
  message: string
}

export type AuthApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: AuthApiError }

export async function authFetch<T = unknown>(input: string, init?: RequestInit): Promise<AuthApiResult<T>> {
  const csrfToken = readCookie(CSRF_COOKIE_NAME) ?? ''

  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
      ...(init?.headers ?? {}),
    },
    credentials: 'same-origin',
  })

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const errorBody = body as { error?: AuthApiError } | null
    return {
      ok: false,
      status: response.status,
      error: errorBody?.error ?? { code: 'unknown_error', message: 'Ha ocurrido un error inesperado.' },
    }
  }

  return { ok: true, data: body as T }
}
