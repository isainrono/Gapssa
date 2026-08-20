import type { GlobalConfig } from 'payload'

import { isAdminOrEditor } from '../collections/access/roles'

export const DIAS_SEMANA = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
] as const
export type DiaSemana = (typeof DIAS_SEMANA)[number]

/**
 * Ajustes globales del sitio público (Fase 2). `contacto` y
 * `redesSociales` se dejan vacíos a propósito en el seed: teléfono,
 * WhatsApp, correo público y cuenta de Instagram son decisiones
 * pendientes (`PLAN_DESARROLLO_WEB_PORTAL.md` §21) y deben permanecer
 * ocultos en la web mientras no estén rellenos desde /admin
 * (`src/lib/content/ajustesGlobales.ts` decide la visibilidad, nunca el
 * componente de presentación directamente).
 *
 * Lectura pública (sin ella, cabecera/pie de página no podrían
 * renderizarse para un visitante anónimo); escritura solo admin/editor.
 * Sin `versions.drafts`: es configuración operativa, no contenido
 * editorial con flujo de borrador.
 */
export const AjustesGlobales: GlobalConfig = {
  slug: 'ajustes-globales',
  access: {
    read: () => true,
    update: isAdminOrEditor,
  },
  fields: [
    {
      name: 'nombreComercial',
      type: 'text',
      required: true,
      defaultValue: 'GAPSSA by Nana',
    },
    {
      name: 'logo',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'direccion',
      type: 'group',
      fields: [
        { name: 'calle', type: 'text' },
        { name: 'ciudad', type: 'text' },
        { name: 'codigoPostal', type: 'text' },
        { name: 'pais', type: 'text', defaultValue: 'España' },
      ],
    },
    {
      name: 'horario',
      type: 'array',
      labels: { singular: 'Día', plural: 'Horario' },
      fields: [
        {
          name: 'dia',
          type: 'select',
          required: true,
          options: DIAS_SEMANA.map((value) => ({ label: value, value })),
        },
        {
          name: 'cerrado',
          type: 'checkbox',
          required: true,
          defaultValue: false,
        },
        {
          name: 'franja',
          type: 'text',
          admin: {
            description: 'Ej. "09:00–21:00". Vacío si el día está cerrado.',
            condition: (_, siblingData) => !siblingData?.cerrado,
          },
        },
      ],
    },
    {
      name: 'contacto',
      type: 'group',
      admin: {
        description: 'Todos opcionales. La web los oculta mientras estén vacíos — no se rellenan hasta confirmarlos.',
      },
      fields: [
        { name: 'telefono', type: 'text' },
        { name: 'whatsapp', type: 'text' },
        { name: 'correoPublico', type: 'email' },
      ],
    },
    {
      name: 'redesSociales',
      type: 'array',
      labels: { singular: 'Red social', plural: 'Redes sociales' },
      fields: [
        {
          name: 'plataforma',
          type: 'select',
          required: true,
          options: [
            { label: 'Instagram', value: 'instagram' },
            { label: 'Facebook', value: 'facebook' },
            { label: 'TikTok', value: 'tiktok' },
          ],
        },
        { name: 'url', type: 'text', required: true },
      ],
    },
    {
      name: 'ctaPrincipal',
      type: 'group',
      fields: [
        {
          name: 'texto',
          type: 'text',
          localized: true,
        },
        {
          name: 'ruta',
          type: 'select',
          defaultValue: 'reservar',
          options: [
            { label: 'Reservar', value: 'reservar' },
            { label: 'Contacto', value: 'contacto' },
          ],
        },
      ],
    },
    {
      name: 'seoPorDefecto',
      type: 'group',
      fields: [
        { name: 'titulo', type: 'text', localized: true },
        { name: 'descripcion', type: 'textarea', localized: true },
        { name: 'ogImage', type: 'upload', relationTo: 'media' },
      ],
    },
  ],
}
