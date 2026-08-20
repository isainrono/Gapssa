import 'server-only'

import type { Locale } from '@/lib/i18n/locales'
import type { AjustesGlobale } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

export async function getAjustesGlobales(locale: Locale): Promise<AjustesGlobale> {
  const payload = await getPayloadClient()
  return payload.findGlobal({
    slug: 'ajustes-globales',
    locale,
    overrideAccess: false,
  })
}

/** `ajustes.contacto` con solo los campos que tienen un valor real — nunca placeholders. */
export function contactoConfigurado(ajustes: AjustesGlobale) {
  const { telefono, whatsapp, correoPublico } = ajustes.contacto ?? {}
  return {
    telefono: telefono || undefined,
    whatsapp: whatsapp || undefined,
    correoPublico: correoPublico || undefined,
  }
}

/** Redes sociales con URL no vacía — la sección Instagram/redes se omite si esto queda vacío. */
export function redesConfiguradas(ajustes: AjustesGlobale) {
  return (ajustes.redesSociales ?? []).filter((red) => Boolean(red.url))
}

/**
 * Enlace de búsqueda de Google Maps construido desde la dirección
 * configurada — nunca un iframe cargado automáticamente
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §9: "no cargar iframe de Google
 * automáticamente"). `undefined` si falta calle o ciudad.
 */
export function googleMapsUrl(ajustes: AjustesGlobale): string | undefined {
  const { calle, ciudad, codigoPostal, pais } = ajustes.direccion ?? {}
  if (!calle || !ciudad) {
    return undefined
  }
  const query = [calle, ciudad, codigoPostal, pais].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
