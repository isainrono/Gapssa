import path from 'path'
import type { CollectionConfig } from 'payload'

import { isAdmin, isAdminOrEditor } from './access/roles'

const getMediaStaticDir = (): string => {
  const cwd = process.cwd()
  if (cwd.endsWith('apps/web')) {
    return path.resolve(cwd, 'media')
  }
  return path.resolve(cwd, 'apps/web/media')
}

/**
 * Activos de marketing (logo, fotos de tratamientos, galería, Instagram
 * manual) — Fase 2. Lectura pública deliberada: son imágenes que el sitio
 * público debe poder servir a cualquier visitante, no datos sensibles. No
 * confundir con el futuro volumen privado de fotografías de tratamiento de
 * clientes (`PLAN_DESARROLLO_WEB_PORTAL.md` §11), que es un sistema
 * completamente distinto y no forma parte de esta colección.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  upload: {
    staticDir: getMediaStaticDir(),
    mimeTypes: ['image/*'],
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 400, position: 'centre' },
      { name: 'card', width: 800, height: 800, position: 'centre' },
      { name: 'hero', width: 1920, height: undefined, position: 'centre' },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      localized: true,
      admin: {
        description:
          'Texto alternativo significativo. Para imágenes puramente decorativas, usa una descripción vacía únicamente cuando el componente que la use la trate explícitamente como decorativa (alt="").',
      },
    },
  ],
}
