import { Client } from 'pg'
import { inject } from 'vitest'

/** Conexión directa de solo-lectura/aserción a `gapssa_booking_test_<random>` — nunca a `gapssa_booking` real. Mismo patrón que `authDb.ts` (Fase 3). */
export async function withBookingDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: inject('integrationBookingDatabaseUrl') })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function findBookingRequestRow(id: string): Promise<Record<string, unknown> | null> {
  return withBookingDb(async (client) => {
    const result = await client.query('select * from booking_request_records where id = $1', [id])
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

export async function findBookingRequestByIdempotencyKey(
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  return withBookingDb(async (client) => {
    const result = await client.query('select * from booking_request_records where idempotency_key = $1', [
      idempotencyKey,
    ])
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

export async function findPendingGuestIdentityRow(bookingRequestId: string): Promise<Record<string, unknown> | null> {
  return withBookingDb(async (client) => {
    const result = await client.query('select * from pending_guest_identities where booking_request_id = $1', [
      bookingRequestId,
    ])
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

export async function findSimEspoMeetingByBookingRequestId(
  bookingRequestId: string,
): Promise<Record<string, unknown> | null> {
  return withBookingDb(async (client) => {
    const result = await client.query('select * from sim_espo_meetings where booking_request_id = $1', [
      bookingRequestId,
    ])
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

export async function countSimEspoContactsByEmail(email: string): Promise<number> {
  return withBookingDb(async (client) => {
    const result = await client.query('select count(*)::int as count from sim_espo_contacts where email = $1', [
      email,
    ])
    return (result.rows[0] as { count: number }).count
  })
}

export async function countSimEspoMeetings(): Promise<number> {
  return withBookingDb(async (client) => {
    const result = await client.query('select count(*)::int as count from sim_espo_meetings')
    return (result.rows[0] as { count: number }).count
  })
}

/** Fase 4B, revisión 2 — inserta un Contact simulado directamente, sin pasar por `findOrCreateContact`, para construir escenarios de ambigüedad deterministas en las pruebas. */
export async function insertSimEspoContactForTesting(input: {
  firstName: string
  lastName: string
  email: string
  phone: string
  gapssaAccountId?: string | null
}): Promise<string> {
  return withBookingDb(async (client) => {
    const result = await client.query(
      'insert into sim_espo_contacts (first_name, last_name, email, phone, gapssa_account_id) values ($1, $2, $3, $4, $5) returning id',
      [input.firstName, input.lastName, input.email, input.phone, input.gapssaAccountId ?? null],
    )
    return (result.rows[0] as { id: string }).id
  })
}

export async function findPendingBookingReviewByBookingRequestId(bookingRequestId: string): Promise<Record<string, unknown> | null> {
  return withBookingDb(async (client) => {
    const result = await client.query(
      "select * from booking_review_records where booking_request_id = $1 and status = 'pending' order by created_at desc limit 1",
      [bookingRequestId],
    )
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

/** Solo para pruebas: fuerza la caducidad de una revisión pendiente directamente en la base efímera — simula "el plazo venció" sin esperar CONTACT_REVIEW_HOLD_HOURS real. */
export async function expireBookingReviewForTesting(reviewId: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query("update booking_review_records set expires_at = now() - interval '1 hour' where id = $1", [reviewId])
  })
}

/** Fila completa de `booking_review_records` por id, sin filtrar por status — a diferencia de `findPendingBookingReviewByBookingRequestId`, usada para comprobar el estado final (`replaced`/`rejected`/`resolved`/`processing`) tras una operación. */
export async function findBookingReviewRowById(reviewId: string): Promise<Record<string, unknown> | null> {
  return withBookingDb(async (client) => {
    const result = await client.query('select * from booking_review_records where id = $1', [reviewId])
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

/** Todas las filas activas o cerradas de `booking_review_records` para una solicitud, más recientes primero — para comprobar convergencia (una sola fila activa) tras una apertura concurrente, o el rastro `pending -> replaced -> pending` de una reanudación que topó con otro conflicto. */
export async function listBookingReviewRowsForRequest(bookingRequestId: string): Promise<Record<string, unknown>[]> {
  return withBookingDb(async (client) => {
    const result = await client.query('select * from booking_review_records where booking_request_id = $1 order by created_at desc', [
      bookingRequestId,
    ])
    return result.rows as Record<string, unknown>[]
  })
}

/**
 * Revisión 3 de Fase 4B, punto 2: simula un reclamo (`processing`) con
 * `claimToken`/`leaseExpiresAt` exactos — mismo patrón que
 * `forceGuestVerificationOtpJobProcessing`, usado para reproducir "otra
 * reanudación tiene el claim vigente" (lease fresco) o "una reanudación
 * quedó abandonada" (lease vencido) sin depender de temporización real.
 */
export async function forceBookingReviewProcessing(reviewId: string, fields: { claimToken: string; leaseExpiresAt: Date }): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(
      "update booking_review_records set status = 'processing', claim_token = $2, claimed_at = now(), lease_expires_at = $3 where id = $1",
      [reviewId, fields.claimToken, fields.leaseExpiresAt],
    )
  })
}

/**
 * Revisión 4 de Fase 4B, punto 1: reproduce el predicado CAS EXACTO del
 * `UPDATE` de reemplazo de `repository.ts::openBookingReviewAtomic`
 * (`id = $1 AND status = 'processing' AND claim_token = $2 AND
 * lease_expires_at > now()`) contra Postgres real — mismo motivo que
 * `attemptGuestVerificationOtpJobCompleteWithToken`/`attemptLinkOtpChallenge`:
 * el servidor de pruebas bajo prueba es un proceso `next dev` aparte sin
 * memoria compartida con este proceso de vitest, así que no hay forma de
 * pausar una reanudación real a mitad de camino para que otro worker le
 * robe el lease exactamente en ese instante; esto demuestra que la FILA (el
 * `WHERE`, no la función TypeScript que lo envuelve) rechaza cualquier
 * intento de reemplazo que no traiga el `claimToken` vigente Y un lease
 * todavía no vencido según el reloj DE POSTGRES. Devuelve cuántas filas
 * afectó (0 = `lease_lost`, 1 = reemplazada).
 */
export async function attemptReplaceBookingReviewWithToken(reviewId: string, claimToken: string): Promise<number> {
  return withBookingDb(async (client) => {
    const result = await client.query(
      "update booking_review_records set status = 'replaced', resolved_at = now(), claim_token = null, claimed_at = null, lease_expires_at = null where id = $1 and status = 'processing' and claim_token = $2 and lease_expires_at > now()",
      [reviewId, claimToken],
    )
    return result.rowCount ?? 0
  })
}

/**
 * Revisión 4 de Fase 4B, punto 2: inserta un `sim_espo_meetings` (+ su
 * relación en `sim_espo_meeting_contacts`) directamente, sin pasar por
 * `createMeeting` — para reproducir "ya existe un Meeting compatible para
 * este `bookingRequestId`, pero vinculado a un Contact distinto del que el
 * operador va a elegir al resolver" (dispara `meeting_contact_mismatch`
 * DURANTE una reanudación, el único conflicto de Meeting alcanzable ahí sin
 * violar el índice único `sim_espo_meetings_booking_request_id_key`).
 */
export async function insertSimEspoMeetingForTesting(input: {
  bookingRequestId: string
  treatmentId: string
  professionalId: string
  zoneId: string
  startAt: Date | string
  endAt: Date | string
  contactId: string
}): Promise<string> {
  return withBookingDb(async (client) => {
    const meeting = await client.query(
      'insert into sim_espo_meetings (booking_request_id, treatment_id, professional_id, zone_id, start_at, end_at) values ($1, $2, $3, $4, $5, $6) returning id',
      [input.bookingRequestId, input.treatmentId, input.professionalId, input.zoneId, input.startAt, input.endAt],
    )
    const meetingId = (meeting.rows[0] as { id: string }).id
    await client.query('insert into sim_espo_meeting_contacts (meeting_id, contact_id) values ($1, $2)', [meetingId, input.contactId])
    return meetingId
  })
}

/**
 * Revisión 4 de Fase 4B, puntos 2/4: fuerza `meeting_id`/`status`
 * directamente en `booking_request_records` — reproduce exactamente la
 * ventana de fallo que ambos puntos cubren ("el resultado durable ya quedó
 * escrito, pero el paso siguiente — cerrar la revisión, o purgar la PII —
 * nunca llegó a ejecutarse") sin depender de inyección de fallos para
 * llegar ahí. `meetingId` es un id opaco cualquiera — ninguna de las dos
 * rutas bajo prueba (`closeOrphanedBookingReviewAfterLinkedRequest`,
 * `reconcileOrphanedPendingPii`) consulta `sim_espo_meetings` por su
 * contenido, solo comprueban que la columna no sea null.
 */
export async function forceBookingRequestLinkedForTesting(id: string, fields: { meetingId: string; status: string }): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query('update booking_request_records set meeting_id = $2, status = $3 where id = $1', [id, fields.meetingId, fields.status])
  })
}

/** Fuerza `status`/`resolution` de una solicitud directamente — simula "ya se resolvió por otra vía" sin depender de un flujo real completo. `meetingId` se deja explícitamente `null` salvo que se indique lo contrario, para distinguir esta rama de `forceBookingRequestLinkedForTesting`. */
export async function forceBookingRequestResolvedForTesting(
  id: string,
  fields: { resolution: string; meetingId?: string | null },
): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query("update booking_request_records set status = 'resolved', resolution = $2, resolved_at = now(), meeting_id = $3 where id = $1", [
      id,
      fields.resolution,
      fields.meetingId ?? null,
    ])
  })
}

export async function auditRowsForBookingEntity(entity: string, entityId: string): Promise<Record<string, unknown>[]> {
  return withBookingDb(async (client) => {
    const result = await client.query(
      'select * from booking_audit_log where entity = $1 and entity_id = $2 order by occurred_at',
      [entity, entityId],
    )
    return result.rows as Record<string, unknown>[]
  })
}

/** Solo para pruebas: fuerza el estado de una solicitud directamente en la base efímera — simula "el tiempo pasó" sin depender de TTLs reales. */
export async function setBookingRequestStatusForTesting(
  id: string,
  fields: { status?: string; verificationExpiresAt?: Date; approvalExpiresAt?: Date | null },
): Promise<void> {
  await withBookingDb(async (client) => {
    if (fields.status !== undefined) {
      await client.query('update booking_request_records set status = $2 where id = $1', [id, fields.status])
    }
    if (fields.verificationExpiresAt !== undefined) {
      await client.query('update booking_request_records set verification_expires_at = $2 where id = $1', [
        id,
        fields.verificationExpiresAt,
      ])
    }
    if (fields.approvalExpiresAt !== undefined) {
      await client.query('update booking_request_records set approval_expires_at = $2 where id = $1', [
        id,
        fields.approvalExpiresAt,
      ])
    }
  })
}

/** Job del outbox de envío de OTP de invitado (revisión 2 de Fase 4A, punto 3) para una solicitud — para inspeccionar su estado/lastErrorCode desde las pruebas. */
export async function findGuestVerificationOtpJob(bookingRequestId: string): Promise<Record<string, unknown> | null> {
  return withBookingDb(async (client) => {
    const result = await client.query(
      "select * from booking_outbox_jobs where booking_request_id = $1 and job_type = 'send_guest_verification_otp'",
      [bookingRequestId],
    )
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

/** Solo para pruebas: fuerza el job de OTP de vuelta a "pending" — simula que un intento anterior quedó por reintentar (p. ej. tras un fallo SMTP), sin depender de un fallo real. */
export async function resetGuestVerificationOtpJobForTesting(bookingRequestId: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(
      "update booking_outbox_jobs set status = 'pending', updated_at = now() where booking_request_id = $1 and job_type = 'send_guest_verification_otp'",
      [bookingRequestId],
    )
  })
}

export async function findPendingGuestIdentityStatus(bookingRequestId: string): Promise<string | null> {
  return withBookingDb(async (client) => {
    const result = await client.query('select status from pending_guest_identities where booking_request_id = $1', [
      bookingRequestId,
    ])
    return (result.rows[0] as { status: string } | undefined)?.status ?? null
  })
}

// ---------------------------------------------------------------------------
// Inyección de fallos — mismo mecanismo (trigger + tabla marcadora) que
// authDb.ts (Fase 3, installAuditFailureInjection/installOutboxFailureInjection):
// el servidor de pruebas es un proceso `next dev` aparte, sin memoria
// compartida con este proceso de vitest, así que la única superficie real
// y determinista para forzar un fallo dentro de una transacción que el
// servidor sí ejecuta es la propia base de datos.
// ---------------------------------------------------------------------------

/**
 * Hace fallar el `INSERT` en `sim_espo_meetings` para un `booking_request_id`
 * marcado — simula "EspoCRM nunca llegó a crear el Meeting" (fallo ANTES de
 * que exista Meeting, paso 6 del flujo de verificación).
 */
export async function installMeetingCreationFailureInjection(): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(`
      create table if not exists _test_fail_meeting_creation_targets (booking_request_id uuid primary key);

      create or replace function _test_fail_meeting_creation_insert() returns trigger as $$
      begin
        if exists (select 1 from _test_fail_meeting_creation_targets where booking_request_id = new.booking_request_id) then
          raise exception 'injected_test_meeting_creation_failure';
        end if;
        return new;
      end;
      $$ language plpgsql;

      drop trigger if exists _test_fail_meeting_creation_trigger on sim_espo_meetings;
      create trigger _test_fail_meeting_creation_trigger
        before insert on sim_espo_meetings
        for each row execute function _test_fail_meeting_creation_insert();
    `)
  })
}

export async function enableMeetingCreationFailureFor(bookingRequestId: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(
      'insert into _test_fail_meeting_creation_targets (booking_request_id) values ($1) on conflict do nothing',
      [bookingRequestId],
    )
  })
}

export async function disableMeetingCreationFailureFor(bookingRequestId: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query('delete from _test_fail_meeting_creation_targets where booking_request_id = $1', [bookingRequestId])
  })
}

/**
 * Hace fallar el `UPDATE` de `booking_request_records` que escribe
 * `meeting_id` para una fila marcada — simula "el Meeting sí se creó en
 * EspoCRM, pero la escritura de meetingId en Postgres falló" (fallo
 * DESPUÉS de crear el Meeting, paso 7).
 */
export async function installMeetingLinkFailureInjection(): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(`
      create table if not exists _test_fail_meeting_link_targets (id uuid primary key);

      create or replace function _test_fail_meeting_link_update() returns trigger as $$
      begin
        if exists (select 1 from _test_fail_meeting_link_targets where id = new.id) and new.meeting_id is not null then
          raise exception 'injected_test_meeting_link_failure';
        end if;
        return new;
      end;
      $$ language plpgsql;

      drop trigger if exists _test_fail_meeting_link_trigger on booking_request_records;
      create trigger _test_fail_meeting_link_trigger
        before update on booking_request_records
        for each row execute function _test_fail_meeting_link_update();
    `)
  })
}

