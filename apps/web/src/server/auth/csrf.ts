import 'server-only'
import { cookies } from 'next/headers'

import { constantTimeEqual } from '@gapssa/contracts'

import { CSRF_COOKIE_NAME } from '../../lib/auth/cookieNames'

/**
 * Protección CSRF por "doble envío" (double-submit cookie): el token vive
 * en una cookie legible por JavaScript (`CSRF_COOKIE_NAME`, no `HttpOnly`)
 * y debe repetirse en la cabecera `x-csrf-token` de cualquier petición que
 * mute estado. Un atacante que fuerza una petición cross-site no puede
 * leer la cookie del usuario (misma política de origen del navegador),
 * así que no puede reproducir el valor en la cabecera aunque el navegador
 * adjunte la cookie de sesión automáticamente.
 *
 * Complementa, no sustituye, `SameSite=Lax` en la cookie de sesión
 * (`session.ts`): `Lax` ya bloquea el envío de la cookie de sesión en la
 * mayoría de peticiones cross-site que mutan estado, pero algunas
 * peticiones "simples" cross-site (formularios `GET` no cuentan; ciertos
 * `POST` sin cabeceras personalizadas sí podrían colarse según el
 * navegador) siguen mereciendo esta segunda capa — defensa en profundidad
 * explícitamente pedida por el alcance de esta fase.
 */

const HEADER_NAME = 'x-csrf-token'

export async function verifyCsrfToken(request: Request): Promise<boolean> {
  const cookieStore = await cookies()
  const cookieToken = cookieStore.get(CSRF_COOKIE_NAME)?.value
  const headerToken = request.headers.get(HEADER_NAME)

  if (!cookieToken || !headerToken) {
    return false
  }

  return constantTimeEqual(cookieToken, headerToken)
}
