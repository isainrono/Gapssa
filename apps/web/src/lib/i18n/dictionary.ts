import type { Locale } from './locales'

import { ca } from './dictionaries/ca'
import { en } from './dictionaries/en'
import { es } from './dictionaries/es'
import { fr } from './dictionaries/fr'
import { it } from './dictionaries/it'
import { pt } from './dictionaries/pt'

/**
 * Forma canónica del diccionario, derivada de `dictionaries/es.ts`. Los
 * otros 5 idiomas se tipan contra esto (`Dictionary`, no `typeof es`
 * directamente en cada archivo) para que un campo que falte o sobre en
 * `ca`/`en`/`it`/`fr`/`pt` sea un error de TypeScript, no solo algo que
 * detecte la prueba de paridad de claves.
 */
export type Dictionary = typeof es

const DICTIONARIES: Record<Locale, Dictionary> = { es, ca, en, it, fr, pt }

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}