export async function enableMeetingLinkFailureFor(id: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query('insert into _test_fail_meeting_link_targets (id) values ($1) on conflict do nothing', [id])
  })
}

export async function disableMeetingLinkFailureFor(id: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query('delete from _test_fail_meeting_link_targets where id = $1', [id])
  })
}

/**
 * Mismo mecanismo que en `authDb.ts` (`installAuditFailureInjection`), pero
 * indexado por (`entity`, `entity_id`) en vez de solo `entity_id` — dentro
 * de una misma petición de verificación, `writeMeetingIdAndPendingApproval`
 * (entity `BookingRequestRecord`) y `purgePendingGuestIdentity` (entity
 * `PendingGuestIdentity`) auditan CON EL MISMO `entity_id`
 * (`bookingRequestId`) en pasos sucesivos — indexar solo por `entity_id`
 * haría fallar ambas escrituras a la vez y no dejaría aislar cuál de las
 * dos transiciones se está probando.
 */
export async function installBookingAuditFailureInjection(): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(`
      create table if not exists _test_fail_booking_audit_targets (entity text, entity_id text, primary key (entity, entity_id));

      create or replace function _test_fail_booking_audit_insert() returns trigger as $$
      begin
        if exists (select 1 from _test_fail_booking_audit_targets where entity = new.entity and entity_id = new.entity_id) then
          raise exception 'injected_test_booking_audit_failure';
        end if;
        return new;
      end;
      $$ language plpgsql;

      drop trigger if exists _test_fail_booking_audit_trigger on booking_audit_log;
      create trigger _test_fail_booking_audit_trigger
        before insert on booking_audit_log
        for each row execute function _test_fail_booking_audit_insert();
    `)
  })
}

