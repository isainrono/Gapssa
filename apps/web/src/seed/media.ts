import fs from 'node:fs'
import path from 'node:path'

import type { BasePayload } from 'payload'

import { LOCALES, type Locale } from '@/lib/i18n/locales'

import { shouldCreateDocument } from './idempotent'
import { computeMissingAltUpdates, type RawLocalizedText } from './localeCompletion'

export type MediaFileSeed = {
  key: string
  relativePath: string
  /**
   * `Record<Locale, string>` obligatorio, no `Partial<...>`: revisión 2 de
   * Fase 2 detectó 10 de las 12 imágenes con `alt` solo en es/en — un
   * activo usado en una página multilingüe necesita `alt` en los 6 idiomas
   * (`PLAN_DESARROLLO_WEB_PORTAL.md` §5.1, WCAG 2.2 AA). El tipo obligatorio
   * evita que vuelva a faltar un idioma sin que TypeScript avise.
   */
  altPorLocale: Record<Locale, string>
}

export const PUBLIC_IMAGES_DIR = path.resolve(process.cwd(), 'public/images')

export const MEDIA_FILES: MediaFileSeed[] = [
  {
    key: 'logo',
    relativePath: 'marca/logo.webp',
    altPorLocale: {
      es: 'Logotipo de GAPSSA by Nana',
      ca: 'Logotip de GAPSSA by Nana',
      en: 'GAPSSA by Nana logo',
      it: 'Logo di GAPSSA by Nana',
      fr: 'Logo de GAPSSA by Nana',
      pt: 'Logótipo da GAPSSA by Nana',
    },
  },
  // 'diana' (equipo/diana.jpg) queda fuera de MEDIA_FILES a propósito: es
  // contenido propio de Gapssa cuya autorización pública explícita todavía
  // no está confirmada (docs/deuda-imagenes-stock.md). No inferir
  // consentimiento por aparecer en gapssa1/ o WhatsApp — cuando Gapssa
  // confirme la autorización, volver a añadir esta entrada.
  {
    key: 'hero-centro',
    relativePath: 'stock/hero-centro.jpg',
    altPorLocale: {
      es: 'Interior del centro GAPSSA by Nana',
      ca: 'Interior del centre GAPSSA by Nana',
      en: 'Interior of the GAPSSA by Nana centre',
      it: 'Interno del centro GAPSSA by Nana',
      fr: 'Intérieur du centre GAPSSA by Nana',
      pt: 'Interior do centro GAPSSA by Nana',
    },
  },
  {
    key: 'tratamiento-facial',
    relativePath: 'stock/tratamiento-facial.jpg',
    altPorLocale: {
      es: 'Tratamiento facial',
      ca: 'Tractament facial',
      en: 'Facial treatment',
      it: 'Trattamento viso',
      fr: 'Soin du visage',
      pt: 'Tratamento facial',
    },
  },
  {
    key: 'manicura',
    relativePath: 'stock/manicura.jpg',
    altPorLocale: { es: 'Manicura', ca: 'Manicura', en: 'Manicure', it: 'Manicure', fr: 'Manucure', pt: 'Manicure' },
  },
  {
    key: 'masaje',
    relativePath: 'stock/masaje.jpg',
    altPorLocale: { es: 'Masaje', ca: 'Massatge', en: 'Massage', it: 'Massaggio', fr: 'Massage', pt: 'Massagem' },
  },
  {
    key: 'depilacion-facial',
    relativePath: 'stock/depilacion-facial.jpg',
    altPorLocale: {
      es: 'Depilación facial',
      ca: 'Depilació facial',
      en: 'Facial hair removal',
      it: 'Depilazione del viso',
      fr: 'Épilation du visage',
      pt: 'Depilação facial',
    },
  },
  {
    key: 'radiofrecuencia-facial',
    relativePath: 'stock/radiofrecuencia-facial.jpg',
    altPorLocale: {
      es: 'Radiofrecuencia facial',
      ca: 'Radiofreqüència facial',
      en: 'Facial radiofrequency',
      it: 'Radiofrequenza facciale',
      fr: 'Radiofréquence visage',
      pt: 'Radiofrequência facial',
    },
  },
  {
    key: 'hidratacion-facial',
    relativePath: 'stock/hidratacion-facial.jpg',
    altPorLocale: {
      es: 'Hidratación facial',
      ca: 'Hidratació facial',
      en: 'Facial hydration',
      it: 'Idratazione del viso',
      fr: 'Hydratation du visage',
      pt: 'Hidratação facial',
    },
  },
  {
    key: 'tratamiento-reafirmante',
    relativePath: 'stock/tratamiento-reafirmante.jpg',
    altPorLocale: {
      es: 'Tratamiento corporal reafirmante',
      ca: 'Tractament corporal reafirmant',
      en: 'Firming body treatment',
      it: 'Trattamento corpo rassodante',
      fr: 'Soin corporel raffermissant',
      pt: 'Tratamento corporal reafirmante',
    },
  },
  {
    key: 'pedicura',
    relativePath: 'stock/pedicura.jpg',
    altPorLocale: { es: 'Pedicura', ca: 'Pedicura', en: 'Pedicure', it: 'Pedicure', fr: 'Pédicure', pt: 'Pedicure' },
  },
  {
    key: 'microdermoabrasion',
    relativePath: 'stock/microdermoabrasion.jpg',
    altPorLocale: {
      es: 'Tratamiento facial de cuidado avanzado',
      ca: 'Tractament facial de cura avançada',
      en: 'Advanced facial care treatment',
      it: 'Trattamento viso di cura avanzata',
      fr: 'Soin du visage de haute technicité',
      pt: 'Tratamento facial de cuidado avançado',
    },
  },
]

