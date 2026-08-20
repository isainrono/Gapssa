import { describe, expect, it } from 'vitest'

import type { Locale } from '@/lib/i18n/locales'
import { LOCALES } from '@/lib/i18n/locales'

import type { TraduccionTratamiento } from './data/tratamientos'
import { computeMissingAltUpdates, computeMissingTratamientoLocaleUpdates, isLocaleTextMissing } from './localeCompletion'

const SEED: Record<Locale, TraduccionTratamiento> = {
  es: { titulo: 'Título ES', descripcion: 'Descripción ES', beneficios: ['Beneficio ES 1', 'Beneficio ES 2'] },
  ca: { titulo: 'Títol CA', descripcion: 'Descripció CA', beneficios: ['Benefici CA 1', 'Benefici CA 2'] },
  en: { titulo: 'Title EN', descripcion: 'Description EN', beneficios: ['Benefit EN 1', 'Benefit EN 2'] },
  it: { titulo: 'Titolo IT', descripcion: 'Descrizione IT', beneficios: ['Beneficio IT 1', 'Beneficio IT 2'] },
  fr: { titulo: 'Titre FR', descripcion: 'Description FR', beneficios: ['Bénéfice FR 1', 'Bénéfice FR 2'] },
  pt: { titulo: 'Título PT', descripcion: 'Descrição PT', beneficios: ['Benefício PT 1', 'Benefício PT 2'] },
}

describe('isLocaleTextMissing', () => {
  it('trata undefined, null y cadena en blanco como ausente', () => {
    expect(isLocaleTextMissing(undefined)).toBe(true)
    expect(isLocaleTextMissing(null)).toBe(true)
    expect(isLocaleTextMissing('   ')).toBe(true)
    expect(isLocaleTextMissing('')).toBe(true)
  })

  it('cualquier texto real cuenta como presente', () => {
    expect(isLocaleTextMissing('Hola')).toBe(false)
  })
})

describe('computeMissingTratamientoLocaleUpdates', () => {
  it('no genera ninguna actualización si los 6 idiomas ya están completos', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA', en: 'Title EN', it: 'Titolo IT', fr: 'Titre FR', pt: 'Título PT' },
      descripcion: {
        es: 'Descripción ES',
        ca: 'Descripció CA',
        en: 'Description EN',
        it: 'Descrizione IT',
        fr: 'Description FR',
        pt: 'Descrição PT',
      },
      beneficios: [
        { id: 'b1', texto: { es: 'Beneficio ES 1', ca: 'Benefici CA 1', en: 'Benefit EN 1', it: 'Beneficio IT 1', fr: 'Bénéfice FR 1', pt: 'Benefício PT 1' } },
        { id: 'b2', texto: { es: 'Beneficio ES 2', ca: 'Benefici CA 2', en: 'Benefit EN 2', it: 'Beneficio IT 2', fr: 'Bénéfice FR 2', pt: 'Benefício PT 2' } },
      ],
    }

    expect(computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)).toEqual([])
  })

  it('solo el idioma español creado: genera actualización para los 5 idiomas restantes, no para español', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES' },
      descripcion: { es: 'Descripción ES' },
      beneficios: [
        { id: 'b1', texto: { es: 'Beneficio ES 1' } },
        { id: 'b2', texto: { es: 'Beneficio ES 2' } },
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    const locales = updates.map((u) => u.locale)

    expect(locales).toEqual(['ca', 'en', 'it', 'fr', 'pt'])
    const ca = updates.find((u) => u.locale === 'ca')!
    expect(ca.data.titulo).toBe('Títol CA')
    expect(ca.data.descripcion).toBe('Descripció CA')
    expect(ca.data.beneficios).toEqual([
      { id: 'b1', texto: 'Benefici CA 1' },
      { id: 'b2', texto: 'Benefici CA 2' },
    ])
  })

  it('nunca pisa una traducción manual ya presente, aunque falte otro campo del mismo idioma', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Editado a mano en catalán' },
      descripcion: { es: 'Descripción ES' }, // ca.descripcion falta
      beneficios: [
        { id: 'b1', texto: { es: 'Beneficio ES 1', ca: 'Benefici CA 1' } },
        { id: 'b2', texto: { es: 'Beneficio ES 2', ca: 'Benefici CA 2' } },
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.titulo).toBeUndefined() // no se toca el título editado a mano
    expect(ca.data.descripcion).toBe('Descripció CA') // se completa lo que faltaba
    expect(ca.data.beneficios).toBeUndefined() // los beneficios ya estaban completos en catalán
  })

  it('completa solo las filas de beneficios que faltan, preservando las que ya existían', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA' },
      descripcion: { es: 'Descripción ES', ca: 'Descripció CA' },
      beneficios: [
        { id: 'b1', texto: { es: 'Beneficio ES 1', ca: 'Benefici CA 1' } },
        { id: 'b2', texto: { es: 'Beneficio ES 2' } }, // falta ca en la segunda fila
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.beneficios).toEqual([
      { id: 'b1', texto: 'Benefici CA 1' }, // preservado, no reescrito con el mismo valor por casualidad
      { id: 'b2', texto: 'Benefici CA 2' }, // completado desde el seed
    ])
  })
})

