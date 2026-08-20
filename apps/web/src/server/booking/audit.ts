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

import { bookingDb, type BookingDbClient } from './db/client'
import { bookingAuditLog } from './db/schema'

/**
 * Única puerta de escritura a `booking_audit_log` — mismo patrón exacto
 * que `server/auth/audit.ts` (Fase 3): construye la entrada con
 * `createRawAuditEntry`/`createRedactedAuditEntry`/`createEventAuditEntry`
 * (que ya validan contra `packages/contracts/src/audit.ts`) antes de
 * insertar, acepta una transacción `gapssa_booking` ya abierta para que la
 * fila de auditoría se confirme/revierta junto con la transición de
 * negocio que la origina.
 *
 * Alcance deliberado (encargo de Fase 4A, punto 8: "documentar qué eventos
 * pertenecen a Postgres y cuáles pertenecerán a EspoCRM"): SOLO se
 * auditan aquí transiciones de `BookingRequestRecord`/`PendingGuestIdentity`
 * (Postgres, propiedad del BFF). Las transiciones de `Meeting.cEstadoReserva`/
 * `status` (incluso en el adaptador simulado, `sim_espo_meetings`) NUNCA se
 * escriben en `booking_audit_log` — en producción esas viven en el log
 * nativo de EspoCRM, no en el nuestro (docs/contratos-portal-v1.md §3.2,
 * "Historial y auditoría"); duplicarlas aquí confundiría qué sistema es la
 * fuente de verdad de ese evento.
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

export async function recordRawBookingAuditEvent(
  input: CreateRawAuditEntryInput,
  dbOrTx: BookingDbClient = bookingDb,
): Promise<void> {
  const entry = createRawAuditEntry(input)
  await dbOrTx.insert(bookingAuditLog).values(toRow(entry))
}

export async function recordRedactedBookingAuditEvent(
  input: CreateRedactedAuditEntryInput,
  dbOrTx: BookingDbClient = bookingDb,
): Promise<void> {
  const entry = createRedactedAuditEntry(input)
  await dbOrTx.insert(bookingAuditLog).values(toRow(entry))
}

export async function recordEventBookingAuditEvent(
  input: CreateEventAuditEntryInput,
  dbOrTx: BookingDbClient = bookingDb,
): Promise<void> {
  const entry = createEventAuditEntry(input)
  await dbOrTx.insert(bookingAuditLog).values(toRow(entry))
}
