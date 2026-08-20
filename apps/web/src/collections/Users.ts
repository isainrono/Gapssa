import type { CollectionConfig } from 'payload'

import { isAdmin, isAdminOrEditor, isAdminOrReadingSelf, onlyAdminCanSetField, USER_ROLES } from './access/roles'
import { preventLastAdminDeletion, protectAdminRoleOnChange } from './hooks/protectAdminRole'

/**
 * Usuarios internos de Payload (staff de Gapssa que entra en /admin) —
 * nunca los futuros clientes de /mi-cuenta (Fase 3), que serán una
 * colección aparte con su propio ciclo de vida y su propia base de datos
 * (`gapssa_auth`, no `gapssa_cms`).
 *
 * Control de acceso explícito (no se confía en los valores por defecto de
 * Payload, que dejarían la colección abierta a cualquier usuario
 * autenticado): ver `access/roles.ts` para el razonamiento de cada regla,
 * en particular por qué `read` admite "leer mi propia ficha" además de
 * "admin lee cualquiera" — verificado contra el código real de Payload
 * (`auth/operations/me.js` respeta `access.read`; sin esa excepción, un
 * editor autenticado aparecería como deslogueado en el propio panel).
 */
export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    // El propio Payload exige autenticación para /admin salvo cuando no
    // existe ningún usuario (bootstrap oficial, ver hooks/protectAdminRole.ts
    // y docs/contratos-portal-v1.md) — verificado en
    // node_modules/payload/dist/utilities/canAccessAdmin.js. `access.admin`
    // de abajo decide, una vez autenticado, quién puede entrar: admin y
    // editor, nunca un desconocido.
  },
  access: {
    // Cualquier usuario interno autenticado (admin o editor) puede entrar
    // al panel — la gestión de contenido de un editor también vive ahí.
    admin: isAdminOrEditor,
    // Bootstrap del primer usuario: Payload usa su propio endpoint interno
    // `/api/users/first-register` con `overrideAccess: true`
    // (`node_modules/payload/dist/auth/operations/registerFirstUser.js`),
    // que ignora esta regla por completo. `create` aquí gobierna
    // exclusivamente `POST /api/users` (y GraphQL) una vez que ya existe
    // algún usuario: siempre admin, sin excepción abierta.
    create: isAdmin,
    read: isAdminOrReadingSelf,
    update: isAdmin,
    delete: isAdmin,
  },
  auth: true,
  hooks: {
    beforeChange: [protectAdminRoleOnChange],
    beforeDelete: [preventLastAdminDeletion],
  },
  fields: [
    // El campo email lo añade Payload automáticamente con auth: true.
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: USER_ROLES.map((value) => ({ label: value, value })),
      access: {
        // Solo un admin puede fijar o cambiar el rol — un editor nunca
        // puede autoelevarse. La excepción del primer usuario (bootstrap)
        // no pasa por aquí: la fuerza `protectAdminRoleOnChange` con
        // `overrideAccess` implícito de Payload en `first-register`.
        create: onlyAdminCanSetField,
        update: onlyAdminCanSetField,
      },
      admin: {
        description: 'admin: gestiona usuarios y configuración. editor: gestiona contenido.',
      },
    },
  ],
  versions: false,
}
