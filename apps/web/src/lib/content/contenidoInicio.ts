import 'server-only'

import type { Locale } from '@/lib/i18n/locales'
import type { ContenidoInicio } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

export async function getContenidoInicio(locale: Locale): Promise<ContenidoInicio> {
  const payload = await getPayloadClient()
  return payload.findGlobal({
    slug: 'contenido-inicio',
    locale,
    overrideAccess: false,
  })
}
