import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'

import type { Locale } from '../../lib/i18n/locales'
import { sanitizeRedirectTarget } from '../../lib/auth/redirectSafety'
import { findAccountById, type ClientAccountRow } from './repository'
import { getActiveSessionFromCookies, type ActiveSession } from './session'

/**
 * Capa de acceso a datos (DAL) para `/[locale]/mi-cuenta` — patrón oficial
 * de Next.js (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`
 * §"Creating a Data Access Layer"): centraliza la comprobación de sesión
 * en una función memoizada por render (`cache`), para que cualquier página
 * o componente de servidor que la llame dentro del mismo render comparta
 * una sola verificación, y para que no exista una vía de acceso a datos
 * privados que se olvide de comprobar la sesión.
 *
 * Simplificación deliberada: el destino de vuelta tras iniciar sesión es
 * `/{locale}/mi-cuenta` (no la subruta profunda exacta desde la que se
 * redirigió) — capturar la ruta exacta exigiría leer la cabecera de
 * petición desde un Server Component, que Next.js no expone de forma
 * fiable ahí. Aceptable para el alcance de esta fase; revisar si el
 * portal crece con subrutas privadas profundas que merezcan preservarse.
 */

export interface RequireSessionResult {
  session: ActiveSession
  account: ClientAccountRow
}

async function loadSessionAndAccount(): Promise<RequireSessionResult | null> {
  const session = await getActiveSessionFromCookies()
  if (!session) {
    return null
  }
  const account = await findAccountById(session.accountId)
  if (!account) {
    return null
  }
  return { session, account }
}

export const requireSession = cache(async (locale: Locale): Promise<RequireSessionResult> => {
  const result = await loadSessionAndAccount()
  if (!result) {
    redirect(`/${locale}/mi-cuenta/acceder`)
  }
  return result
})

/** Para páginas que quieren comportarse distinto si hay sesión o no, sin forzar la redirección (p. ej. la propia página de login). */
export const getOptionalSession = cache(async (): Promise<RequireSessionResult | null> => {
  return loadSessionAndAccount()
})

/**
 * Construye la URL de login con un `next` saneado — usado por las páginas
 * protegidas para no perder el intento de navegación cuando de verdad se
 * captura (formularios que sí conocen su propia ruta vía props del router).
 */
export function buildLoginUrl(locale: Locale, next: string | null | undefined): string {
  const safeNext = sanitizeRedirectTarget(next, `/${locale}/mi-cuenta`)
  const params = new URLSearchParams({ next: safeNext })
  return `/${locale}/mi-cuenta/acceder?${params.toString()}`
}
