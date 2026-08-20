import 'server-only'

import type { Locale } from '@/lib/i18n/locales'
import type { FamiliasTratamiento } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

export async function getFamilias(locale: Locale): Promise<FamiliasTratamiento[]> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'familias-tratamiento',
    locale,
    overrideAccess: false,
    where: { visible: { equals: true } },
    sort: 'orden',
    limit: 100,
  })
  return result.docs
}

export async function getFamiliaPorSlug(locale: Locale, slug: string): Promise<FamiliasTratamiento | undefined> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'familias-tratamiento',
    locale,
    overrideAccess: false,
    where: { and: [{ visible: { equals: true } }, { slug: { equals: slug } }] },
    limit: 1,
  })
  return result.docs[0]
}
