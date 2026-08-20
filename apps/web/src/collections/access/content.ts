import type { Access, CollectionConfig } from 'payload'

import { isAdmin, isAdminOrEditor } from './roles'

/**
 * Lectura pública solo de documentos publicados (`_status: 'published'`,
 * mecanismo oficial de borradores de Payload —
 * `versions.drafts`, ver `node_modules/payload/dist/versions/types.d.ts` —
 * en vez de un campo de estado hecho a mano). El staff (admin o editor)
 * autenticado ve también los borradores: los necesita para poder editarlos
 * desde /admin.
 */
export const readPublishedOrStaff: Access = async (args) => {
  if (await isAdminOrEditor(args)) {
    return true
  }
  return { _status: { equals: 'published' } }
}

/**
 * Patrón de acceso compartido por todas las colecciones de contenido
 * público de Fase 2 (familias, tratamientos, testimonios, galería,
 * Instagram manual, páginas legales): lectura anónima solo de lo
 * publicado, creación/edición por admin o editor, borrado solo por admin
 * (mínimo privilegio, igual que `VerificacionContenido`).
 */
export const publicContentAccess: CollectionConfig['access'] = {
  read: readPublishedOrStaff,
  create: isAdminOrEditor,
  update: isAdminOrEditor,
  delete: isAdmin,
}
