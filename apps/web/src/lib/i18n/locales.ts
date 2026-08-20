/**
 * Los 6 idiomas de la V1 (PLAN_DESARROLLO_WEB_PORTAL.md §3.1). Español es
 * el idioma principal. Coincide deliberadamente con
 * `payload.config.ts#localization.locales` — si cambian ahí, cambiar aquí
 * también (no hay generación compartida entre ambos en este repo).
 *
 * Fase 1 monta solo la estructura de rutas (`app/(frontend)/[locale]`) y
 * un middleware de redirección; el contenido real por idioma es Fase 2.
 */
export const LOCALES = ['es', 'ca', 'en', 'it', 'fr', 'pt'] as const

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es'

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}
