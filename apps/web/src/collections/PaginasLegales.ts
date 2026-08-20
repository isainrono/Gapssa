import type { CollectionConfig } from 'payload'

import { publicContentAccess } from './access/content'

/** Los 4 tipos de página legal fijados por las rutas públicas de Fase 2. */
export const TIPOS_PAGINA_LEGAL = ['aviso-legal', 'privacidad', 'cookies', 'condiciones-reserva'] as const
export type TipoPaginaLegal = (typeof TIPOS_PAGINA_LEGAL)[number]

/**
 * Textos legales genéricos y provisionales (`PLAN_DESARROLLO_WEB_PORTAL.md`
 * §9, §11). `contenido` es texto plano (párrafos separados por línea en
 * blanco), no richText: mantiene el seed simple y evita depender del
 * renderizador de Lexical para un texto que de todos modos se marca como
 * provisional y pendiente de revisión legal real. `seoNoIndex` por
 * defecto `true` mientras `estado !== 'validado'` — una página legal
 * provisional nunca debe indexarse como si fuera definitiva.
 */
export const PaginasLegales: CollectionConfig = {
  slug: 'paginas-legales',
  admin: {
    useAsTitle: 'tipo',
    defaultColumns: ['tipo', 'estado', 'version', 'fecha'],
  },
  access: publicContentAccess,
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'tipo',
      type: 'select',
      required: true,
      unique: true,
      options: TIPOS_PAGINA_LEGAL.map((value) => ({ label: value, value })),
    },
    {
      name: 'titulo',
      type: 'text',
      required: true,
      localized: true,
    },
    {
      name: 'contenido',
      type: 'textarea',
      required: true,
      localized: true,
    },
    {
      name: 'version',
      type: 'text',
      required: true,
      defaultValue: '0.1',
    },
    {
      name: 'fecha',
      type: 'date',
      required: true,
    },
    {
      name: 'estado',
      type: 'select',
      required: true,
      defaultValue: 'provisional',
      options: [
        { label: 'Provisional', value: 'provisional' },
        { label: 'Validado', value: 'validado' },
      ],
    },
    {
      name: 'seoNoIndex',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        description: 'Se recomienda mantener activo mientras el estado sea "provisional".',
      },
    },
  ],
}
