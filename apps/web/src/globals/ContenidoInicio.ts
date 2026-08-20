import type { GlobalConfig } from 'payload'

import { isAdminOrEditor } from '../collections/access/roles'

/** Textos editoriales propios de la portada (hero + transiciones a cada sección teaser). */
export const ContenidoInicio: GlobalConfig = {
  slug: 'contenido-inicio',
  access: {
    read: () => true,
    update: isAdminOrEditor,
  },
  fields: [
    {
      name: 'heroTitulo',
      type: 'textarea',
      required: true,
      localized: true,
      admin: {
        description: 'Admite varias líneas — se muestran tal cual en el titular del hero.',
      },
    },
    {
      name: 'heroSubtitulo',
      type: 'text',
      localized: true,
    },
    {
      name: 'heroImagen',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'introQuienSoy',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'introFamilias',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'introContacto',
      type: 'textarea',
      localized: true,
    },
  ],
}
