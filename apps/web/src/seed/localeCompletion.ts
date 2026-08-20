import type { Locale } from '@/lib/i18n/locales'

import type { FaqSeed, TraduccionTratamiento } from './data/tratamientos'

/**
 * Decisión pura de "traducción completa por revisión 2 de Fase 2": el seed
 * ya no se limita a crear-o-saltar por documento (`shouldCreateDocument`,
 * `idempotent.ts`) — para un documento que ya existe debe **completar**
 * cualquier idioma que falte sin tocar los que ya tienen contenido (editado
 * a mano o sembrado antes). Estas funciones no conocen Payload ni Postgres:
 * reciben la lectura cruda por idioma (`locale: 'all', fallbackLocale:
 * false` — sin eso, el `fallback: true` global de `payload.config.ts`
 * devolvería el valor en español para un idioma vacío, y "falta" sería
 * indistinguible de "ya traducido") y el contenido propuesto por el seed, y
 * deciden qué escribir, si acaso.
 */

/** `undefined`/`null`/cadena en blanco cuentan como "sin traducir" — nunca un fallback silencioso. */
export function isLocaleTextMissing(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === ''
}

/**
 * Resuelve el valor final de una celda de texto localizada (fila de
 * beneficio, pregunta o respuesta de FAQ) para el `update` que se va a
 * enviar. Corrige el bug de la revisión 2: usar `??` directamente sobre
 * `current` conserva `''`/espacios porque no son `null`/`undefined`, así
 * que una fila vacía nunca llegaba a completarse con el seed. Aquí se
 * comprueba primero `isLocaleTextMissing`, la misma función que decide si
 * la fila necesitaba actualizarse:
 *
 * - contenido real presente (manual o de una siembra anterior) → se
 *   preserva tal cual, nunca se pisa;
 * - ausente y el seed trae valor para esa posición → se usa el seed;
 * - ausente y el seed NO trae valor para esa posición (la fila existente
 *   está fuera del rango del seed — ver política de recuento distinto en
 *   `computeMissingTratamientoLocaleUpdates`) → se conserva el valor tal
 *   cual estaba (`current ?? ''` solo entra aquí, y solo reproduce un
 *   valor que ya era ausente, nunca sustituye contenido con seed).
 */
function resolveMissingLocalizedText(current: string | null | undefined, seedValue: string | undefined): string {
  if (!isLocaleTextMissing(current)) {
    return current as string
  }
  if (seedValue !== undefined && !isLocaleTextMissing(seedValue)) {
    return seedValue
  }
  return current ?? ''
}

/** Forma de un campo de texto localizado tal como lo devuelve Payload con `locale: 'all'`. */
export type RawLocalizedText = Partial<Record<Locale, string | null>> | null | undefined

/**
 * Forma de una fila de array con un único campo de texto localizado (p. ej.
 * un beneficio). `id` es `string` (no `number`): Payload asigna un
 * identificador de fila de tipo texto a las subfilas de un array incluso
 * bajo el adaptador de Postgres (verificado contra `payload-types.ts`,
 * `TratamientosSelect` — `beneficios[].id?: string`).
 */
export type RawLocalizedArrayItem = {
  id: string
  texto?: RawLocalizedText
}

/** Forma de una fila de FAQ (pregunta + respuesta), ambos localizados. */
export type RawLocalizedFaqItem = {
  id: string
  pregunta?: RawLocalizedText
  respuesta?: RawLocalizedText
}

/** Lectura cruda (sin fallback) de un `tratamiento` tal como la devuelve `findByID({ locale: 'all', fallbackLocale: false })`. */
export type RawLocalizedTratamiento = {
  id: number
  titulo?: RawLocalizedText
  descripcion?: RawLocalizedText
  beneficios?: RawLocalizedArrayItem[]
  requisitosContraindicaciones?: RawLocalizedText
  preguntasFrecuentes?: RawLocalizedFaqItem[]
  seo?: {
    title?: RawLocalizedText
    description?: RawLocalizedText
  }
}

export type TratamientoLocaleUpdate = {
  locale: Locale
  data: {
    titulo?: string
    descripcion?: string
    beneficios?: { id?: string; texto: string }[]
    requisitosContraindicaciones?: string
    preguntasFrecuentes?: { id?: string; pregunta: string; respuesta: string }[]
    seo?: { title?: string; description?: string }
  }
}

/**
 * Para un tratamiento que YA EXISTE, calcula qué `payload.update(...)` (uno
 * por idioma con contenido pendiente) hace falta para dejar los 6 idiomas
 * completos — nunca pisa un valor ya presente, nunca crea filas nuevas del
 * array de beneficios/FAQ (reutiliza los `id` existentes, en el mismo orden
 * que el seed, asumiendo que el número de filas coincide: este seed nunca
 * cambia el número de beneficios/FAQ de un tratamiento ya sembrado). Los
 * idiomas ya completos no aparecen en el resultado — así una segunda
 * ejecución sobre un documento ya completo no genera ninguna llamada de
 * escritura.
 */
