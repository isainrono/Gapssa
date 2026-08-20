import type { CollectionConfig } from 'payload'

import { publicContentAccess } from './access/content'
import { seoField } from './fields/seo'

/**
 * Familias comerciales del catálogo público (`docs/espocrm-modelo-inicial.md`
 * lista las mismas 6 familias operativas de `CTratamiento.familia` en
 * EspoCRM — coinciden a propósito, pero esta colección es contenido
 * editorial de Payload, no un espejo escrito de EspoCRM: no hay
 * sincronización automática, `PLAN_DESARROLLO_WEB_PORTAL.md` §2).
 *
 * `slug` no está localizado a propósito: debe ser estable entre idiomas
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6, "mantener claves, slugs y
 * relaciones estables entre idiomas") para que el selector de idioma
 * pueda construir la URL equivalente sustituyendo solo el segmento de
 * locale.
 */
export const FamiliasTratamiento: CollectionConfig = {
  slug: 'familias-tratamiento',
  admin: {
    useAsTitle: 'slug',
    defaultColumns: ['slug', 'orden', 'visible'],
  },
  access: publicContentAccess,
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Identificador estable, igual en los 6 idiomas (ej. "masajes").',
      },
    },
    {
      name: 'titulo',
      type: 'text',
      required: true,
      localized: true,
    },
    {
      name: 'descripcion',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'imagen',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'orden',
      type: 'number',
      required: true,
      defaultValue: 0,
    },
    {
      name: 'visible',
      type: 'checkbox',
      required: true,
      defaultValue: true,
    },
    seoField,
  ],
}