export async function enableBookingAuditFailureFor(entity: string, entityId: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query('insert into _test_fail_booking_audit_targets (entity, entity_id) values ($1, $2) on conflict do nothing', [
      entity,
      entityId,
    ])
  })
}

export async function disableBookingAuditFailureFor(entity: string, entityId: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query('delete from _test_fail_booking_audit_targets where entity = $1 and entity_id = $2', [entity, entityId])
  })
}

/**
 * Variante por `reason_code` — para las transiciones donde el id de la
 * entidad NO se conoce todavía antes de disparar la acción bajo prueba (la
 * creación de una solicitud: `BookingRequestRecord.id` lo genera el
 * servidor). Seguro porque la suite de integración ejecuta los ficheros en
 * serie (`fileParallelism: false`, `vitest.integration.config.ts`): armar
 * este interruptor justo antes de la petición y desarmarlo en un `finally`
 * nunca compite con otra prueba.
 */
export async function installBookingAuditReasonCodeFailureInjection(): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(`
      create table if not exists _test_fail_booking_audit_reason_targets (reason_code text primary key);

      create or replace function _test_fail_booking_audit_reason_insert() returns trigger as $$
      begin
        if new.reason_code is not null and exists (
          select 1 from _test_fail_booking_audit_reason_targets where reason_code = new.reason_code::text
        ) then
          raise exception 'injected_test_booking_audit_reason_failure';
        end if;
        return new;
      end;
      $$ language plpgsql;

      drop trigger if exists _test_fail_booking_audit_reason_trigger on booking_audit_log;
      create trigger _test_fail_booking_audit_reason_trigger
        before insert on booking_audit_log
        for each row execute function _test_fail_booking_audit_reason_insert();
    `)
  })
}

