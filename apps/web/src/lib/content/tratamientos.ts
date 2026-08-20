import 'server-only'
import type { Where } from 'payload'

import type { Dictionary } from '@/lib/i18n/dictionary'
import type { Locale } from '@/lib/i18n/locales'
import type { Tratamiento } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

/**
 * Nunca devuelve un importe: `indicadorPrecio` es un enum cerrado sin
 * campo numérico en `Tratamientos.ts` (decisión de arquitectura Fase 2).
 * `'oculto'` devuelve `undefined` — la interfaz debe omitir el precio por
 * completo en ese caso, no mostrar una cadena vacía.
 */
export function precioLabel(indicador: Tratamiento['indicadorPrecio'], dict: Dictionary): string | undefined {
  switch (indicador) {
    case 'consultar':
      return dict.common.consultar
    case 'pendiente':
      return dict.common.precioPendiente
    case 'oculto':
      return undefined
  }
}

type ListarOpciones = {
  familiaSlug?: string
}

export async function getTratamientos(locale: Locale, opciones: ListarOpciones = {}): Promise<Tratamiento[]> {
  const payload = await getPayloadClient()
  const conditions: Where[] = [{ visible: { equals: true } }]
  if (opciones.familiaSlug) {
    conditions.push({ 'familia.slug': { equals: opciones.familiaSlug } })
  }
  const result = await payload.find({
    collection: 'tratamientos',
    locale,
    overrideAccess: false,
    where: { and: conditions },
    sort: 'orden',
    limit: 200,
  })
  return result.docs
}

export async function getTratamientosDestacados(locale: Locale, limit = 3): Promise<Tratamiento[]> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'tratamientos',
    locale,
    overrideAccess: false,
    where: { and: [{ visible: { equals: true } }, { destacado: { equals: true } }] },
    sort: 'orden',
    limit,
  })
  return result.docs
}

export async function getTratamientoPorSlug(locale: Locale, slug: string): Promise<Tratamiento | undefined> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'tratamientos',
    locale,
    overrideAccess: false,
    where: { and: [{ visible: { equals: true } }, { slug: { equals: slug } }] },
    limit: 1,
  })
  return result.docs[0]
}

/** Todos los slugs visibles, en todos los idiomas — para `generateStaticParams`. */
export async function getTodosLosSlugsDeTratamientos(): Promise<string[]> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'tratamientos',
    overrideAccess: false,
    where: { visible: { equals: true } },
    limit: 500,
    select: { slug: true },
  })
  return result.docs.map((doc) => doc.slug)
}