export function mimeTypeFor(filePath: string): string {
  return filePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
}

/**
 * Sube (si no existe ya, por `filename`) el logo y la selección de
 * imágenes de stock a la colección `media`. Devuelve un mapa
 * `key -> id` para que el resto del seed (`index.ts`) pueda enlazar las
 * relaciones de imagen sin volver a tocar el sistema de archivos.
 */
export async function seedMedia(payload: BasePayload): Promise<Record<string, number>> {
  const ids: Record<string, number> = {}

  for (const file of MEDIA_FILES) {
    const filename = path.basename(file.relativePath)
    const existing = await payload.find({
      collection: 'media',
      where: { filename: { equals: filename } },
      // Sin fallback: hace falta distinguir "sin traducir todavía" de "ya
      // traducido pero por casualidad devuelto por el fallback a español"
      // (mismo razonamiento que `seedTratamientos`, `index.ts`).
      locale: 'all',
      fallbackLocale: false,
      limit: 1,
      overrideAccess: true,
    })
    const doc = existing.docs[0]

    if (shouldCreateDocument(doc)) {
      const absolutePath = path.join(PUBLIC_IMAGES_DIR, file.relativePath)
      const buffer = fs.readFileSync(absolutePath)
      const created = await payload.create({
        collection: 'media',
        overrideAccess: true,
        locale: 'es',
        data: { alt: file.altPorLocale.es },
        file: {
          data: buffer,
          mimetype: mimeTypeFor(absolutePath),
          name: filename,
          size: buffer.length,
        },
      })
      ids[file.key] = created.id

      // El local API tipado no admite `locale: 'all'` en escrituras (solo en
      // lecturas) — una llamada a `update` por idioma adicional, reutilizando
      // el mismo documento por `id`.
      for (const locale of LOCALES) {
        if (locale === 'es') {
          continue
        }
        await payload.update({
          collection: 'media',
          id: created.id,
          overrideAccess: true,
          locale,
          data: { alt: file.altPorLocale[locale] },
        })
      }
      continue
    }

    ids[file.key] = doc!.id
    const rawAlt = (doc as unknown as { alt?: RawLocalizedText }).alt
    const updates = computeMissingAltUpdates(rawAlt, file.altPorLocale, LOCALES)
    for (const update of updates) {
      await payload.update({ collection: 'media', id: doc!.id, overrideAccess: true, locale: update.locale, data: { alt: update.alt } })
    }
  }

  return ids
}