export function computeMissingTratamientoLocaleUpdates(
  raw: RawLocalizedTratamiento,
  seed: Record<Locale, TraduccionTratamiento>,
  locales: readonly Locale[],
): TratamientoLocaleUpdate[] {
  const updates: TratamientoLocaleUpdate[] = []

  for (const locale of locales) {
    const traduccion = seed[locale]
    const data: TratamientoLocaleUpdate['data'] = {}

    if (isLocaleTextMissing(raw.titulo?.[locale])) {
      data.titulo = traduccion.titulo
    }
    if (isLocaleTextMissing(raw.descripcion?.[locale])) {
      data.descripcion = traduccion.descripcion
    }

    // Política para un recuento de filas que no coincide con el seed (nunca
    // se asume silenciosamente que coincidirá): si el documento no tiene
    // ningún beneficio (`raw.beneficios` ausente o `[]`), no hay filas ni
    // `id` sobre los que escribir, así que no se hace nada — el seed nunca
    // crea filas nuevas en un documento ya existente (ver el comentario de
    // `computeMissingTratamientoLocaleUpdates`). Si el documento tiene MÁS
    // filas que el seed, las filas sobrantes (`traduccion.beneficios[index]
    // === undefined`) nunca disparan una actualización por sí solas y, si
    // el `update` se dispara por otra fila, `resolveMissingLocalizedText`
    // las deja tal cual estaban (nunca fabrica contenido). Si tiene MENOS
    // filas que el seed, simplemente no hay `index` que las alcance — los
    // beneficios extra del seed se ignoran para ese documento.
    const beneficiosFaltan = (raw.beneficios ?? []).some((fila, index) =>
      isLocaleTextMissing(fila.texto?.[locale]) && traduccion.beneficios[index] !== undefined,
    )
    if (beneficiosFaltan) {
      data.beneficios = (raw.beneficios ?? []).map((fila, index) => ({
        id: fila.id,
        texto: resolveMissingLocalizedText(fila.texto?.[locale], traduccion.beneficios[index]),
      }))
    }

    if (traduccion.requisitosContraindicaciones && isLocaleTextMissing(raw.requisitosContraindicaciones?.[locale])) {
      data.requisitosContraindicaciones = traduccion.requisitosContraindicaciones
    }

    // Misma política de recuento distinto que en beneficios, aplicada a
    // pregunta y respuesta por separado (una fila de FAQ puede tener la
    // pregunta completa y la respuesta ausente, o viceversa).
    if (traduccion.preguntasFrecuentes && traduccion.preguntasFrecuentes.length > 0) {
      const seedFaqs = traduccion.preguntasFrecuentes as FaqSeed[]
      const faqFaltan = (raw.preguntasFrecuentes ?? []).some(
        (fila, index) =>
          (isLocaleTextMissing(fila.pregunta?.[locale]) || isLocaleTextMissing(fila.respuesta?.[locale])) &&
          seedFaqs[index] !== undefined,
      )
      if (faqFaltan) {
        data.preguntasFrecuentes = (raw.preguntasFrecuentes ?? []).map((fila, index) => {
          const seedFaq = seedFaqs[index]
          return {
            id: fila.id,
            pregunta: resolveMissingLocalizedText(fila.pregunta?.[locale], seedFaq?.pregunta),
            respuesta: resolveMissingLocalizedText(fila.respuesta?.[locale], seedFaq?.respuesta),
          }
        })
      }
    }

    if (traduccion.seo) {
      const seoUpdate: { title?: string; description?: string } = {}
      if (traduccion.seo.titulo && isLocaleTextMissing(raw.seo?.title?.[locale])) {
        seoUpdate.title = traduccion.seo.titulo
      }
      if (traduccion.seo.descripcion && isLocaleTextMissing(raw.seo?.description?.[locale])) {
        seoUpdate.description = traduccion.seo.descripcion
      }
      if (Object.keys(seoUpdate).length > 0) {
        data.seo = seoUpdate
      }
    }

    if (Object.keys(data).length > 0) {
      updates.push({ locale, data })
    }
  }

  return updates
}

/** Misma decisión de "completar sin pisar", aplicada al texto alternativo (`alt`) de `media`. */
export function computeMissingAltUpdates(
  rawAlt: RawLocalizedText,
  seedAltPorLocale: Partial<Record<Locale, string>>,
  locales: readonly Locale[],
): { locale: Locale; alt: string }[] {
  const updates: { locale: Locale; alt: string }[] = []
  for (const locale of locales) {
    const seedAlt = seedAltPorLocale[locale]
    if (seedAlt && isLocaleTextMissing(rawAlt?.[locale])) {
      updates.push({ locale, alt: seedAlt })
    }
  }
  return updates
}
