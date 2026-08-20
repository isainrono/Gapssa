import type { GlobalConfig } from 'payload'

import { isAdminOrEditor } from '../collections/access/roles'

export const ICONOS_DIFERENCIADOR = [
  'atencion-personalizada',
  'productos-premium',
  'experiencia-avalada',
  'cuidado-con-carino',
  'resultados-naturales',
  'seguimiento-individual',
] as const
export type IconoDiferenciador = (typeof ICONOS_DIFERENCIADOR)[number]

/**
 * Contenido de "Sobre Gapssa / Diana": biografía, proceso de atención y
 * diferenciadores. `estadisticas` se deja vacío por defecto a propósito —
 * los números de la maqueta ("+500 clientas", "5+ años") no están
 * verificados por Gapssa; el array solo se rellena desde /admin cuando
 * haya una cifra confirmada (PROJECT_CONTEXT.md: no inventar hechos).
 */
export const ContenidoSobreGapssa: GlobalConfig = {
  slug: 'contenido-sobre-gapssa',
  access: {
    read: () => true,
    update: isAdminOrEditor,
  },
  fields: [
    {
      name: 'bioTitulo',
      type: 'text',
      localized: true,
    },
    {
      name: 'bioTexto',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'bioCita',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'bioBullets',
      type: 'array',
      labels: { singular: 'Punto', plural: 'Puntos de formación' },
      fields: [{ name: 'texto', type: 'text', required: true, localized: true }],
    },
    {
      name: 'bioImagen',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'proceso',
      type: 'array',
      labels: { singular: 'Paso', plural: 'Pasos del proceso' },
      fields: [
        { name: 'numero', type: 'number', required: true },
        { name: 'titulo', type: 'text', required: true, localized: true },
        { name: 'descripcion', type: 'textarea', required: true, localized: true },
      ],
    },
    {
      name: 'diferenciadores',
      type: 'array',
      labels: { singular: 'Diferenciador', plural: 'Diferenciadores' },
      fields: [
        {
          name: 'iconoClave',
          type: 'select',
          required: true,
          options: ICONOS_DIFERENCIADOR.map((value) => ({ label: value, value })),
        },
        { name: 'titulo', type: 'text', required: true, localized: true },
        { name: 'descripcion', type: 'textarea', required: true, localized: true },
      ],
    },
    {
      name: 'estadisticas',
      type: 'array',
      labels: { singular: 'Estadística', plural: 'Estadísticas' },
      admin: {
        description: 'Vacío por defecto. Solo añadir cifras confirmadas por Gapssa, nunca estimaciones.',
      },
      fields: [
        { name: 'valor', type: 'text', required: true },
        { name: 'etiqueta', type: 'text', required: true, localized: true },
      ],
    },
  ],
}
