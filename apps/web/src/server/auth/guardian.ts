import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'

import { canAddGuardianLink, decideAccountAgeCategory, MAX_GUARDIANS_PER_MINOR } from '@gapssa/contracts'

import { recordEventAuditEvent } from './audit'
import { authDb } from './db/client'
import { clientAccounts, guardianLinks } from './db/schema'
import { findAccountByEmail, findAccountById } from './repository'

/**
 * Vínculos tutor–menor. `requestGuardianLink` necesita descartar la misma
 * carrera que `protectAdminRole.ts` resuelve para "último administrador",
 * pero con una diferencia importante: aquí el bloqueo **no puede** ir
 * sobre las filas de `guardian_links` en sí. `SELECT ... FOR UPDATE` solo
 * bloquea filas que ya existen y coinciden con el `WHERE` — con cero
 * vínculos previos (el caso exacto de un tercer/cuarto tutor compitiendo
 * por los primeros huecos), no hay ninguna fila que bloquear, así que
 * varias transacciones concurrentes pueden leer las cuatro "0 vínculos
 * vivos" a la vez y las cuatro insertar sin que ninguna espere a la otra
 * — confirmado con una prueba de concurrencia real que falló antes de
 * este bloqueo (`tests/integration/auth.guardianIndependence.int.test.ts`).
 *
 * La fila que sí existe siempre, para cualquier menor válido, es su
 * propia `client_accounts`. Bloquearla primero (`FOR UPDATE`) obliga a
 * cualquier otra transacción que quiera tocar vínculos del mismo menor a
 * esperar — ninguna dos solicitudes concurrentes para el mismo menor
 * pueden calcular el conteo a la vez. Solicitudes para menores distintos
 * siguen sin bloquearse entre sí, porque cada una bloquea una fila
 * distinta.
 *
 * El índice único parcial `guardian_links_unique_live_pair`
 * (`db/schema.ts`) es una segunda barrera, no la única: cubre "el mismo
 * tutor pide el vínculo dos veces", no el límite de dos tutores en sí.
 *
 * Revisión 2 de Fase 3: `requestGuardianLink` no comprobaba la edad de
 * ninguna de las dos cuentas — cualquier cuenta activa podía "vincularse"
 * a cualquier otra, en cualquier sentido. Ahora exige explícitamente que
 * quien solicita sea adulto y esté activo/verificado, y que el objetivo
 * sea menor y esté activo/verificado — y colapsa todos los motivos de
 * rechazo sobre el OBJETIVO (no encontrado, no es menor, no está
 * activo/verificado) en un único resultado genérico
 * (`invalid_target`): revelar el motivo exacto permitiría a un tutor ya
 * autenticado usar este endpoint para averiguar si un correo cualquiera
 * pertenece a una cuenta inexistente, adulta, o menor sin verificar —
 * enumeración exactamente como la que `PLAN_DESARROLLO_WEB_PORTAL.md`
 * §6.2 prohíbe, aplicada aquí a la edad/estado de un tercero.
 *
 * Revisión 3 de Fase 3: la revisión 2 comprobaba edad/estado de ambas
 * cuentas ANTES de abrir la transacción, y dentro de ella solo bloqueaba la
 * fila del menor (por la razón de arriba) sin volver a leerla — la decisión
 * de "es elegible" seguía basada en los datos obsoletos capturados antes
 * del bloqueo. Una suspensión, eliminación o cambio de edad concurrente
 * entre esa lectura y el `INSERT` final podía dejar creado un vínculo con
 * una cuenta que ya no cumplía las condiciones en el momento real de la
 * escritura. Ahora ambas cuentas se bloquean dentro de la transacción, en
 * un orden determinista por UUID (nunca "tutor primero, menor después") —
 * necesario porque dos solicitudes concurrentes pueden referenciar el
 * mismo par de cuentas en sentidos opuestos (p. ej. A pide vincular a B
 * como tutor mientras B pide vincular a A), y bloquear siempre en el mismo
 * orden absoluto es lo único que evita un interbloqueo ahí — y toda la
 * elegibilidad se vuelve a comprobar sobre la fila ya bloqueada, nunca
 * sobre la copia leída antes de la transacción.
 */

const LIVE_STATUSES = ['pending_minor_confirmation', 'active'] as const

