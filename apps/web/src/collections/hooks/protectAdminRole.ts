import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { sql } from 'drizzle-orm'
import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook, Where } from 'payload'
import { APIError } from 'payload'

/**
 * Protecciones del rol `admin` en la colección `users`. Verificadas contra
 * `node_modules/payload/dist/collections/config/types.d.ts` (firmas de
 * `BeforeChangeHook`/`BeforeDeleteHook`) y `node_modules/payload/dist/errors/APIError.d.ts`
 * (para devolver un estado HTTP correcto, no un 500 genérico).
 *
 * ## La carrera del último administrador, y por qué un `count` normal no basta
 *
 * `protectAdminRoleOnChange`/`preventLastAdminDeletion` necesitan saber
 * "¿queda algún otro admin?" antes de dejar pasar un cambio. Un
 * `payload.count(...)` normal, aunque se ejecute dentro de la misma
 * transacción que el resto del hook (`req` la lleva encadenada), sigue
 * siendo una lectura MVCC en aislamiento READ COMMITTED (el nivel por
 * defecto de Postgres, que este proyecto no cambia): dos peticiones
 * concurrentes que degradan/eliminan a dos administradores distintos a la
 * vez pueden leer las dos "queda 1 admin más" **antes** de que ninguna
 * confirme, y las dos seguir adelante — resultado: cero administradores,
 * aunque cada comprobación individual fuera correcta en el instante en que
 * se ejecutó. Ejecutar la comprobación "dentro de la misma transacción" no
 * arregla esto por sí solo: hace falta además un bloqueo real a nivel de
 * fila.
 *
 * `lockAdminRowsForUpdate` toma ese bloqueo con `SELECT ... FOR UPDATE`
 * (Postgres, patrón estándar, no un truco de esta app) sobre todas las
 * filas `role = 'admin'` actuales, dentro de la transacción real de la
 * petición (`req.transactionID`, que Payload abre automáticamente para
 * `update`/`delete` — ver `node_modules/payload/dist/collections/operations/updateByID.js`
 * y `deleteByID.js`, `initTransaction(req)`). Si dos peticiones compiten,
 * la segunda bloquea en este `SELECT` hasta que la primera confirme o
 * revierta; Postgres, al desbloquearla, le hace releer las filas ya
 * actualizadas (comportamiento documentado de READ COMMITTED para
 * sentencias que bloquean sobre una fila recién modificada) — así el
 * conteo posterior ve siempre el estado real, nunca uno obsoleto.
 * `ORDER BY id` fija un orden de bloqueo consistente entre peticiones para
 * que nunca puedan interbloquearse esperándose la una a la otra.
 *
 * `adapter.sessions`/`adapter.drizzle` (tipo `PostgresAdapter`, exportado
 * públicamente desde `@payloadcms/db-postgres` — no es un campo interno
 * sin tipar) son la misma sesión de Drizzle que usa internamente
 * `@payloadcms/drizzle` (`utilities/getTransaction.js`) para atar
 * cualquier lectura/escritura a la transacción en curso; este hook
 * reproduce exactamente ese mecanismo, no uno inventado.
 *
 * Cubierto por una prueba de concurrencia real en
 * `tests/integration/hardening.int.test.ts` ("dos peticiones concurrentes
 * degradando a los dos únicos administradores a la vez, como mucho una
 * gana"), no solo por argumento — ver PROJECT_CONTEXT/docs para el
 * requisito de que esta protección tenga una prueba, no una promesa.
 *
 * Límite conocido, documentado a propósito en vez de asumido: esta
 * garantía depende de que la operación de Payload abra transacción
 * (`initTransaction`, el comportamiento por defecto de `update`/`delete`
 * en este proyecto — nadie llama a estas operaciones con
 * `disableTransaction: true`). Si en el futuro algo llamara a estos hooks
 * fuera de una transacción real, `lockAdminRowsForUpdate` cae de vuelta a
 * `adapter.drizzle` (la conexión no transaccional) y el `FOR UPDATE` solo
 * dura el tiempo de esa sentencia suelta — sin protección real. Revisar
 * esta ficha antes de producción si esa vía llega a existir.
 */

async function lockAdminRowsForUpdate(req: Parameters<CollectionBeforeChangeHook>[0]['req']): Promise<void> {
  const adapter = req.payload.db as unknown as PostgresAdapter
  const transactionID = req.transactionID ? await req.transactionID : undefined
  const db = (transactionID !== undefined ? adapter.sessions[String(transactionID)]?.db : undefined) ?? adapter.drizzle

  await db.execute(sql`SELECT id FROM "users" WHERE role = 'admin' ORDER BY id FOR UPDATE`)
}

async function countOtherAdmins(
  req: Parameters<CollectionBeforeChangeHook>[0]['req'],
  excludeId: number | string | undefined,
): Promise<number> {
  const where: Where = excludeId
    ? { and: [{ role: { equals: 'admin' } }, { id: { not_equals: excludeId } }] }
    : { role: { equals: 'admin' } }

  const result = await req.payload.count({ collection: 'users', req, where })
  return result.totalDocs
}

/**
 * - En la creación del primer usuario del sistema (bootstrap oficial vía
 *   `/api/users/first-register`, ver docs/contratos-portal-v1.md), fuerza
 *   `role = 'admin'` sin importar lo que el formulario haya enviado: así el
 *   bootstrap nunca puede dejar al primer usuario como 'editor' por error.
 * - En una actualización, impide quitarle el rol `admin` al último
 *   administrador restante.
 */
export const protectAdminRoleOnChange: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation === 'create') {
    const existing = await req.payload.count({ collection: 'users', req })
    if (existing.totalDocs === 0) {
      return { ...data, role: 'admin' }
    }
    return data
  }

  const wasAdmin = originalDoc?.role === 'admin'
  const willRemainAdmin = data.role === undefined || data.role === 'admin'

  if (wasAdmin && !willRemainAdmin) {
    await lockAdminRowsForUpdate(req)
    const remaining = await countOtherAdmins(req, originalDoc?.id)
    if (remaining === 0) {
      throw new APIError(
        'No se puede quitar el rol admin al último administrador del sistema.',
        403,
        undefined,
        true,
      )
    }
  }

  return data
}

/** Impide eliminar al último administrador del sistema. */
export const preventLastAdminDeletion: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const doc = await req.payload.findByID({
    id,
    collection: 'users',
    overrideAccess: true,
    req,
  })

  if (doc?.role === 'admin') {
    await lockAdminRowsForUpdate(req)
    const remaining = await countOtherAdmins(req, id)
    if (remaining === 0) {
      throw new APIError(
        'No se puede eliminar al último administrador del sistema.',
        403,
        undefined,
        true,
      )
    }
  }
}