export async function enableBookingAuditFailureForReasonCode(reasonCode: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query('insert into _test_fail_booking_audit_reason_targets (reason_code) values ($1) on conflict do nothing', [
      reasonCode,
    ])
  })
}

export async function disableBookingAuditFailureForReasonCode(reasonCode: string): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query('delete from _test_fail_booking_audit_reason_targets where reason_code = $1', [reasonCode])
  })
}

/**
 * Solo para pruebas: escribe directamente `cEstadoReserva`/`decidedBy`/
 * `resolutionReason` de un Meeting simulado sin pasar por
 * `decideMeeting`/`expireMeeting` (que exigen el CAS `WHERE cEstadoReserva
 * = 'PendingCenterApproval'`) — así se puede reproducir exactamente el
 * estado que deja un fallo parcial real ("el Meeting quedó decidido, pero
 * BookingRequestRecord nunca llegó a resolverse") sin depender de
 * inyección de fallos para llegar ahí.
 *
 * "Fase 4B — flujo de decisión final": `resolutionReason` es OBLIGATORIO
 * (nunca opcional) — `deriveResolutionFromDecidedMeeting` ya no infiere
 * nada de `decidedBy`, así que un test que deje este campo fuera de
 * sincronía con `cEstadoReserva` está, a propósito, reproduciendo el caso
 * "dato heredado ambiguo" (ver `resolutionReasonForTesting: null` en los
 * tests que ejercitan justamente esa rama).
 */
