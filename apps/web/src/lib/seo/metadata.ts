import type { Metadata } from 'next'

import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/lib/i18n/locales'

const OG_LOCALE_BY_LOCALE: Record<Locale, string> = {
  es: 'es_ES',
  ca: 'ca_ES',
  en: 'en_US',
  it: 'it_IT',
  fr: 'fr_FR',
  pt: 'pt_PT',
}

/**
 * Construye la URL absoluta de una página localizada. `path` no lleva
 * locale ni barra inicial (ej. `''` para portada, `'tratamientos'`,
 * `'tratamientos/masaje-relajante'`) — el mismo `path` sirve para
 * construir el resto de idiomas y el hreflang, porque los slugs se
 * mantienen estables entre idiomas (`PLAN_DESARROLLO_WEB_PORTAL.md` §6).
 * Reutilizado también por `app/sitemap.ts`.
 */
export function buildLocalizedUrl(siteUrl: string, locale: Locale, path: string): string {
  const base = siteUrl.replace(/\/+$/, '')
  const cleanPath = path.replace(/^\/+/, '')
  return cleanPath ? `${base}/${locale}/${cleanPath}` : `${base}/${locale}`
}

export type LocalizedMetadataInput = {
  locale: Locale
  path: string
  title: string
  description?: string
  ogImage?: string
  noIndex?: boolean
}

/**
 * Metadata multilingüe: canonical + hreflang de los 6 idiomas + x-default
 * + Open Graph. Función pura (recibe `siteUrl` en vez de leer
 * `NEXT_PUBLIC_SITE_URL` ella misma) para poder probarla sin mockear
 * variables de entorno — las páginas le pasan `publicEnv.NEXT_PUBLIC_SITE_URL`.
 */
export function buildLocalizedMetadata(input: LocalizedMetadataInput, siteUrl: string): Metadata {
  const { locale, path, title, description, ogImage, noIndex } = input
  const canonical = buildLocalizedUrl(siteUrl, locale, path)

  const languages: Record<string, string> = {}
  for (const loc of LOCALES) {
    languages[loc] = buildLocalizedUrl(siteUrl, loc, path)
  }
  languages['x-default'] = buildLocalizedUrl(siteUrl, DEFAULT_LOCALE, path)

  return {
    title,
    description,
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'GAPSSA by Nana',
      locale: OG_LOCALE_BY_LOCALE[locale],
      type: 'website',
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
    robots: noIndex ? 'noindex, nofollow' : undefined,
  }
}
