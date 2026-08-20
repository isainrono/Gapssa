import 'server-only'

import {
  createEventAuditEntry,
  createRawAuditEntry,
  createRedactedAuditEntry,
  type AuditEntry,
  type CreateEventAuditEntryInput,
  type CreateRawAuditEntryInput,
  type CreateRedactedAuditEntryInput,
} from '@gapssa/contracts'

import { authDb, type AuthDbClient } from './db/client'
import { authAuditLog } from './db/schema'

/**
 * Única puerta de escritura a `auth_audit_log`. Construye la entrada con
 * `createRawAuditEntry`/`createRedactedAuditEntry`
 * (`packages/contracts/src/audit.ts`) — que ya lanza `AuditPolicyError` si
 * el valor no pertenece al dominio cerrado del campo o si `redactedValue`
 * no tiene el formato validado — antes de insertar; nunca se construye una
 * fila a mano sin pasar por esa validación (mismo principio que
 * `docs/contratos-portal-v1.md` §7.3).
 *
 * Revisión 4 de Fase 3: las tres funciones aceptan un segundo parámetro
 * opcional `dbOrTx` — por defecto `authDb` (el comportamiento de siempre,
 * para eventos que legítimamente no forman parte de otra transacción, p.
 * ej. login/logout). Cuando el llamante ya tiene una transacción Drizzle
 * abierta para la transición de negocio que motiva el evento (activación de
 * cuenta, independencia, eliminación, tutela, revocación de sesión...),
 * debe pasarla aquí para que la fila de auditoría se confirme (o se
 * revierta) en el mismo commit que esa transición — nunca una escritura
 * separada después. Si `createRawAuditEntry`/`createRedactedAuditEntry`/
 * `createEventAuditEntry` lanzan `AuditPolicyError` (entrada inválida), o si
 * el propio `INSERT` falla, y `dbOrTx` es una transacción activa, la
 * excepción no capturada revierte TODO lo que esa transacción hubiera
 * escrito — negocio y auditoría se confirman juntos o ninguno, sin
 * importar en qué orden se llamó a cada `tx.update`/`tx.insert` dentro del
 * mismo bloque (ver repository.ts/guardian.ts/session.ts/outbox.ts).
 */

function toRow(entry: AuditEntry) {
  const base = {
    entity: entry.entity,
    entityId: entry.entityId,
    actorType: entry.actor.type,
    actorId: entry.actor.type === 'user' ? entry.actor.id : entry.actor.type === 'guest' ? entry.actor.guestId : null,
    actorSystemName: entry.actor.type === 'system' ? entry.actor.name : null,
    channel: entry.channel,
    occurredAt: new Date(entry.occurredAt),
    reasonCode: entry.reasonCode ?? null,
  }

  if (entry.valueRepresentation === 'raw') {
    return {
      ...base,
      valueRepresentation: 'raw' as const,
      field: entry.field,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      redactedAlgorithm: null,
      redactedDigest: null,
      redactedChangeKind: null,
    }
  }

  if (entry.valueRepresentation === 'redacted') {
    return {
      ...base,
      valueRepresentation: 'redacted' as const,
      field: entry.field ?? null,
      previousValue: null,
      newValue: null,
      redactedAlgorithm: entry.redactedValue.algorithm,
      redactedDigest: entry.redactedValue.digest,
      redactedChangeKind: entry.redactedValue.changeKind,
    }
  }

  return {
    ...base,
    valueRepresentation: 'event' as const,
    field: null,
    previousValue: null,
    newValue: null,
    redactedAlgorithm: null,
    redactedDigest: null,
    redactedChangeKind: null,
  }
}

export async function recordRawAuditEvent(
  input: CreateRawAuditEntryInput,
  dbOrTx: AuthDbClient = authDb,
): Promise<void> {
  const entry = createRawAuditEntry(input)
  await dbOrTx.insert(authAuditLog).values(toRow(entry))
}

export async function recordRedactedAuditEvent(
  input: CreateRedactedAuditEntryInput,
  dbOrTx: AuthDbClient = authDb,
): Promise<void> {
  const entry = createRedactedAuditEntry(input)
  await dbOrTx.insert(authAuditLog).values(toRow(entry))
}

/**
 * Para hechos auditables sin una transición de campo real — un login
 * correcto o fallido, un cierre de sesión, un bloqueo por límite de
 * frecuencia (`EventAuditEntry`, `packages/contracts/src/audit.ts`).
 */
export async function recordEventAuditEvent(
  input: CreateEventAuditEntryInput,
  dbOrTx: AuthDbClient = authDb,
): Promise<void> {
  const entry = createEventAuditEntry(input)
  await dbOrTx.insert(authAuditLog).values(toRow(entry))
}