export async function decideSimEspoMeetingForTesting(
  meetingId: string,
  cEstadoReserva: string,
  decidedBy: string,
  resolutionReason: 'Approved' | 'RejectedByStaff' | 'ApprovalExpired' | null,
): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(
      'update sim_espo_meetings set c_estado_reserva = $2, decided_by = $3, resolution_reason = $4, decided_at = now(), updated_at = now() where id = $1',
      [meetingId, cEstadoReserva, decidedBy, resolutionReason],
    )
  })
}

/**
 * Corrección de puerta 4, bloqueo de concurrencia: inserta un
 * `booking_request_records` mínimo, ya en `pending_approval` y vinculado a
 * `meetingId` — para probar `applyOrAdoptBookingDecision` (`decisionRecovery.ts`)
 * directamente contra un Meeting servido por `FakeEspoServer`/`HttpEspoBookingAdapter`
 * (nunca alcanzable a través del flujo real de invitado, que solo conoce
 * `SimulatedEspoBookingAdapter`) sin depender de OTP/verificación/disponibilidad.
 * `meetingId` es un id opaco cualquiera — la fila no valida que exista de
 * verdad en ningún adaptador, solo lo que `findBookingRequestByMeetingId`
 * necesita para encontrarla.
 */
export async function createPendingApprovalBookingRequestForTesting(input: {
  meetingId: string
  treatmentId?: string
  professionalId?: string
  zoneId?: string
  startAt?: Date
  endAt?: Date
}): Promise<string> {
  return withBookingDb(async (client) => {
    const startAt = input.startAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000)
    const endAt = input.endAt ?? new Date(startAt.getTime() + 60 * 60 * 1000)
    const result = await client.query(
      `insert into booking_request_records
         (meeting_id, treatment_id, professional_id, zone_id, start_at, end_at, status,
          verification_expires_at, approval_expires_at, idempotency_key, payload_hash, identity_fingerprint_key_version)
       values ($1, $2, $3, $4, $5, $6, 'pending_approval', $5, $6, gen_random_uuid(), 'test-fixture-hash', 'test-fixture-v1')
       returning id`,
      [
        input.meetingId,
        input.treatmentId ?? 'treatment-test-fixture',
        input.professionalId ?? 'professional-test-fixture',
        input.zoneId ?? 'zone-test-fixture',
        startAt,
        endAt,
      ],
    )
    return (result.rows[0] as { id: string }).id
  })
}

