import type { MetadataRoute } from 'next'

import { publicEnv } from '@/lib/env.public'
import { serverEnv } from '@/server/env'

/**
 * `SITE_NOINDEX=true` bloquea el sitio entero — mecanismo de bloqueo
 * global para staging/desarrollo (`PLAN_DESARROLLO_WEB_PORTAL.md` §16),
 * más fiable que depender de que cada página añada su propio
 * `<meta name="robots">`: un rastreador que respeta `robots.txt` ni
 * siquiera llega a pedir las páginas. `/mi-cuenta` y `/admin`/`/api`
 * quedan bloqueados siempre, indistintamente de esa variable.
 */
export default function robots(): MetadataRoute.Robots {
  if (serverEnv.SITE_NOINDEX) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    }
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/*/mi-cuenta'],
    },
    sitemap: `${publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')}/sitemap.xml`,
  }
}