export type GuardianLinkRequestOutcome =
  | { outcome: 'created'; linkId: string }
  | { outcome: 'max_guardians_reached' }
  | { outcome: 'duplicate_link' }
  | { outcome: 'self_link_not_allowed' }
  /** El propio solicitante no es una cuenta adulta, activa y verificada — información sobre sí mismo, nunca sobre un tercero. */
  | { outcome: 'requester_not_eligible' }
  /** Cuenta objetivo inexistente, no menor, o no activa/verificada — un único resultado genérico a propósito, ver el comentario superior. */
  | { outcome: 'invalid_target' }

export async function requestGuardianLink(
  guardianAccountId: string,
  minorEmail: string,
  now: Date,
): Promise<GuardianLinkRequestOutcome> {
  // Comprobación previa a la transacción: solo decide si existe siquiera
  // un candidato a bloquear (cuenta objetivo real, no autovínculo). Nunca
  // es la fuente de verdad de elegibilidad — eso se vuelve a comprobar más
  // abajo, bajo bloqueo, sobre datos frescos.
  const guardianAccountPreCheck = await findAccountById(guardianAccountId)
  if (!guardianAccountPreCheck) {
    return { outcome: 'requester_not_eligible' }
  }

  const minorAccountPreCheck = await findAccountByEmail(minorEmail)
  if (!minorAccountPreCheck) {
    return { outcome: 'invalid_target' }
  }
  if (guardianAccountId === minorAccountPreCheck.id) {
    // Sobre la propia cuenta del solicitante — no revela nada sobre un
    // tercero, puede quedar como resultado distinto sin riesgo de
    // enumeración.
    return { outcome: 'self_link_not_allowed' }
  }

  const minorAccountId = minorAccountPreCheck.id

  return authDb.transaction(async (tx) => {
    // Orden determinista de bloqueo por UUID — nunca "tutor primero, menor
    // después" — para que dos transacciones concurrentes que referencien el
    // mismo par de cuentas (en cualquier sentido) siempre pidan los
    // bloqueos en el mismo orden absoluto y ninguna pueda interbloquearse
    // con la otra.
    const [firstId, secondId] =
      guardianAccountId < minorAccountId ? [guardianAccountId, minorAccountId] : [minorAccountId, guardianAccountId]

    await tx.select({ id: clientAccounts.id }).from(clientAccounts).where(eq(clientAccounts.id, firstId)).for('update')
    await tx.select({ id: clientAccounts.id }).from(clientAccounts).where(eq(clientAccounts.id, secondId)).for('update')

    // Vuelve a leer ambas cuentas YA bloqueadas — nunca decide sobre la
    // copia obtenida antes de abrir la transacción, que puede haber
    // quedado obsoleta por una suspensión, eliminación o cambio de edad
    // concurrente.
    const [guardianAccount] = await tx.select().from(clientAccounts).where(eq(clientAccounts.id, guardianAccountId)).limit(1)
    const [minorAccount] = await tx.select().from(clientAccounts).where(eq(clientAccounts.id, minorAccountId)).limit(1)

    if (!guardianAccount || guardianAccount.status !== 'active' || guardianAccount.emailVerifiedAt === null) {
      return { outcome: 'requester_not_eligible' }
    }
    if (decideAccountAgeCategory(guardianAccount.dateOfBirth, now) !== 'adult') {
      return { outcome: 'requester_not_eligible' }
    }

    if (!minorAccount || minorAccount.status !== 'active' || minorAccount.emailVerifiedAt === null) {
      return { outcome: 'invalid_target' }
    }
    if (decideAccountAgeCategory(minorAccount.dateOfBirth, now) !== 'minor') {
      // Ni "vincular como menor una cuenta adulta" (aquí) ni "que una cuenta
      // menor actúe de tutor" (rechazado arriba, en el propio solicitante)
      // están permitidos — PLAN_DESARROLLO_WEB_PORTAL.md §10.
      return { outcome: 'invalid_target' }
    }

    const liveLinksForMinor = await tx
      .select({ id: guardianLinks.id, guardianAccountId: guardianLinks.guardianAccountId })
      .from(guardianLinks)
      .where(and(eq(guardianLinks.minorAccountId, minorAccount.id), inArray(guardianLinks.status, LIVE_STATUSES)))

    if (liveLinksForMinor.some((link) => link.guardianAccountId === guardianAccountId)) {
      return { outcome: 'duplicate_link' }
    }

    if (!canAddGuardianLink(liveLinksForMinor.length)) {
      return { outcome: 'max_guardians_reached' }
    }

    const [row] = await tx
      .insert(guardianLinks)
      .values({
        guardianAccountId,
        minorAccountId: minorAccount.id,
        status: 'pending_minor_confirmation',
        requestedBy: guardianAccountId,
      })
      .returning({ id: guardianLinks.id })

    if (!row) {
      throw new Error('No se pudo crear el vínculo tutor-menor.')
    }

    // Revisión 4 de Fase 3: auditoría atómica con la propia creación del
    // vínculo — antes se insertaba en la ruta HTTP, después del commit de
    // esta transacción (ver route.ts). El envío del correo de aviso
    // (`sendMail`, en la ruta) sigue fuera a propósito: un fallo de SMTP no
    // debe revertir la creación del vínculo ya persistida.
    await recordEventAuditEvent(
      {
        entity: 'GuardianLink',
        entityId: row.id,
        actor: { type: 'user', id: guardianAccountId },
        channel: 'web',
        occurredAt: now.toISOString(),
        reasonCode: 'GuardianLinkRequested',
      },
      tx,
    )

    return { outcome: 'created', linkId: row.id }
  })
}

