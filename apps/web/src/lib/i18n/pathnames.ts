import { isLocale, LOCALES, type Locale } from './locales'

/**
 * Sustituye el segmento de locale de una ruta por otro, preservando el
 * resto del path — el selector de idioma no necesita más lógica que esto
 * porque los slugs se mantienen estables entre idiomas
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6). Función pura, sin `usePathname()`,
 * para poder probarla sin DOM — el componente cliente
 * (`components/client/LanguageSwitcher.tsx`) es solo un envoltorio fino.
 */
export function swapLocaleInPath(pathname: string, targetLocale: Locale): string {
  const segments = pathname.split('/')
  // segments[0] es '' (la ruta empieza por "/"); segments[1] es el locale.
  if (segments.length > 1 && isLocale(segments[1] ?? '')) {
    segments[1] = targetLocale
    return segments.join('/') || `/${targetLocale}`
  }
  return `/${targetLocale}`
}

export function otherLocales(current: Locale): Locale[] {
  return LOCALES.filter((locale) => locale !== current)
}
