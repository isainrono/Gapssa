import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { CSRF_COOKIE_NAME } from '@/lib/auth/cookieNames'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'

/**
 * Fase 1: solo redirige la raíz ("/") al idioma principal. No hay
 * detección de idioma del navegador ni negociación de Accept-Language
 * todavía — eso, junto con el resto de páginas públicas, es Fase 2
 * (PLAN_DESARROLLO_WEB_PORTAL.md §17, Fase 2). El matcher excluye
 * `/admin`, `/api` (incluida la API de Payload) y los assets estáticos:
 * ninguna de esas rutas lleva prefijo de idioma.
 *
 * Fase 3: emite la cookie CSRF de doble envío
 * (`server/auth/csrf.ts`) si todavía no existe, en cualquier visita de
 * página — no solo al iniciar sesión. Los formularios de `/mi-cuenta`
 * (registro, login, recuperación) se envían antes de que exista una
 * sesión, así que el token no puede depender de `createSession()`; el
 * propio login sigue regenerándolo para rotarlo tras autenticar.
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    const response = NextResponse.redirect(new URL(`/${DEFAULT_LOCALE}`, request.url))
    ensureCsrfCookie(request, response)
    return response
  }

  const response = NextResponse.next()
  ensureCsrfCookie(request, response)
  return response
}

function ensureCsrfCookie(request: NextRequest, response: NextResponse): void {
  if (request.cookies.get(CSRF_COOKIE_NAME)?.value) {
    return
  }

  response.cookies.set(CSRF_COOKIE_NAME, randomBytes(32).toString('base64url'), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export const config = {
  matcher: ['/((?!admin|api|_next/static|_next/image|favicon.ico).*)'],
}