export type GuardianLinkConfirmOutcome = 'confirmed' | 'not_found' | 'not_pending' | 'target_not_eligible'

/**
 * Solo el propio menor puede confirmar su vínculo — nunca el tutor, ni un
 * tercero (`minorAccountId` forma parte del propio `WHERE` de búsqueda).
 *
 * Revisión 2 de Fase 3: vuelve a comprobar en el momento de confirmar que
 * la cuenta objetivo sigue siendo menor y sigue activa — una solicitud
 * puede quedar `pending_minor_confirmation` mucho tiempo, y el joven pudo
 * cumplir 18 años mientras tanto (en ese caso existe una vía distinta,
 * independencia — un vínculo de tutela nuevo no debería poder
 * consolidarse sobre una cuenta que ya es adulta).
 *
 * Revisión 4 de Fase 3: el UPDATE que decide si la confirmación gana y su
 * auditoría se confirman en la misma transacción — nunca un vínculo activo
 * sin su entrada de auditoría duradera.
 *
 * Revisión 5 de Fase 3: hasta esta revisión, la lectura del vínculo y la
 * revalidación de la cuenta del menor ocurrían ANTES de abrir la
 * transacción, con datos no bloqueados — una suspensión o solicitud de
 * eliminación de la cuenta del menor entre esa lectura y el `UPDATE` final
 * podía dejar un vínculo `active` para una cuenta que, en el instante real
 * del commit, ya no era ni `active` ni estaba verificada. Ahora TODO vive
 * en una única transacción, en el mismo orden de bloqueo que
 * `requestGuardianLink` (cuentas antes que filas de `guardian_links` —
 * ninguna de las dos funciones bloquea nunca una fila de
 * `guardian_links` antes que la cuenta del menor, así que no pueden
 * interbloquearse entre sí):
 *
 * 1. bloquea la cuenta del menor (`SELECT ... FOR UPDATE`);
 * 2. bloquea la fila exacta de `guardian_links` (`id` + `minorAccountId`,
 *    comprobación de propiedad incluida en el propio `WHERE`);
 * 3. revalida, sobre la fila YA bloqueada de la cuenta: que sigue `active`,
 *    verificada (`emailVerifiedAt`) y sigue siendo menor en `now` —
 *    nunca sobre la instantánea leída antes de la transacción;
 * 4. solo entonces intenta la transición `pending_minor_confirmation ->
 *    active`, con la condición de estado en el propio `WHERE` del
 *    `UPDATE` (fuente de verdad de si la confirmación ganó, igual que
 *    antes).
 *
 * Invariante resultante: nunca puede existir un vínculo `active` cuyo
 * menor ya estuviera `suspended`/`pending_deletion` (o ya no fuera menor)
 * antes del commit — cualquier transición concurrente de la cuenta que
 * gane la carrera por el bloqueo de fila hace perder a esta función
 * (`target_not_eligible`), y cualquiera que la pierda ve el estado ya
 * actualizado al re-leer bajo bloqueo.
 */
