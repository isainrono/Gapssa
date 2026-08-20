import type { Access, AccessArgs, FieldAccess } from 'payload'

/**
 * `access.admin` (¿puede entrar al panel?) exige estrictamente
 * `boolean | Promise<boolean>` — a diferencia de `Access`, que también
 * admite devolver un `Where` para filtrar listados. `isAdmin`/
 * `isAdminOrEditor` nunca filtran una lista, así que se tipan aparte
 * (siguen siendo asignables donde se espera `Access`, por covarianza del
 * tipo de retorno: siempre devuelven `boolean`, un subconjunto válido de
 * `boolean | Where`).
 */
type BooleanAccess = (args: AccessArgs) => boolean | Promise<boolean>

/**
 * Roles cerrados de los usuarios internos de Payload (staff de Gapssa que
 * entra en /admin). No confundir con los futuros clientes del portal
 * (/mi-cuenta, Fase 3): esos serán una colección aparte, nunca esta.
 *
 * - admin: gestiona usuarios y configuración sensible.
 * - editor: gestiona contenido, nunca usuarios ni configuración sensible.
 */
export const USER_ROLES = ['admin', 'editor'] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * `role` se tipa como `unknown`, no `string`, a propósito: viene de un
 * documento de Payload/Postgres que puede estar corrupto, ser antiguo (de
 * antes de que `role` fuera `required`), o venir de un cliente que
 * construye `req.user` a mano en un test. Si se tipara `role?: string`,
 * un valor real `null`/`''`/un objeto seguiría pasando el chequeo de
 * TypeScript sin que ningún helper lo rechazara en runtime.
 */
type MinimalAuthUser = {
  collection?: string
  id?: number | string
  role?: unknown
}

function authenticatedUser(req: { user?: MinimalAuthUser | null }): MinimalAuthUser | null {
  if (!req.user || req.user.collection !== 'users') {
    return null
  }
  return req.user
}

/** true solo si `role` es exactamente uno de los valores cerrados de `USER_ROLES`. */
function hasKnownRole(user: MinimalAuthUser | null): user is MinimalAuthUser & { role: UserRole } {
  return user !== null && (USER_ROLES as readonly unknown[]).includes(user.role)
}

/** true solo para un usuario de `users` autenticado con role === 'admin'. */
export const isAdmin: BooleanAccess = ({ req }) => authenticatedUser(req)?.role === 'admin'

/**
 * true solo para un usuario de `users` autenticado cuyo `role` sea
 * exactamente 'admin' o 'editor' — nunca para `role` undefined, null,
 * vacío, o cualquier valor fuera de `USER_ROLES` (documento antiguo o
 * corrupto). Antes de este endurecimiento bastaba con estar autenticado
 * en `users`, sin importar el `role`: un documento sin `role` válido
 * entraba igual al panel.
 */
export const isAdminOrEditor: BooleanAccess = ({ req }) => hasKnownRole(authenticatedUser(req))

/**
 * Acceso de lectura de la propia colección `users`: un admin puede leer
 * cualquier ficha; un editor solo puede leer la suya (necesario para que
 * `/api/users/me` — que sí respeta `access.read`, verificado contra el
 * código de Payload instalado — no rompa el panel para editores). Nunca
 * permite a un editor enumerar o leer fichas de otras personas. Un usuario
 * autenticado sin `role` válido (undefined, null, vacío, desconocido) no
 * pasa `hasKnownRole` y se rechaza aquí también, ni siquiera para su
 * propia ficha: el mismo criterio cerrado que `isAdminOrEditor`, no una
 * versión más permisiva de "autenticado" para lectura.
 */
export const isAdminOrReadingSelf: Access = ({ req, id }) => {
  const user = authenticatedUser(req)
  if (!hasKnownRole(user)) {
    return false
  }
  if (user.role === 'admin') {
    return true
  }
  if (id !== undefined) {
    return user.id === id
  }
  return { id: { equals: user.id ?? '' } }
}

/** Campo `role`: solo un admin autenticado puede fijarlo o cambiarlo. */
export const onlyAdminCanSetField: FieldAccess = ({ req }) => authenticatedUser(req)?.role === 'admin'
