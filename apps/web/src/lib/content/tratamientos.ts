import 'server-only'
import type { Where } from 'payload'

import type { Dictionary } from '@/lib/i18n/dictionary'
import type { Locale } from '@/lib/i18n/locales'
import type { Tratamiento } from '@/payload-types'

import { getPayloadClient } from './payloadClient'

export interface TarifaTratamiento {
  precio: string
  duracion: string
  precioNumero?: number
  duracionMinutos?: number
}

export const TARIFAS_OFICIALES_POR_SLUG: Record<string, TarifaTratamiento> = {
  // Faciales
  'hidratacion-luz-led': { precio: '40 €', duracion: '30 min', precioNumero: 40, duracionMinutos: 30 },
  'limpieza-radiofrecuencia': { precio: '85 €', duracion: '60 min', precioNumero: 85, duracionMinutos: 60 },
  'limpieza-basica': { precio: '62 €', duracion: '45 min', precioNumero: 62, duracionMinutos: 45 },
  'limpieza-facial-basica': { precio: '62 €', duracion: '45 min', precioNumero: 62, duracionMinutos: 45 },
  'limpieza-profunda': { precio: '72 €', duracion: '60 min', precioNumero: 72, duracionMinutos: 60 },
  'limpieza-facial-profunda': { precio: '72 €', duracion: '60 min', precioNumero: 72, duracionMinutos: 60 },
  'limpieza-laser-carbono': { precio: '185 €', duracion: '90 min', precioNumero: 185, duracionMinutos: 90 },
  'mesoterapia-facial': { precio: '45 €', duracion: '45 min', precioNumero: 45, duracionMinutos: 45 },
  'mesoterapia-estetica': { precio: '45 €', duracion: '45 min', precioNumero: 45, duracionMinutos: 45 },
  'microneedling-facial': { precio: '120 €', duracion: '60 min', precioNumero: 120, duracionMinutos: 60 },
  'microneedling': { precio: '120 €', duracion: '60 min', precioNumero: 120, duracionMinutos: 60 },
  'dermapen': { precio: '95 €', duracion: '60 min', precioNumero: 95, duracionMinutos: 60 },
  'radiofrecuencia-facial': { precio: '55 €', duracion: '45 min', precioNumero: 55, duracionMinutos: 45 },
  'peeling-prx': { precio: '100 €', duracion: '45 min', precioNumero: 100, duracionMinutos: 45 },
  'skinpen': { precio: '350 €', duracion: '60 min', precioNumero: 350, duracionMinutos: 60 },
  'rejuvenecimiento-skin-pen': { precio: '350 €', duracion: '60 min', precioNumero: 350, duracionMinutos: 60 },
  'laser-carbono': { precio: '110 €', duracion: '60 min', precioNumero: 110, duracionMinutos: 60 },

  // Pestañas y cejas
  'lifting-pestanas': { precio: '50 €', duracion: '45 min', precioNumero: 50, duracionMinutos: 45 },
  'lifting-tinte': { precio: '60 €', duracion: '60 min', precioNumero: 60, duracionMinutos: 60 },
  'lifting-pestanas-tinte': { precio: '60 €', duracion: '60 min', precioNumero: 60, duracionMinutos: 60 },
  'tinte-pestanas': { precio: '15 €', duracion: '20 min', precioNumero: 15, duracionMinutos: 20 },
  'tinte-pestanas-cejas': { precio: '15 €', duracion: '20 min', precioNumero: 15, duracionMinutos: 20 },
  'laminado-cejas': { precio: '50 €', duracion: '45 min', precioNumero: 50, duracionMinutos: 45 },

  // Uñas
  'manicura-express': { precio: '20 €', duracion: '25 min', precioNumero: 20, duracionMinutos: 25 },
  'manicura-tradicional': { precio: '25 €', duracion: '40 min', precioNumero: 25, duracionMinutos: 40 },
  'manicura-semipermanente': { precio: '30 €', duracion: '50 min', precioNumero: 30, duracionMinutos: 50 },
  'parafina-manos': { precio: '20 €', duracion: '20 min', precioNumero: 20, duracionMinutos: 20 },
  'pedicura-express': { precio: '25 €', duracion: '30 min', precioNumero: 25, duracionMinutos: 30 },
  'pedicura-tradicional': { precio: '30 €', duracion: '45 min', precioNumero: 30, duracionMinutos: 45 },
  'pedicura-semipermanente': { precio: '35 €', duracion: '60 min', precioNumero: 35, duracionMinutos: 60 },

  // Masajes
  'masaje-relajante': { precio: '75 €', duracion: '60 min', precioNumero: 75, duracionMinutos: 60 },
  'masaje-descontracturante': { precio: '70 €', duracion: '60 min', precioNumero: 70, duracionMinutos: 60 },
  'masaje-deportivo': { precio: '80 €', duracion: '60 min', precioNumero: 80, duracionMinutos: 60 },
  'masaje-prenatal': { precio: '70 €', duracion: '60 min', precioNumero: 70, duracionMinutos: 60 },
  'masaje-aromaterapia': { precio: '62 €', duracion: '60 min', precioNumero: 62, duracionMinutos: 60 },
  'masaje-craneofacial': { precio: '30 €', duracion: '30 min', precioNumero: 30, duracionMinutos: 30 },
  'masaje-facial': { precio: '37 €', duracion: '30 min', precioNumero: 37, duracionMinutos: 30 },
  'masaje-piernas-cansadas': { precio: '37 €', duracion: '30 min', precioNumero: 37, duracionMinutos: 30 },
  'masaje-pies': { precio: '20 €', duracion: '15 min', precioNumero: 20, duracionMinutos: 15 },
  'masaje-relajante-pies': { precio: '20 €', duracion: '15 min', precioNumero: 20, duracionMinutos: 15 },
  'reflexologia-podal': { precio: '35 €', duracion: '30 min', precioNumero: 35, duracionMinutos: 30 },
  'drenaje-manual': { precio: '69 €', duracion: '60 min', precioNumero: 69, duracionMinutos: 60 },
  'piedras-calientes': { precio: '78 €', duracion: '60 min', precioNumero: 78, duracionMinutos: 60 },
  'exfoliacion-corporal': { precio: '55 €', duracion: '45 min', precioNumero: 55, duracionMinutos: 45 },

  // Aparatología
  'presoterapia': { precio: '50 €', duracion: '45 min', precioNumero: 50, duracionMinutos: 45 },
  'presoterapia-masaje': { precio: '60 €', duracion: '50 min', precioNumero: 60, duracionMinutos: 50 },
  'lipolaser-radiofrecuencia': { precio: '100 €', duracion: '60 min', precioNumero: 100, duracionMinutos: 60 },
  'vacum': { precio: '50 €', duracion: '30 min', precioNumero: 50, duracionMinutos: 30 },
  'vacum-gluteos': { precio: '50 €', duracion: '30 min', precioNumero: 50, duracionMinutos: 30 },
  'laser-fisio': { precio: '30 €', duracion: '30 min', precioNumero: 30, duracionMinutos: 30 },
  'laser-fisio-dolor': { precio: '30 €', duracion: '30 min', precioNumero: 30, duracionMinutos: 30 },

  // Depilación manual (claves canónicas depilacion-* y alias)
  'depilacion-diseno-cejas': { precio: '20 €', duracion: '20 min', precioNumero: 20, duracionMinutos: 20 },
  'depilacion-cejas': { precio: '11 €', duracion: '15 min', precioNumero: 11, duracionMinutos: 15 },
  'depilacion-labio-superior': { precio: '10 €', duracion: '10 min', precioNumero: 10, duracionMinutos: 10 },
  'depilacion-menton': { precio: '10 €', duracion: '10 min', precioNumero: 10, duracionMinutos: 10 },
  'depilacion-patillas': { precio: '11 €', duracion: '15 min', precioNumero: 11, duracionMinutos: 15 },
  'depilacion-facial-completa': { precio: '32 €', duracion: '30 min', precioNumero: 32, duracionMinutos: 30 },
  'depilacion-axilas': { precio: '15 €', duracion: '15 min', precioNumero: 15, duracionMinutos: 15 },
  'depilacion-espalda': { precio: '30 €', duracion: '30 min', precioNumero: 30, duracionMinutos: 30 },
  'depilacion-brazos': { precio: '20 €', duracion: '30 min', precioNumero: 20, duracionMinutos: 30 },
  'depilacion-medio-brazo': { precio: '15 €', duracion: '20 min', precioNumero: 15, duracionMinutos: 20 },
  'depilacion-pecho': { precio: '30 €', duracion: '25 min', precioNumero: 30, duracionMinutos: 25 },
  'depilacion-abdomen': { precio: '20 €', duracion: '20 min', precioNumero: 20, duracionMinutos: 20 },
  'depilacion-gluteos': { precio: '25 €', duracion: '20 min', precioNumero: 25, duracionMinutos: 20 },
  'depilacion-perianal': { precio: '12 €', duracion: '15 min', precioNumero: 12, duracionMinutos: 15 },
  'depilacion-ingles-brasilenas': { precio: '20 €', duracion: '25 min', precioNumero: 20, duracionMinutos: 25 },
  'depilacion-ingles-normales': { precio: '16 €', duracion: '15 min', precioNumero: 16, duracionMinutos: 15 },
  'depilacion-ingles-integrales': { precio: '30 €', duracion: '30 min', precioNumero: 30, duracionMinutos: 30 },
  'depilacion-piernas': { precio: '28 €', duracion: '45 min', precioNumero: 28, duracionMinutos: 45 },
  'depilacion-medias-piernas': { precio: '20 €', duracion: '30 min', precioNumero: 20, duracionMinutos: 30 },

  'pinzas-diseno': { precio: '20 €', duracion: '20 min', precioNumero: 20, duracionMinutos: 20 },
  'pinzas-cejas': { precio: '11 €', duracion: '15 min', precioNumero: 11, duracionMinutos: 15 },
  'hilo-cejas': { precio: '16 €', duracion: '15 min', precioNumero: 16, duracionMinutos: 15 },
  'diseno-hilo-cejas': { precio: '25 €', duracion: '25 min', precioNumero: 25, duracionMinutos: 25 },
  'hilo-labio': { precio: '12 €', duracion: '10 min', precioNumero: 12, duracionMinutos: 10 },
  'hilo-menton': { precio: '11 €', duracion: '10 min', precioNumero: 11, duracionMinutos: 10 },
  'hilo-rostro': { precio: '32 €', duracion: '30 min', precioNumero: 32, duracionMinutos: 30 },
  'cera-labio': { precio: '10 €', duracion: '10 min', precioNumero: 10, duracionMinutos: 10 },
  'cera-axilas': { precio: '15 €', duracion: '15 min', precioNumero: 15, duracionMinutos: 15 },
  'cera-abdomen': { precio: '20 €', duracion: '20 min', precioNumero: 20, duracionMinutos: 20 },
  'cera-brazos': { precio: '20 €', duracion: '30 min', precioNumero: 20, duracionMinutos: 30 },
  'cera-menton': { precio: '10 €', duracion: '10 min', precioNumero: 10, duracionMinutos: 10 },
  'cera-espalda': { precio: '30 €', duracion: '30 min', precioNumero: 30, duracionMinutos: 30 },
  'cera-glutios': { precio: '25 €', duracion: '20 min', precioNumero: 25, duracionMinutos: 20 },
  'cera-ingles-brasileñas': { precio: '20 €', duracion: '25 min', precioNumero: 20, duracionMinutos: 25 },
  'cera-ingles-normales': { precio: '16 €', duracion: '15 min', precioNumero: 16, duracionMinutos: 15 },
  'cera-ingles-integrales': { precio: '30 €', duracion: '30 min', precioNumero: 30, duracionMinutos: 30 },
  'cera-pecho': { precio: '30 €', duracion: '25 min', precioNumero: 30, duracionMinutos: 25 },
  'cera-medias-piernas': { precio: '20 €', duracion: '30 min', precioNumero: 20, duracionMinutos: 30 },
  'cera-piernas-completas': { precio: '28 €', duracion: '45 min', precioNumero: 28, duracionMinutos: 45 },
  'cera-medios-brazos': { precio: '15 €', duracion: '20 min', precioNumero: 15, duracionMinutos: 20 },
  'cera-perianal': { precio: '12 €', duracion: '15 min', precioNumero: 12, duracionMinutos: 15 },

  // Depilación láser
  'laser-patillas': { precio: '11 €', duracion: '15 min', precioNumero: 11, duracionMinutos: 15 },
  'laser-menton': { precio: '15 €', duracion: '15 min', precioNumero: 15, duracionMinutos: 15 },
  'laser-axilas': { precio: '20 €', duracion: '15 min', precioNumero: 20, duracionMinutos: 15 },
  'laser-espalda': { precio: '48 €', duracion: '30 min', precioNumero: 48, duracionMinutos: 30 },
  'laser-ingles-integrales': { precio: '40 €', duracion: '30 min', precioNumero: 40, duracionMinutos: 30 },
  'laser-labio': { precio: '10 €', duracion: '10 min', precioNumero: 10, duracionMinutos: 10 },
  'laser-medias-piernas': { precio: '30 €', duracion: '30 min', precioNumero: 30, duracionMinutos: 30 },
  'laser-piernas-completas': { precio: '50 €', duracion: '45 min', precioNumero: 50, duracionMinutos: 45 },
  'laser-pecho': { precio: '40 €', duracion: '30 min', precioNumero: 40, duracionMinutos: 30 },
  'laser-ingles-brasileñas': { precio: '30 €', duracion: '25 min', precioNumero: 30, duracionMinutos: 25 },
  'laser-ingles-brasilenas': { precio: '30 €', duracion: '25 min', precioNumero: 30, duracionMinutos: 25 },
}

export function getTarifaTratamiento(slug: string): TarifaTratamiento | null {
  return TARIFAS_OFICIALES_POR_SLUG[slug] ?? null
}

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
