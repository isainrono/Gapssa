import type { CollectionConfig } from 'payload'

import { publicContentAccess } from './access/content'

/**
 * Selección manual de publicaciones de Instagram — nunca integración
 * automática (`PLAN_DESARROLLO_WEB_PORTAL.md` §16). Colección vacía a
 * propósito en el seed de Fase 2: la cuenta de Instagram definitiva de
 * Gapssa es todavía una decisión pendiente
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §21) — no se inventan URLs de posts de
 * una cuenta no confirmada. La sección pública de Instagram se omite por
 * completo mientras esta colección no tenga ningún documento visible.
 */
export const InstagramPosts: CollectionConfig = {
  slug: 'instagram-posts',
  admin: {
    useAsTitle: 'url',
    defaultColumns: ['imagen', 'url', 'visible', 'orden'],
  },
  access: publicContentAccess,
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'imagen',
      type: 'upload',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'texto',
      type: 'text',
      localized: true,
    },
    {
      name: 'url',
      type: 'text',
      required: true,
    },
    {
      name: 'fecha',
      type: 'date',
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
      defaultValue: false,
    },
  ],
}
