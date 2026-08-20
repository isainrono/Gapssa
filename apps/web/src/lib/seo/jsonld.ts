import type { AjustesGlobale } from '@/payload-types'

const DIA_SEMANA_A_SCHEMA: Record<string, string> = {
  lunes: 'Monday',
  martes: 'Tuesday',
  miercoles: 'Wednesday',
  jueves: 'Thursday',
  viernes: 'Friday',
  sabado: 'Saturday',
  domingo: 'Sunday',
}

type LocalBusinessInput = {
  ajustes: AjustesGlobale
  siteUrl: string
  logoUrl?: string
}

/**
 * `BeautySalon` (subtipo de `LocalBusiness` en schema.org) construido solo
 * con datos confirmados de `ajustes-globales` — nunca precios ni teléfono
 * inventados (`PLAN_DESARROLLO_WEB_PORTAL.md` §16: "no incluir precios
 * inventados, no publicar teléfono o redes vacías"). Cada bloque se omite
 * por completo si falta el dato que lo sustenta, en vez de rellenarlo con
 * cadenas vacías.
 */
export function buildLocalBusinessJsonLd({ ajustes, siteUrl, logoUrl }: LocalBusinessInput): Record<string, unknown> {
  const { direccion, contacto, horario, redesSociales } = ajustes

  const address =
    direccion?.calle && direccion?.ciudad
      ? {
          '@type': 'PostalAddress',
          streetAddress: direccion.calle,
          addressLocality: direccion.ciudad,
          postalCode: direccion.codigoPostal ?? undefined,
          addressCountry: direccion.pais ?? undefined,
        }
      : undefined

  const openingHours = (horario ?? [])
    .filter((dia) => !dia.cerrado && dia.franja)
    .map((dia) => {
      const [opens, closes] = (dia.franja ?? '').split(/[–-]/).map((value) => value.trim())
      const dayOfWeek = DIA_SEMANA_A_SCHEMA[dia.dia]
      if (!opens || !closes || !dayOfWeek) {
        return undefined
      }
      return {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek,
        opens,
        closes,
      }
    })
    .filter((spec): spec is NonNullable<typeof spec> => spec !== undefined)

  const sameAs = (redesSociales ?? []).map((red) => red.url).filter(Boolean)

  return {
    '@context': 'https://schema.org',
    '@type': 'BeautySalon',
    name: ajustes.nombreComercial,
    url: siteUrl,
    image: logoUrl,
    telephone: contacto?.telefono || undefined,
    email: contacto?.correoPublico || undefined,
    address,
    openingHoursSpecification: openingHours.length > 0 ? openingHours : undefined,
    sameAs: sameAs.length > 0 ? sameAs : undefined,
  }
}

export type BreadcrumbItem = {
  name: string
  url: string
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}
