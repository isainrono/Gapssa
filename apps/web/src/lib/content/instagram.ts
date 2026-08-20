import 'server-only'

import type { Locale } from '@/lib/i18n/locales'
import type { InstagramPost } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

/**
 * Puede devolver un array vacío — es el estado esperado mientras la
 * cuenta de Instagram de Gapssa no esté confirmada
 * (`InstagramPosts.ts`). El componente que la consuma debe omitir toda la
 * sección cuando esto está vacío, nunca mostrar un estado "próximamente"
 * con una URL inventada.
 */
export async function getInstagramPosts(locale: Locale): Promise<InstagramPost[]> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'instagram-posts',
    locale,
    overrideAccess: false,
    where: { visible: { equals: true } },
    sort: 'orden',
    limit: 12,
  })
  return result.docs
}