export async function countBookingOutboxJobs(bookingRequestId: string): Promise<number> {
  return withBookingDb(async (client) => {
    const result = await client.query('select count(*)::int as count from booking_outbox_jobs where booking_request_id = $1', [
      bookingRequestId,
    ])
    return (result.rows[0] as { count: number }).count
  })
}

// ---------------------------------------------------------------------------
// Leases del outbox de OTP de invitado — revisión 3 de Fase 4A, puntos 1-2.
// Solo para pruebas: fuerzan directamente el estado de un job en la base
// efímera para simular exactamente lo que deja un worker real en cada
// escenario (reclamo abandonado, reintento vencido/no vencido) sin
// depender de temporización real ni de forzar fallos de Redis/SMTP.
// ---------------------------------------------------------------------------

/** Simula un job `processing` con un `claimToken`/`leaseExpiresAt` exactos — "worker X reclamó y esto es lo que dejó". */
export async function forceGuestVerificationOtpJobProcessing(
  bookingRequestId: string,
  fields: { claimToken: string; leaseExpiresAt: Date },
): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(
      "update booking_outbox_jobs set status = 'processing', claim_token = $2, claimed_at = now(), lease_expires_at = $3, updated_at = now() where booking_request_id = $1 and job_type = 'send_guest_verification_otp'",
      [bookingRequestId, fields.claimToken, fields.leaseExpiresAt],
    )
  })
}

