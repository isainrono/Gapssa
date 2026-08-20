import 'server-only'

import type { Locale } from '@/lib/i18n/locales'
import type { Galeria } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

export async function getGaleria(locale: Locale, limit = 50): Promise<Galeria[]> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'galeria',
    locale,
    overrideAccess: false,
    where: { visible: { equals: true } },
    sort: 'orden',
    limit,
  })
  return result.docs
}
