import 'server-only'

import type { Where } from 'payload'

import type { Locale } from '@/lib/i18n/locales'
import type { Testimonio } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

/**
 * Revisión 2 de Fase 2: las tres condiciones explícitas a la vez, no solo
 * `visible` — `_status: published` ya lo impone `readPublishedOrStaff`
 * (`access/content.ts`) para una lectura anónima como esta
 * (`overrideAccess: false`), pero se repite aquí en vez de depender solo
 * de la capa de acceso: si algún día esta consulta se reutilizara con
 * `overrideAccess: true` por error, seguiría sin devolver un testimonio no
 * autorizado. `autorizacionRegistrada: true` es la comprobación nueva: sin
 * ella, un testimonio de ejemplo (`seed/data/testimonios.ts`) o uno real
 * pendiente de autorización nunca debe llegar a la web pública.
 */
export const TESTIMONIOS_PUBLICOS_WHERE: Where = {
  and: [{ _status: { equals: 'published' } }, { visible: { equals: true } }, { autorizacionRegistrada: { equals: true } }],
}

export async function getTestimonios(locale: Locale): Promise<Testimonio[]> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'testimonios',
    locale,
    overrideAccess: false,
    where: TESTIMONIOS_PUBLICOS_WHERE,
    sort: 'orden',
    limit: 50,
  })
  return result.docs
}
