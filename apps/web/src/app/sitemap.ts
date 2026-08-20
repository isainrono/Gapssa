import type { MetadataRoute } from 'next'

import { getTiposPaginaLegalIndexables } from '@/lib/content/legal'
import { getTodosLosSlugsDeTratamientos } from '@/lib/content/tratamientos'
import { publicEnv } from '@/lib/env.public'
import { LOCALES } from '@/lib/i18n/locales'
import { buildLocalizedUrl } from '@/lib/seo/metadata'

/**
 * `mi-cuenta` nunca aparece aquí (ruta privada, siempre noindex —
 * `PLAN_DESARROLLO_WEB_PORTAL.md` §16). Las 4 páginas legales solo se
 * incluyen si `seoNoIndex` es `false` en Payload — mientras estén
 * "provisional" (el estado por defecto), quedan fuera.
 */
const RUTAS_ESTATICAS = ['', 'tratamientos', 'sobre-gapssa', 'contacto', 'reservar']

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = publicEnv.NEXT_PUBLIC_SITE_URL
  const [slugsTratamientos, tiposLegalIndexables] = await Promise.all([
    getTodosLosSlugsDeTratamientos(),
    getTiposPaginaLegalIndexables(),
  ])

  const paths = [
    ...RUTAS_ESTATICAS,
    ...slugsTratamientos.map((slug) => `tratamientos/${slug}`),
    ...tiposLegalIndexables.map((tipo) => `legal/${tipo}`),
  ]

  return paths.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: buildLocalizedUrl(siteUrl, locale, path),
      lastModified: new Date(),
    })),
  )
}
