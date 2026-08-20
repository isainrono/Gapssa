import 'server-only'
import type { Metadata } from 'next'

import { publicEnv } from '@/lib/env.public'
import type { Dictionary } from '@/lib/i18n/dictionary'
import type { Locale } from '@/lib/i18n/locales'
import { buildLocalizedMetadata } from '@/lib/seo/metadata'
import type { PaginasLegale } from '@/payload-types'

import { type TipoPaginaLegal } from '@/collections/PaginasLegales'

import { getPayloadClient } from './payloadClient'

const TITULO_POR_TIPO: Record<TipoPaginaLegal, (dict: Dictionary) => string> = {
  'aviso-legal': (dict) => dict.footer.legalAvisoLegal,
  privacidad: (dict) => dict.footer.legalPrivacidad,
  cookies: (dict) => dict.footer.legalCookies,
  'condiciones-reserva': (dict) => dict.footer.legalCondicionesReserva,
}

export async function getPaginaLegal(locale: Locale, tipo: TipoPaginaLegal): Promise<PaginasLegale | undefined> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'paginas-legales',
    locale,
    overrideAccess: false,
    where: { tipo: { equals: tipo } },
    limit: 1,
  })
  return result.docs[0]
}

/** Párrafos a partir de líneas en blanco — `contenido` es texto plano, no richText (ver PaginasLegales.ts). */
export function parrafosDe(contenido: string): string[] {
  return contenido
    .split(/\n\s*\n/)
    .map((parrafo) => parrafo.trim())
    .filter(Boolean)
}

/** Título de respaldo (dict.footer.legalXxx) cuando la página todavía no existe en Payload. */
export function tituloLegalPorDefecto(tipo: TipoPaginaLegal, dict: Dictionary): string {
  return TITULO_POR_TIPO[tipo](dict)
}

/**
 * Metadata compartida por las 4 rutas `legal/*`: noindex por defecto
 * mientras la página no exista o no esté `validada`
 * (`PaginasLegales.ts#seoNoIndex`) — nunca se asume indexable a falta de
 * datos.
 */
export async function legalMetadata(locale: Locale, tipo: TipoPaginaLegal, dict: Dictionary): Promise<Metadata> {
  const pagina = await getPaginaLegal(locale, tipo)
  return buildLocalizedMetadata(
    {
      locale,
      path: `legal/${tipo}`,
      title: pagina?.titulo || tituloLegalPorDefecto(tipo, dict),
      noIndex: pagina ? pagina.seoNoIndex : true,
    },
    publicEnv.NEXT_PUBLIC_SITE_URL,
  )
}

/**
 * Tipos de página legal indexables (`seoNoIndex: false`) — usado por
 * `app/sitemap.ts`. `seoNoIndex`/`tipo` no están localizados, así que una
 * sola consulta sin `locale` basta (el valor es el mismo en los 6
 * idiomas).
 */
export async function getTiposPaginaLegalIndexables(): Promise<TipoPaginaLegal[]> {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'paginas-legales',
    overrideAccess: false,
    where: { seoNoIndex: { equals: false } },
    limit: 10,
    select: { tipo: true },
  })
  return result.docs.map((doc) => doc.tipo)
}
