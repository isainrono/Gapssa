import type { CollectionConfig } from 'payload'

import { publicContentAccess } from './access/content'
import { seoField } from './fields/seo'

/**
 * Contenido comercial de tratamientos (Fase 2). Deliberadamente **sin**
 * precio ni duración: esos datos pertenecen a EspoCRM/FacturaScripts
 * (`PROJECT_CONTEXT.md` §11, `PLAN_DESARROLLO_WEB_PORTAL.md` §5.3). Solo
 * `indicadorPrecio` (cerrado) permite mostrar "Consultar" o "Precio
 * pendiente" — nunca un importe. `externalEspocrmId` queda preparado para
 * la futura vinculación (Fase 4+) pero no se usa todavía en ninguna
 * consulta.
 *
 * `slug` y `familia` no están localizados: deben mantenerse estables entre
 * idiomas (mismo razonamiento que `FamiliasTratamiento`).
 */
export const Tratamientos: CollectionConfig = {
  slug: 'tratamientos',
  admin: {
    useAsTitle: 'slug',
    defaultColumns: ['slug', 'familia', 'visible', 'destacado', 'orden'],
  },
  access: publicContentAccess,
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'externalEspocrmId',
      type: 'text',
      admin: {
        description:
          'Reservado para la futura vinculación con CTratamiento en EspoCRM (Fase 4+). No usado todavía.',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Identificador estable, igual en los 6 idiomas.',
      },
    },
    {
      name: 'familia',
      type: 'relationship',
      relationTo: 'familias-tratamiento',
      required: true,
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
      name: 'beneficios',
      type: 'array',
      labels: { singular: 'Beneficio', plural: 'Beneficios' },
      fields: [
        {
          name: 'texto',
          type: 'text',
          // No `required`: un campo localizado obligatorio fuerza a que
          // CADA idioma tenga valor propio en el momento de guardar esa
          // locale (el `fallback: true` de Payload solo actúa en lectura,
          // nunca exime la validación de escritura) — con eso, traducir
          // progresivamente (seed en español primero, el resto después)
          // sería imposible sin escribir un valor en los 6 idiomas a la vez.
          localized: true,
        },
      ],
    },
    {
      name: 'requisitosContraindicaciones',
      type: 'textarea',
      localized: true,
      admin: {
        description:
          'Requisitos previos o contraindicaciones GENERALES (nunca afirmaciones clínicas ni contraindicaciones médicas específicas — PROJECT_CONTEXT.md §6).',
      },
    },
    {
      name: 'preguntasFrecuentes',
      type: 'array',
      labels: { singular: 'Pregunta frecuente', plural: 'Preguntas frecuentes' },
      fields: [
        {
          name: 'pregunta',
          type: 'text',
          // Sin `required` por el mismo motivo que `beneficios.texto`
          // (ver más arriba): permite traducción progresiva por idioma.
          localized: true,
        },
        {
          name: 'respuesta',
          type: 'textarea',
          localized: true,
        },
      ],
    },
    {
      name: 'imagenes',
      type: 'upload',
      relationTo: 'media',
      hasMany: true,
    },
    {
      name: 'indicadorPrecio',
      type: 'select',
      required: true,
      defaultValue: 'consultar',
      options: [
        { label: 'Consultar', value: 'consultar' },
        { label: 'Precio pendiente', value: 'pendiente' },
        { label: 'Oculto', value: 'oculto' },
      ],
      admin: {
        description:
          'Nunca un importe: FacturaScripts es la futura fuente de verdad del precio (PROJECT_CONTEXT.md §11).',
      },
    },
    {
      name: 'visible',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      admin: {
        description: 'Además de publicar el documento, debe marcarse visible para aparecer en el catálogo público.',
      },
    },
    {
      name: 'destacado',
      type: 'checkbox',
      required: true,
      defaultValue: false,
    },
    {
      name: 'orden',
      type: 'number',
      required: true,
      defaultValue: 0,
    },
    seoField,
  ],
}
