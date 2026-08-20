import 'server-only'

import type { Locale } from '@/lib/i18n/locales'
import type { ContenidoSobreGapssa } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

export async function getContenidoSobreGapssa(locale: Locale): Promise<ContenidoSobreGapssa> {
  const payload = await getPayloadClient()
  return payload.findGlobal({
    slug: 'contenido-sobre-gapssa',
    locale,
    overrideAccess: false,
  })
}
