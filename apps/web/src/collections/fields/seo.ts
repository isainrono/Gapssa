import type { Field } from 'payload'

/**
 * Campo SEO reutilizado por las colecciones de contenido público
 * (familias, tratamientos). Título/descripción localizados; ambos
 * opcionales — si faltan, la página recae en el SEO por defecto de
 * `ajustes-globales` (ver `src/lib/seo/metadata.ts`).
 */
export const seoField: Field = {
  name: 'seo',
  type: 'group',
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
    },
    {
      name: 'description',
      type: 'textarea',
      localized: true,
    },
  ],
}