describe('computeMissingTratamientoLocaleUpdates — revisión 3: cadenas vacías y recuentos', () => {
  it('un beneficio con cadena vacía ("") se completa con el seed, en vez de conservarse como cadena vacía', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA' },
      descripcion: { es: 'Descripción ES', ca: 'Descripció CA' },
      beneficios: [
        { id: 'b1', texto: { es: 'Beneficio ES 1', ca: '' } },
        { id: 'b2', texto: { es: 'Beneficio ES 2', ca: 'Benefici CA 2' } },
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.beneficios).toEqual([
      { id: 'b1', texto: 'Benefici CA 1' },
      { id: 'b2', texto: 'Benefici CA 2' },
    ])
  })

  it('un beneficio compuesto solo por espacios también se completa con el seed', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA' },
      descripcion: { es: 'Descripción ES', ca: 'Descripció CA' },
      beneficios: [
        { id: 'b1', texto: { es: 'Beneficio ES 1', ca: '   ' } },
        { id: 'b2', texto: { es: 'Beneficio ES 2', ca: 'Benefici CA 2' } },
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.beneficios![0]!.texto).toBe('Benefici CA 1')
  })

  it('preserva un beneficio editado a mano que no coincide con el seed, en vez de sustituirlo', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA' },
      descripcion: { es: 'Descripción ES', ca: 'Descripció CA' },
      beneficios: [
        { id: 'b1', texto: { es: 'Beneficio ES 1', ca: 'Texto editado a mano, distinto del seed' } },
        { id: 'b2', texto: { es: 'Beneficio ES 2', ca: '' } },
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.beneficios).toEqual([
      { id: 'b1', texto: 'Texto editado a mano, distinto del seed' },
      { id: 'b2', texto: 'Benefici CA 2' },
    ])
  })

  it('si falta completamente el array de beneficios, no se genera ninguna actualización de beneficios (nunca fabrica filas nuevas)', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES' },
      descripcion: { es: 'Descripción ES' },
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)

    for (const update of updates) {
      expect(update.data.beneficios).toBeUndefined()
    }
  })

  it('si el documento tiene más filas de beneficios que el seed, la fila sobrante (sin equivalente en el seed) nunca se vacía ni se pisa', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA' },
      descripcion: { es: 'Descripción ES', ca: 'Descripció CA' },
      beneficios: [
        { id: 'b1', texto: { es: 'Beneficio ES 1', ca: '' } },
        { id: 'b2', texto: { es: 'Beneficio ES 2', ca: 'Benefici CA 2' } },
        // SEED.ca.beneficios solo tiene 2 elementos: esta 3ª fila queda fuera de su rango.
        { id: 'b3', texto: { es: 'Beneficio ES 3 manual', ca: 'Beneficio manual sin seed' } },
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.beneficios).toEqual([
      { id: 'b1', texto: 'Benefici CA 1' },
      { id: 'b2', texto: 'Benefici CA 2' },
      { id: 'b3', texto: 'Beneficio manual sin seed' },
    ])
  })

  it('si el documento tiene menos filas de beneficios que el seed, los beneficios extra del seed se ignoran (nunca se crean filas nuevas)', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA' },
      descripcion: { es: 'Descripción ES', ca: 'Descripció CA' },
      beneficios: [{ id: 'b1', texto: { es: 'Beneficio ES 1', ca: '' } }],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.beneficios).toEqual([{ id: 'b1', texto: 'Benefici CA 1' }])
  })

  it('es idempotente: recalcular sobre el documento ya con los beneficios completados no genera más actualizaciones', () => {
    // Los 6 idiomas ya completos salvo los beneficios en catalán (vacío y
    // solo-espacios): así la segunda ejecución solo puede volver a estar
    // vacía por la corrección de esta revisión, no por ruido de otros
    // campos/idiomas todavía sin completar.
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA', en: 'Title EN', it: 'Titolo IT', fr: 'Titre FR', pt: 'Título PT' },
      descripcion: {
        es: 'Descripción ES',
        ca: 'Descripció CA',
        en: 'Description EN',
        it: 'Descrizione IT',
        fr: 'Description FR',
        pt: 'Descrição PT',
      },
      beneficios: [
        {
          id: 'b1',
          texto: { es: 'Beneficio ES 1', ca: '', en: 'Benefit EN 1', it: 'Beneficio IT 1', fr: 'Bénéfice FR 1', pt: 'Benefício PT 1' },
        },
        {
          id: 'b2',
          texto: {
            es: 'Beneficio ES 2',
            ca: '   ',
            en: 'Benefit EN 2',
            it: 'Beneficio IT 2',
            fr: 'Bénéfice FR 2',
            pt: 'Benefício PT 2',
          },
        },
      ],
    }

    const primeraEjecucion = computeMissingTratamientoLocaleUpdates(raw, SEED, LOCALES)
    expect(primeraEjecucion.map((u) => u.locale)).toEqual(['ca'])
    const ca = primeraEjecucion.find((u) => u.locale === 'ca')!

    const rawDespuesDeAplicar = {
      ...raw,
      beneficios: raw.beneficios.map((fila, index) => ({
        ...fila,
        texto: { ...fila.texto, ca: ca.data.beneficios![index]!.texto },
      })),
    }

    const segundaEjecucion = computeMissingTratamientoLocaleUpdates(rawDespuesDeAplicar, SEED, LOCALES)
    expect(segundaEjecucion).toEqual([])
  })

  const SEED_CON_FAQ: Record<Locale, TraduccionTratamiento> = {
    ...SEED,
    ca: { ...SEED.ca, preguntasFrecuentes: [{ pregunta: 'Pregunta CA 1', respuesta: 'Respuesta CA 1' }] },
  }

  it('una pregunta de FAQ vacía se completa con el seed, preservando una respuesta manual ya presente', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA' },
      descripcion: { es: 'Descripción ES', ca: 'Descripció CA' },
      preguntasFrecuentes: [
        { id: 'f1', pregunta: { es: 'Pregunta ES 1', ca: '' }, respuesta: { es: 'Respuesta ES 1', ca: 'Respuesta manual CA' } },
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED_CON_FAQ, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.preguntasFrecuentes).toEqual([{ id: 'f1', pregunta: 'Pregunta CA 1', respuesta: 'Respuesta manual CA' }])
  })

  it('una respuesta de FAQ vacía (solo espacios) se completa con el seed, preservando una pregunta manual ya presente', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES', ca: 'Títol CA' },
      descripcion: { es: 'Descripción ES', ca: 'Descripció CA' },
      preguntasFrecuentes: [
        { id: 'f1', pregunta: { es: 'Pregunta ES 1', ca: 'Pregunta manual CA' }, respuesta: { es: 'Respuesta ES 1', ca: '   ' } },
      ],
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED_CON_FAQ, LOCALES)
    const ca = updates.find((u) => u.locale === 'ca')!

    expect(ca.data.preguntasFrecuentes).toEqual([{ id: 'f1', pregunta: 'Pregunta manual CA', respuesta: 'Respuesta CA 1' }])
  })

  it('si falta completamente el array de FAQ, no se genera ninguna actualización de preguntasFrecuentes', () => {
    const raw = {
      id: 1,
      titulo: { es: 'Título ES' },
      descripcion: { es: 'Descripción ES' },
    }

    const updates = computeMissingTratamientoLocaleUpdates(raw, SEED_CON_FAQ, LOCALES)

    for (const update of updates) {
      expect(update.data.preguntasFrecuentes).toBeUndefined()
    }
  })
})

describe('computeMissingAltUpdates', () => {
  it('completa solo los idiomas ausentes del alt', () => {
    const rawAlt = { es: 'Interior del centro', en: 'Interior of the centre' }
    const seedAlt: Partial<Record<Locale, string>> = {
      es: 'Interior del centro',
      ca: 'Interior del centre',
      en: 'Interior of the centre',
      it: 'Interno del centro',
      fr: 'Intérieur du centre',
      pt: 'Interior do centro',
    }

    const updates = computeMissingAltUpdates(rawAlt, seedAlt, LOCALES)

    expect(updates.map((u) => u.locale)).toEqual(['ca', 'it', 'fr', 'pt'])
  })

  it('no genera nada si ya está todo completo', () => {
    const rawAlt = { es: 'a', ca: 'a', en: 'a', it: 'a', fr: 'a', pt: 'a' }
    const seedAlt: Partial<Record<Locale, string>> = { es: 'a', ca: 'a', en: 'a', it: 'a', fr: 'a', pt: 'a' }

    expect(computeMissingAltUpdates(rawAlt, seedAlt, LOCALES)).toEqual([])
  })
})
