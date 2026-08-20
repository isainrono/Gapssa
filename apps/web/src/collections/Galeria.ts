import type { CollectionConfig } from 'payload'

import { publicContentAccess } from './access/content'

export const Galeria: CollectionConfig = {
  slug: 'galeria',
  admin: {
    useAsTitle: 'categoria',
    defaultColumns: ['imagen', 'categoria', 'visible', 'orden'],
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
      name: 'alt',
      type: 'text',
      required: true,
      localized: true,
    },
    {
      name: 'categoria',
      type: 'text',
      localized: true,
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
