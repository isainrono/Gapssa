import type { CollectionConfig } from 'payload'

import { publicContentAccess } from './access/content'
import { requireAutorizacionParaPublicar } from './hooks/testimonioAuthorization'

/**
 * Testimonios anonimizados (`PLAN_DESARROLLO_WEB_PORTAL.md` §5.2,
 * `PROJECT_CONTEXT.md` §7.3 sobre permisos separados de uso promocional).
 * `autorizacionRegistrada` es solo un indicador interno de que existe
 * autorización de uso — nunca adjunta el documento de autorización en sí
 * (eso, si algún día se digitaliza, vive en el sistema de consentimientos
 * de EspoCRM, no aquí).
 *
 * `requireAutorizacionParaPublicar` (revisión 2 de Fase 2) impide publicar
 * (`_status: 'published'`) o marcar `visible: true` sin
 * `autorizacionRegistrada: true` — hasta ahora esto dependía solo de que
 * quien editara se acordara de no hacerlo.
 */
export const Testimonios: CollectionConfig = {
  slug: 'testimonios',
  admin: {
    useAsTitle: 'autor',
    defaultColumns: ['autor', 'visible', 'autorizacionRegistrada', 'orden'],
  },
  access: publicContentAccess,
  versions: {
    drafts: true,
  },
  hooks: {
    beforeChange: [requireAutorizacionParaPublicar],
  },
  fields: [
    {
      name: 'texto',
      type: 'textarea',
      required: true,
      localized: true,
    },
    {
      name: 'autor',
      type: 'text',
      required: true,
      localized: true,
      admin: {
        description: 'Solo nombre e inicial del apellido (ej. "María G."). Nunca el apellido completo.',
      },
    },
    {
      name: 'visible',
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
    {
      name: 'autorizacionRegistrada',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      admin: {
        description: 'Indicador interno de que existe autorización de uso promocional. No es el documento en sí.',
      },
    },
  ],
}
