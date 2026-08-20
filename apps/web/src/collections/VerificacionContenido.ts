import type { CollectionConfig } from 'payload'

import { readPublishedOrStaff } from './access/content'
import { isAdmin, isAdminOrEditor } from './access/roles'

/**
 * Colección de verificación de Fase 1 — sigue sin modelar el catálogo real
 * de tratamientos (depende de decisiones de integración con EspoCRM
 * todavía no tomadas, docs/contratos-portal-v1.md). Solo demuestra que
 * Payload persiste en Postgres, que la localización funciona en los 6
 * idiomas configurados, y que el control de acceso por estado
 * publicado/borrador y por rol funciona de verdad — no solo en el papel.
 *
 * Control de acceso (endurecimiento):
 * - Lectura anónima: solo documentos con `_status = 'published'`.
 * - Los borradores nunca son legibles anónimamente (ni por REST ni por
 *   GraphQL: `readPublishedOrStaff` gobierna ambos).
 * - Crear/actualizar: admin o editor autenticados.
 * - Eliminar: **solo admin** — se decide no permitir borrado a editor en
 *   esta fase (mínimo privilegio por defecto); revisar si el flujo
 *   editorial real de Fase 2 lo necesita.
 * - Ninguna escritura anónima: la API pública nunca puede crear ni
 *   modificar contenido sin sesión interna.
 */
export const VerificacionContenido: CollectionConfig = {
  slug: 'verificacion-contenido',
  admin: {
    useAsTitle: 'titulo',
    description:
      'Verificación técnica de Fase 1 (persistencia, localización, control de acceso) — no es catálogo real.',
  },
  access: {
    read: readPublishedOrStaff,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'titulo',
      type: 'text',
      required: true,
      localized: true,
    },
  ],
}