export async function confirmGuardianLink(
  linkId: string,
  minorAccountId: string,
  now: Date,
): Promise<GuardianLinkConfirmOutcome> {
  return authDb.transaction(async (tx) => {
    // Orden de bloqueo coherente con requestGuardianLink: la cuenta se
    // bloquea antes que cualquier fila de guardian_links.
    await tx.select({ id: clientAccounts.id }).from(clientAccounts).where(eq(clientAccounts.id, minorAccountId)).for('update')

    const [link] = await tx
      .select({ id: guardianLinks.id })
      .from(guardianLinks)
      .where(and(eq(guardianLinks.id, linkId), eq(guardianLinks.minorAccountId, minorAccountId)))
      .limit(1)
      .for('update')

    if (!link) {
      return 'not_found'
    }

    // Vuelve a leer la cuenta YA bloqueada — nunca decide sobre ninguna
    // copia obtenida antes de abrir la transacción.
    const [minorAccount] = await tx.select().from(clientAccounts).where(eq(clientAccounts.id, minorAccountId)).limit(1)

    if (
      !minorAccount ||
      minorAccount.status !== 'active' ||
      minorAccount.emailVerifiedAt === null ||
      decideAccountAgeCategory(minorAccount.dateOfBirth, now) !== 'minor'
    ) {
      return 'target_not_eligible'
    }

    const result = await tx
      .update(guardianLinks)
      .set({ status: 'active', confirmedAt: now })
      .where(
        and(
          eq(guardianLinks.id, linkId),
          eq(guardianLinks.minorAccountId, minorAccountId),
          eq(guardianLinks.status, 'pending_minor_confirmation'),
        ),
      )
      .returning({ id: guardianLinks.id })

    if (result.length === 0) {
      return 'not_pending'
    }

    await recordEventAuditEvent(
      {
        entity: 'GuardianLink',
        entityId: linkId,
        actor: { type: 'user', id: minorAccountId },
        channel: 'web',
        occurredAt: now.toISOString(),
        reasonCode: 'GuardianLinkConfirmed',
      },
      tx,
    )

    return 'confirmed'
  })
}

export type GuardianLinkRevokeOutcome = 'revoked' | 'not_found' | 'not_live'

/**
 * El tutor o el propio menor pueden revocar el vínculo — nunca un
 * tercero. Revisión 2 de Fase 3: la transición pasa de "SELECT, comprobar
 * en Node, UPDATE incondicional" a un único `UPDATE ... WHERE status IN
 * (pending_minor_confirmation, active) ... RETURNING` — con el patrón
 * anterior, dos revocaciones concurrentes para el mismo vínculo podían
 * ganar las dos (ambas leían "está vivo" antes de que ninguna escribiera,
 * y el UPDATE final no comprobaba el estado), duplicando la auditoría de
 * una transición que solo debía registrarse una vez; y una confirmación
 * concurrente (`confirmGuardianLink`) podía perder su propia condición de
 * carrera frente a una revocación que se creía "está vivo" con datos ya
 * obsoletos. La condición de estado ahora vive en el propio `WHERE` del
 * `UPDATE`, la única operación que de verdad decide si la revocación gana.
 */
export async function revokeGuardianLink(
  linkId: string,
  actingAccountId: string,
  now: Date,
): Promise<GuardianLinkRevokeOutcome> {
  const [link] = await authDb.select().from(guardianLinks).where(eq(guardianLinks.id, linkId)).limit(1)

  if (!link) {
    return 'not_found'
  }
  if (link.guardianAccountId !== actingAccountId && link.minorAccountId !== actingAccountId) {
    return 'not_found'
  }

  // Revisión 4 de Fase 3: mismo razonamiento que confirmGuardianLink — el
  // UPDATE que decide si la revocación gana y su auditoría se confirman en
  // la misma transacción.
  return authDb.transaction(async (tx) => {
    const result = await tx
      .update(guardianLinks)
      .set({ status: 'revoked', revokedAt: now, revokedBy: actingAccountId })
      .where(and(eq(guardianLinks.id, linkId), inArray(guardianLinks.status, LIVE_STATUSES)))
      .returning({ id: guardianLinks.id })

    if (result.length === 0) {
      return 'not_live'
    }

    await recordEventAuditEvent(
      {
        entity: 'GuardianLink',
        entityId: linkId,
        actor: { type: 'user', id: actingAccountId },
        channel: 'web',
        occurredAt: now.toISOString(),
        reasonCode: 'GuardianLinkRevoked',
      },
      tx,
    )

    return 'revoked'
  })
}

export async function listGuardianLinksForMinor(minorAccountId: string) {
  return authDb.select().from(guardianLinks).where(eq(guardianLinks.minorAccountId, minorAccountId))
}

export async function listGuardianLinksForGuardian(guardianAccountId: string) {
  return authDb.select().from(guardianLinks).where(eq(guardianLinks.guardianAccountId, guardianAccountId))
}

export { MAX_GUARDIANS_PER_MINOR }