/** Simula un job `failed_retryable` con un `nextAttemptAt` exacto — "el intento anterior falló y esto es lo que dejó". */
export async function forceGuestVerificationOtpJobFailedRetryable(bookingRequestId: string, nextAttemptAt: Date): Promise<void> {
  await withBookingDb(async (client) => {
    await client.query(
      "update booking_outbox_jobs set status = 'failed_retryable', next_attempt_at = $2, claim_token = null, claimed_at = null, lease_expires_at = null, updated_at = now() where booking_request_id = $1 and job_type = 'send_guest_verification_otp'",
      [bookingRequestId, nextAttemptAt],
    )
  })
}

/**
 * Reproduce el predicado CAS exacto de `repository.ts::markGuestVerificationOtpJobCompleted`
 * (`id = jobId AND status = 'processing' AND claim_token = claimToken`) —
 * nunca la lógica de negocio completa, solo el `WHERE` que decide si un
 * `claimToken` sigue siendo el vigente. El proceso de pruebas no comparte
 * memoria con el servidor real bajo prueba (`next dev`, proceso aparte —
 * mismo motivo documentado en `booking.otpOutbox.int.test.ts`), así que no
 * hay forma de invocar la función real con un token deliberadamente
 * obsoleto; esto demuestra que la FILA (no la función) rechaza cualquier
 * escritura que no traiga el token vigente. Devuelve cuántas filas afectó.
 */
export async function attemptGuestVerificationOtpJobCompleteWithToken(jobId: string, claimToken: string): Promise<number> {
  return withBookingDb(async (client) => {
    const result = await client.query(
      "update booking_outbox_jobs set status = 'completed', completed_at = now(), updated_at = now() where id = $1 and status = 'processing' and claim_token = $2",
      [jobId, claimToken],
    )
    return result.rowCount ?? 0
  })
}

/** Misma reproducción de predicado CAS que `attemptGuestVerificationOtpJobCompleteWithToken`, para la rama `failed_retryable`. */
export async function attemptGuestVerificationOtpJobFailRetryableWithToken(jobId: string, claimToken: string): Promise<number> {
  return withBookingDb(async (client) => {
    const result = await client.query(
      "update booking_outbox_jobs set status = 'failed_retryable', updated_at = now() where id = $1 and status = 'processing' and claim_token = $2",
      [jobId, claimToken],
    )
    return result.rowCount ?? 0
  })
}

/**
 * Reproduce el predicado CAS exacto de `repository.ts::linkOtpChallengeIfPending`
 * (`id = bookingRequestId AND status = 'pending_verification' AND
 * verification_expires_at > now()`) contra Postgres real — mismo motivo que
 * `attemptGuestVerificationOtpJobCompleteWithToken`: el proceso de pruebas
 * no comparte memoria con el servidor real bajo prueba, así que esto es la
 * única forma de comprobar el `WHERE` real (reloj DE POSTGRES, nunca un
 * `Date` de Node) en vez de confiar en un mock. Devuelve cuántas filas
 * afectó (0 = CAS perdido/objetivo ya no vigente, 1 = vinculado).
 */
export async function attemptLinkOtpChallenge(bookingRequestId: string, challengeId: string): Promise<number> {
  return withBookingDb(async (client) => {
    const result = await client.query(
      "update booking_request_records set otp_challenge_id = $2 where id = $1 and status = 'pending_verification' and verification_expires_at > now()",
      [bookingRequestId, challengeId],
    )
    return result.rowCount ?? 0
  })
}

/** Lee el reloj real de Postgres — para anclar límites de expiración exactamente contra la misma base que evalúa el CAS anterior, nunca contra `Date.now()` de Node. */
export async function selectDbNow(): Promise<Date> {
  return withBookingDb(async (client) => {
    const result = await client.query('select now() as now')
    return (result.rows[0] as { now: Date }).now
  })
}
