import 'server-only'
import { randomUUID } from 'node:crypto'

import { and, count, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'

import {
  computePayloadHash,
  decidePendingGuestIdentityPurgeTrigger,
  type AuditActor,
  type AuditChannel,
  type AuditReasonCode,
  type BookingOutboxJobErrorCode,
  type BookingReasonCode,
  type BookingRequestResolution,
  type BookingReviewConflictType,
  type EncryptedField,
  type PendingGuestIdentityPurgeTrigger,
} from '@gapssa/contracts'

import { isUniqueViolation } from '../auth/dbErrors'
import { recordEventBookingAuditEvent, recordRawBookingAuditEvent } from './audit'
import { bookingDb, type BookingTx } from './db/client'
import {
  bookingOutboxJobs,
  bookingRequestRecords,
  bookingReviewRecords,
  pendingAuthenticatedContactDetails,
  pendingGuestIdentities,
} from './db/schema'

/**
 * Acceso a `gapssa_booking` para `BookingRequestRecord`/`PendingGuestIdentity`
 * (`packages/contracts/src/booking.ts`) — capa fina sobre Drizzle, sin
 * reglas de negocio (eso vive en `guestFlow.ts`/`authenticatedFlow.ts`/
 * `reconciliation.ts` y en las rutas API), mismo principio que
 * `server/auth/repository.ts`.
 *
 * Nota de diseño sobre `verificationExpiresAt` como ancla de la ventana de
 * recuperación: el contrato define `VERIFICATION_RECOVERY_WINDOW_MINUTES`
 * como el plazo "tras entrar en verification_processing" (booking.ts), pero
 * `BookingRequestRecord` no tiene un campo propio "cuándo entró en
 * verification_processing" — añadir uno sería extender la forma del
 * contrato ya aprobado sin autorización explícita. Se reutiliza
 * `verificationExpiresAt` (que nunca se reescribe al transicionar a
 * verification_processing) como ancla:
 * `recoveryDeadline = verificationExpiresAt + BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES`.
 * Para el flujo autenticado (sin espera de OTP, ver `authenticatedFlow.ts`)
 * `verificationExpiresAt` se fija en el momento de creación — la solicitud
 * pasa por `verification_processing` de forma prácticamente instantánea
 * dentro de la misma petición, así que esa ventana solo importa si el
 * proceso cae a mitad de camino.
 */

export type BookingRequestRow = typeof bookingRequestRecords.$inferSelect
export type PendingGuestIdentityRow = typeof pendingGuestIdentities.$inferSelect

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export async function findBookingRequestById(id: string): Promise<BookingRequestRow | null> {
  const [row] = await bookingDb.select().from(bookingRequestRecords).where(eq(bookingRequestRecords.id, id)).limit(1)
  return row ?? null
}

export async function findBookingRequestByIdempotencyKey(idempotencyKey: string): Promise<BookingRequestRow | null> {
  const [row] = await bookingDb
    .select()
    .from(bookingRequestRecords)
    .where(eq(bookingRequestRecords.idempotencyKey, idempotencyKey))
    .limit(1)
  return row ?? null
}

export async function findBookingRequestByMeetingId(meetingId: string): Promise<BookingRequestRow | null> {
  const [row] = await bookingDb.select().from(bookingRequestRecords).where(eq(bookingRequestRecords.meetingId, meetingId)).limit(1)
  return row ?? null
}

/**
 * "Fase 4B — flujo de decisión final", punto 3 del encargo: estrategia
 * recuperable para la `operationKey` de una decisión HUMANA — "crearla y
 * persistirla antes del primer efecto externo". `COALESCE` hace de esto un
 * UPSERT atómico de una sola sentencia: si ya había una clave persistida
 * para esta solicitud (un intento anterior, incluso de OTRO proceso), esa
 * es la que GANA y se devuelve — `candidateKey` se descarta en silencio.
 * Dos llamadas concurrentes con `candidateKey` distintos para la MISMA
 * solicitud convergen siempre en la MISMA clave ganadora (la que su
 * `UPDATE` ejecute primero en Postgres), nunca en dos.
 *
 * Se llama SIEMPRE antes de invocar `adapter.decideMeeting` — nunca
 * después — para que un reintento (timeout de red, caída del proceso tras
 * el commit de EspoCRM pero antes de responder) reutilice la MISMA clave
 * ya persistida en vez de generar una UUID nueva, permitiendo que
 * `PutDecide` la reconozca como replay en vez de como una operación nueva.
 */
export async function ensureDecisionOperationKey(bookingRequestId: string, candidateKey: string): Promise<string> {
  const [row] = await bookingDb
    .update(bookingRequestRecords)
    .set({ decisionOperationKey: sql`coalesce(${bookingRequestRecords.decisionOperationKey}, ${candidateKey})` })
    .where(eq(bookingRequestRecords.id, bookingRequestId))
    .returning({ decisionOperationKey: bookingRequestRecords.decisionOperationKey })

  if (!row || row.decisionOperationKey === null) {
    throw new Error(`No se pudo asegurar decisionOperationKey para la solicitud ${bookingRequestId}.`)
  }
  return row.decisionOperationKey
}

export async function findPendingGuestIdentity(bookingRequestId: string): Promise<PendingGuestIdentityRow | null> {
  const [row] = await bookingDb
    .select()
    .from(pendingGuestIdentities)
    .where(eq(pendingGuestIdentities.bookingRequestId, bookingRequestId))
    .limit(1)
  return row ?? null
}

/**
 * Solicitudes vivas (sin Meeting todavía) que solapan [from, to) para el
 * profesional y/o la zona indicados — combinado con
 * `EspoBookingAdapter.listActiveMeetingsOverlapping` (que cubre desde
 * `pending_approval` en adelante, porque esas ya tienen Meeting) da la
 * ocupación completa para disponibilidad/bloqueo. Ver
 * `server/booking/availability.ts`.
 *
 * Revisión 2 de Fase 4B, punto 6: incluye `contact_review_pending` — una
 * solicitud en revisión manual sigue siendo una reserva viva (puede
 * resolverse y crear el Meeting en cualquier momento dentro de
 * `CONTACT_REVIEW_HOLD_HOURS`), nunca debe liberar el hueco mientras tanto.
 * Omitirlo aquí sería el mismo tipo de fallo que este mismo revisión
 * corrige en el resto del flujo: un estado que "ocupa" en la práctica pero
 * que el sistema trata como si no existiera.
 */
export async function listUnresolvedOverlapping(input: {
  professionalId?: string
  zoneId?: string
  from: Date
  to: Date
}): Promise<Pick<BookingRequestRow, 'id' | 'professionalId' | 'zoneId' | 'startAt' | 'endAt'>[]> {
  const conditions = [
    inArray(bookingRequestRecords.status, ['pending_verification', 'verification_processing', 'contact_review_pending']),
    isNull(bookingRequestRecords.meetingId),
    lt(bookingRequestRecords.startAt, input.to),
    gt(bookingRequestRecords.endAt, input.from),
  ]
  if (input.professionalId) {
    conditions.push(eq(bookingRequestRecords.professionalId, input.professionalId))
  }
  if (input.zoneId) {
    conditions.push(eq(bookingRequestRecords.zoneId, input.zoneId))
  }

  return bookingDb
    .select({
      id: bookingRequestRecords.id,
      professionalId: bookingRequestRecords.professionalId,
      zoneId: bookingRequestRecords.zoneId,
      startAt: bookingRequestRecords.startAt,
      endAt: bookingRequestRecords.endAt,
    })
    .from(bookingRequestRecords)
    .where(and(...conditions))
}

/**
 * Solicitudes de un invitado (`PendingGuestIdentity.status = 'active'`) no
 * resueltas, por `emailLookupHmac` — MAX_PENDING_REQUESTS_PER_CLIENT
 * (booking.ts). Deja de contar en cuanto se purga la identidad (disparador
 * `meeting_linked`, en cuanto se escribe `meetingId` — antes incluso de la
 * resolución final): el límite protege contra acumular solicitudes SIN
 * verificar/vincular todavía, no contra tener varias citas ya vinculadas
 * pendientes de aprobación del centro — consecuencia directa del propio
 * disparador de purga del contrato, no una limitación añadida aquí.
 */
/**
 * `candidates` = el HMAC del mismo correo bajo CADA versión presente en
 * `BOOKING_EMAIL_LOOKUP_HMAC_SECRETS` (calculado por el llamante,
 * `guestFlow.ts::encryptGuestIdentity`) — nunca solo el de la versión
 * activa: durante convivencia tras una rotación, una identidad pendiente
 * creada con una versión anterior debe seguir contando.
 */
export async function countActivePendingRequestsByEmailHmacCandidates(candidates: readonly string[]): Promise<number> {
  if (candidates.length === 0) {
    return 0
  }
  const rows = await bookingDb
    .select({ id: bookingRequestRecords.id })
    .from(pendingGuestIdentities)
    .innerJoin(bookingRequestRecords, eq(bookingRequestRecords.id, pendingGuestIdentities.bookingRequestId))
    .where(
      and(
        inArray(pendingGuestIdentities.emailLookupHmac, candidates),
        eq(pendingGuestIdentities.status, 'active'),
        ne(bookingRequestRecords.status, 'resolved'),
      ),
    )
  return rows.length
}

/** Solicitudes en pending_verification/verification_processing sin Meeting — candidatas al barrido de expiración de verificación (reconciliation.ts). */
export async function listUnresolvedVerifications(): Promise<BookingRequestRow[]> {
  return bookingDb
    .select()
    .from(bookingRequestRecords)
    .where(
      and(isNull(bookingRequestRecords.meetingId), inArray(bookingRequestRecords.status, ['pending_verification', 'verification_processing'])),
    )
}

/** Solicitudes en pending_approval cuyo approvalExpiresAt ya venció — candidatas al barrido de expiración de aprobación (reconciliation.ts). */
export async function listExpiredApprovals(now: Date): Promise<BookingRequestRow[]> {
  return bookingDb
    .select()
    .from(bookingRequestRecords)
    .where(and(eq(bookingRequestRecords.status, 'pending_approval'), lt(bookingRequestRecords.approvalExpiresAt, now)))
}

/** Solicitudes en pending_approval todavía dentro de plazo — usado para reconstruir el BookingLock de fase "approval" en el barrido (reconciliation.ts). */
export async function listActiveApprovals(now: Date): Promise<BookingRequestRow[]> {
  return bookingDb
    .select()
    .from(bookingRequestRecords)
    .where(and(eq(bookingRequestRecords.status, 'pending_approval'), gt(bookingRequestRecords.approvalExpiresAt, now)))
}

/**
 * Solicitudes en `contact_review_pending` con su revisión abierta
 * (`BookingReviewRecord.status = 'pending'`) todavía dentro de plazo —
 * revisión 2 de Fase 4B, punto 6: usado para reconstruir el BookingLock
 * (fase "approval": mismo tipo de reserva "post-verificación,
 * pre-decisión-final" que `pending_approval`, defensa en profundidad —
 * `listUnresolvedOverlapping` en Postgres sigue siendo la fuente de verdad
 * real de la ocupación, esto es solo la capa rápida de Redis). El plazo
 * real es `BookingReviewRecord.expiresAt` (`CONTACT_REVIEW_HOLD_HOURS`),
 * nunca `approvalExpiresAt` (null en este estado).
 */
export async function listActiveContactReviews(now: Date): Promise<(BookingRequestRow & { reviewExpiresAt: Date })[]> {
  const rows = await bookingDb
    .select({ request: bookingRequestRecords, reviewExpiresAt: bookingReviewRecords.expiresAt })
    .from(bookingRequestRecords)
    .innerJoin(bookingReviewRecords, eq(bookingReviewRecords.bookingRequestId, bookingRequestRecords.id))
    .where(
      and(
        eq(bookingRequestRecords.status, 'contact_review_pending'),
        // Revisión 3, punto 2: `processing` (reanudación en curso) sigue
        // siendo una reserva viva — nunca solo `pending`, que dejaría de
        // proteger el horario justo mientras un operador la está
        // resolviendo.
        inArray(bookingReviewRecords.status, ['pending', 'processing']),
        gt(bookingReviewRecords.expiresAt, now),
      ),
    )
  return rows.map((row) => ({ ...row.request, reviewExpiresAt: row.reviewExpiresAt }))
}

// ---------------------------------------------------------------------------
// Escritura — invitado
// ---------------------------------------------------------------------------

export interface EncryptedIdentityInput {
  firstName: EncryptedField
  lastName: EncryptedField
  email: EncryptedField
  phone: EncryptedField
  emailLookupHmac: string
  /** Versión de BOOKING_EMAIL_LOOKUP_HMAC_SECRETS con la que se calculó emailLookupHmac (siempre la activa al crear). */
  emailLookupHmacKeyVersion: string
}

/**
 * Construye el payload canónico de idempotencia para una versión concreta
 * de `identityFingerprintKeyVersion` — nunca un hash precalculado con la
 * versión ACTIVA a ciegas: comparar contra un registro ya persistido debe
 * recalcular con la versión que ESE registro guardó, para que rotar
 * `BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION` no rompa la detección
 * de replay de una solicitud todavía viva (`server/booking/identityFingerprint.ts`).
 */
export type CanonicalPayloadFactory = (identityFingerprintKeyVersion: string) => Promise<unknown>

async function resolveAgainstExisting(
  existing: BookingRequestRow,
  computeCanonicalPayload: CanonicalPayloadFactory,
): Promise<CreateBookingRequestOutcome> {
  const recomputedHash = await computePayloadHash(await computeCanonicalPayload(existing.identityFingerprintKeyVersion))
  return recomputedHash === existing.payloadHash
    ? { outcome: 'idempotent_replay', record: existing }
    : { outcome: 'idempotency_conflict' }
}

export interface CreateGuestBookingRequestInput {
  /**
   * Generado por el llamante (`crypto.randomUUID()`) ANTES de esta
   * llamada — necesario porque la clave del `BookingLock` en Redis debe
   * existir antes de que la fila de Postgres exista (guestFlow.ts adquiere
   * el lock antes de insertar). `bookingRequestRecords.id` tiene
   * `defaultRandom()`, pero pasarlo explícitamente aquí lo sustituye sin
   * problema.
   */
  id: string
  idempotencyKey: string
  /** Versión de `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS` con la que se calcula la huella de ESTA solicitud si de verdad se crea (siempre la activa). */
  identityFingerprintKeyVersion: string
  /** Versión de `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS` con la que `guestFlow.ts` ya firmó el token de acceso devuelto al llamante (siempre la activa) — se persiste aquí para que verificar ese token, más adelante, no tenga que "probar todas las versiones". */
  accessTokenKeyVersion: string
  computeCanonicalPayload: CanonicalPayloadFactory
  treatmentId: string
  professionalId: string
  zoneId: string
  startAt: Date
  endAt: Date
  verificationExpiresAt: Date
  identity: EncryptedIdentityInput
}

export type CreateBookingRequestOutcome =
  | { outcome: 'created'; record: BookingRequestRow }
  | { outcome: 'idempotent_replay'; record: BookingRequestRow }
  | { outcome: 'idempotency_conflict' }

/**
 * Revisión 2 de Fase 4A, punto 3: `BookingRequestRecord` +
 * `PendingGuestIdentity` + evento de auditoría `ClientRequested` + el job
 * de outbox que enviará el OTP se crean en esta MISMA transacción — las
 * cuatro escrituras se confirman o se revierten juntas. El envío del OTP
 * en sí (Redis + SMTP) ocurre DESPUÉS, fuera de esta transacción
 * (`otpOutbox.ts::processGuestVerificationOtpJob`, invocado por
 * `guestFlow.ts` en modo best-effort tras el commit) — nunca aquí, para no
 * mantener abierta una transacción de Postgres mientras se espera I/O real
 * de red con latencia impredecible. `otpChallengeId` se deja `NULL` al
 * crear: se vincula más tarde, cuando el job procesa.
 */
export async function createGuestBookingRequest(
  input: CreateGuestBookingRequestInput,
  now: Date = new Date(),
): Promise<CreateBookingRequestOutcome> {
  const existing = await findBookingRequestByIdempotencyKey(input.idempotencyKey)
  if (existing) {
    return resolveAgainstExisting(existing, input.computeCanonicalPayload)
  }

  const payloadHash = await computePayloadHash(await input.computeCanonicalPayload(input.identityFingerprintKeyVersion))

  try {
    return await bookingDb.transaction(async (tx) => {
      const [record] = await tx
        .insert(bookingRequestRecords)
        .values({
          id: input.id,
          treatmentId: input.treatmentId,
          professionalId: input.professionalId,
          zoneId: input.zoneId,
          startAt: input.startAt,
          endAt: input.endAt,
          status: 'pending_verification',
          verificationExpiresAt: input.verificationExpiresAt,
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          identityFingerprintKeyVersion: input.identityFingerprintKeyVersion,
          accessTokenKeyVersion: input.accessTokenKeyVersion,
        })
        .returning()

      if (!record) {
        throw new Error('No se pudo crear BookingRequestRecord.')
      }

      await tx.insert(pendingGuestIdentities).values({
        bookingRequestId: record.id,
        firstNameCiphertext: input.identity.firstName.ciphertext,
        firstNameNonce: input.identity.firstName.nonce,
        firstNameKeyVersion: input.identity.firstName.keyVersion,
        lastNameCiphertext: input.identity.lastName.ciphertext,
        lastNameNonce: input.identity.lastName.nonce,
        lastNameKeyVersion: input.identity.lastName.keyVersion,
        emailCiphertext: input.identity.email.ciphertext,
        emailNonce: input.identity.email.nonce,
        emailKeyVersion: input.identity.email.keyVersion,
        phoneCiphertext: input.identity.phone.ciphertext,
        phoneNonce: input.identity.phone.nonce,
        phoneKeyVersion: input.identity.phone.keyVersion,
        emailLookupHmac: input.identity.emailLookupHmac,
        emailLookupHmacKeyVersion: input.identity.emailLookupHmacKeyVersion,
        status: 'active',
        expiresAt: input.verificationExpiresAt,
      })

      await recordEventBookingAuditEvent(
        {
          entity: 'BookingRequestRecord',
          entityId: record.id,
          actor: { type: 'guest', guestId: record.id },
          channel: 'web',
          occurredAt: now.toISOString(),
          reasonCode: 'ClientRequested',
        },
        tx,
      )

      await tx.insert(bookingOutboxJobs).values({ jobType: 'send_guest_verification_otp', bookingRequestId: record.id, status: 'pending' })

      return { outcome: 'created' as const, record }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Carrera: otra petición con la misma idempotencyKey ganó el INSERT
      // entre el SELECT de arriba y este INSERT — nunca un 500, se resuelve
      // igual que si la hubiéramos encontrado desde el principio.
      const winner = await findBookingRequestByIdempotencyKey(input.idempotencyKey)
      if (winner) {
        return resolveAgainstExisting(winner, input.computeCanonicalPayload)
      }
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Escritura — cliente autenticado
// ---------------------------------------------------------------------------

export interface CreateAuthenticatedBookingRequestInput {
  /** Generado por el llamante antes de esta llamada — mismo motivo que `CreateGuestBookingRequestInput.id`. */
  id: string
  idempotencyKey: string
  identityFingerprintKeyVersion: string
  computeCanonicalPayload: CanonicalPayloadFactory
  clientAccountId: string
  treatmentId: string
  professionalId: string
  zoneId: string
  startAt: Date
  endAt: Date
  /**
   * Revisión 2 de Fase 4B, punto 3: nombre/apellidos/teléfono cifrados,
   * persistidos en `pending_authenticated_contact_details` en la MISMA
   * transacción — sin esto, un `contact_review_pending` (o cualquier fallo
   * a mitad del flujo) perdía estos datos en cuanto terminaba la petición
   * HTTP original, dejando la solicitud sin forma de reanudarse.
   */
  contactDetails: EncryptedAuthenticatedContactInput
  /** Igual que `PendingGuestIdentity.expiresAt` — ver `EncryptedAuthenticatedContactInput`. */
  contactDetailsExpiresAt: Date
}

/**
 * A diferencia del invitado, entra directamente en `verification_processing`
 * (sin OTP: la sesión ya prueba identidad) — ver nota de cabecera sobre
 * `verificationExpiresAt` como ancla de recuperación. Revisión 2 de Fase
 * 4A, punto 4: el `INSERT` y el evento de auditoría `ClientRequested` se
 * confirman/revierten en la MISMA transacción — antes se auditaba en una
 * llamada aparte, después de que `guestFlow`/`authenticatedFlow` recibiera
 * el resultado, así que un fallo entre ambos pasos dejaba la solicitud
 * creada sin rastro de auditoría, para siempre (un reintento idempotente
 * encuentra `existing` y nunca vuelve a auditar).
 */
export async function createAuthenticatedBookingRequest(
  input: CreateAuthenticatedBookingRequestInput,
  now: Date = new Date(),
): Promise<CreateBookingRequestOutcome> {
  const existing = await findBookingRequestByIdempotencyKey(input.idempotencyKey)
  if (existing) {
    return resolveAgainstExisting(existing, input.computeCanonicalPayload)
  }

  const payloadHash = await computePayloadHash(await input.computeCanonicalPayload(input.identityFingerprintKeyVersion))

  try {
    return await bookingDb.transaction(async (tx) => {
      const [record] = await tx
        .insert(bookingRequestRecords)
        .values({
          id: input.id,
          clientAccountId: input.clientAccountId,
          treatmentId: input.treatmentId,
          professionalId: input.professionalId,
          zoneId: input.zoneId,
          startAt: input.startAt,
          endAt: input.endAt,
          status: 'verification_processing',
          verificationExpiresAt: now,
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          identityFingerprintKeyVersion: input.identityFingerprintKeyVersion,
        })
        .returning()

      if (!record) {
        throw new Error('No se pudo crear BookingRequestRecord.')
      }

      await insertPendingAuthenticatedContactDetailsWithinTx(tx, record.id, input.contactDetails, input.contactDetailsExpiresAt)

      await recordEventBookingAuditEvent(
        {
          entity: 'BookingRequestRecord',
          entityId: record.id,
          actor: { type: 'user', id: input.clientAccountId },
          channel: 'web',
          occurredAt: now.toISOString(),
          reasonCode: 'ClientRequested',
        },
        tx,
      )

      return { outcome: 'created' as const, record }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findBookingRequestByIdempotencyKey(input.idempotencyKey)
      if (winner) {
        return resolveAgainstExisting(winner, input.computeCanonicalPayload)
      }
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Transiciones compartidas (invitado tras OTP verificado + autenticado)
// ---------------------------------------------------------------------------

export type TransitionToVerificationProcessingOutcome =
  | { outcome: 'transitioned' }
  | { outcome: 'already_processing' }
  | { outcome: 'request_not_found' }
  | { outcome: 'challenge_mismatch' }
  | { outcome: 'not_pending' }

/** Paso 3 del flujo recuperable (docs/contratos-portal-v1.md §3.4) — solo invitado, tras `verifyOtp`. */
export async function transitionToVerificationProcessing(
  id: string,
  otpChallengeId: string,
): Promise<TransitionToVerificationProcessingOutcome> {
  return bookingDb.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(bookingRequestRecords)
      .where(eq(bookingRequestRecords.id, id))
      .limit(1)
      .for('update')

    if (!record) {
      return { outcome: 'request_not_found' }
    }
    if (record.otpChallengeId !== otpChallengeId) {
      return { outcome: 'challenge_mismatch' }
    }
    if (record.status === 'verification_processing') {
      return { outcome: 'already_processing' }
    }
    if (record.status !== 'pending_verification') {
      return { outcome: 'not_pending' }
    }

    await tx
      .update(bookingRequestRecords)
      .set({ status: 'verification_processing' })
      .where(and(eq(bookingRequestRecords.id, id), eq(bookingRequestRecords.status, 'pending_verification')))

    return { outcome: 'transitioned' }
  })
}

export type WriteMeetingOutcome = 'updated' | 'already_set' | 'not_found'

/**
 * Paso 7 del flujo recuperable — idempotente: si meetingId ya estaba
 * puesto, no-op. Revisión 2 de Fase 4A, punto 4: el `UPDATE`
 * (`meetingId`+`status`+`approvalExpiresAt`) y el evento de auditoría
 * `raw` de la transición `status` se confirman/revierten en la MISMA
 * transacción — antes el llamante (`completeBookingToMeeting`,
 * `verificationSteps.ts`) auditaba en una llamada aparte tras recibir
 * `'updated'`, así que un fallo justo después del `UPDATE` (antes de esa
 * segunda llamada) dejaba la transición SIN auditoría para siempre: un
 * reintento posterior encuentra `meetingId` ya escrito
 * (`already_set`) y nunca vuelve a auditar esa transición real.
 */
export async function writeMeetingIdAndPendingApproval(
  id: string,
  meetingId: string,
  approvalExpiresAt: Date,
  actor: AuditActor,
  channel: AuditChannel,
  now: Date = new Date(),
): Promise<WriteMeetingOutcome> {
  return bookingDb.transaction(async (tx) => {
    const [record] = await tx
      .select({ meetingId: bookingRequestRecords.meetingId, status: bookingRequestRecords.status })
      .from(bookingRequestRecords)
      .where(eq(bookingRequestRecords.id, id))
      .limit(1)
      .for('update')

    if (!record) {
      return 'not_found'
    }
    if (record.meetingId === meetingId) {
      return 'already_set'
    }

    const updated = await tx
      .update(bookingRequestRecords)
      .set({ meetingId, status: 'pending_approval', approvalExpiresAt })
      .where(and(eq(bookingRequestRecords.id, id), isNull(bookingRequestRecords.meetingId)))
      .returning({ id: bookingRequestRecords.id })

    if (updated.length === 0) {
      return 'already_set'
    }

    await recordRawBookingAuditEvent(
      {
        entity: 'BookingRequestRecord',
        entityId: id,
        field: 'status',
        // `record.status` es el estado real antes de este UPDATE —
        // normalmente "verification_processing", pero también puede ser
        // "contact_review_pending" (Fase 4B: un reintento resolvió una
        // ambigüedad de Contact que antes había pausado el flujo).
        previousValue: record.status,
        newValue: 'pending_approval',
        actor,
        channel,
        occurredAt: now.toISOString(),
      },
      tx,
    )

    return 'updated'
  })
}

// ---------------------------------------------------------------------------
// booking_review_records — revisión 2 de Fase 4B, punto 3/6; workflow
// durable con lease + apertura/cierre atómicos de revisión 3, puntos 1/2/3
// (packages/contracts/src/booking.ts, BookingReviewRecord). Capa fina de
// datos, sin lógica de negocio (eso vive en review.ts) — mismo principio
// que el resto de este archivo.
// ---------------------------------------------------------------------------

export type BookingReviewRow = typeof bookingReviewRecords.$inferSelect

const CONFLICT_TYPE_TO_AUDIT_REASON: Record<BookingReviewConflictType, AuditReasonCode> = {
  contact_multiple_matches: 'ContactAmbiguous',
  contact_conflicting_signals: 'ContactConflictingSignals',
  meeting_duplicate: 'MeetingDuplicate',
  meeting_contact_missing: 'MeetingContactMissing',
  meeting_contact_mismatch: 'MeetingContactMismatch',
  meeting_multiple_contacts: 'MeetingMultipleContacts',
  meeting_incompatible: 'MeetingIncompatibleDuringResume',
  meeting_gcs_exclusion_mismatch: 'MeetingGcsExclusionMismatch',
}

/** true si ambos arrays contienen exactamente los mismos IDs opacos (orden indiferente) — null solo es igual a null. */
function sameOpaqueIdSet(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  if (a.length !== b.length) {
    return false
  }
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

export type OpenBookingReviewOutcome =
  | { outcome: 'opened'; review: BookingReviewRow }
  | { outcome: 'idempotent_existing'; review: BookingReviewRow }
  | { outcome: 'conflict_existing_review'; review: BookingReviewRow }
  /**
   * Revisión 4 de Fase 4B, punto 1: `input.replaces` no autoriza el
   * reemplazo — la revisión activa ya no es (`id`), o ya no está
   * `processing` con ESTE `claimToken` exacto y lease vigente (otro
   * propietario la reclamó, o el lease venció y fue recuperado). Ninguna
   * fila se modifica en este caso: ni la revisión vieja, ni la solicitud, ni
   * se crea ninguna revisión nueva.
   */
  | { outcome: 'lease_lost' }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_state' }

export interface OpenBookingReviewInput {
  bookingRequestId: string
  conflictType: BookingReviewConflictType
  candidateContactIds: string[] | null
  candidateMeetingIds: string[] | null
  /** Plazo de la revisión NUEVA — nunca un valor fijo importado de contracts.ts directamente (ver `review.ts`, configurable vía `BOOKING_CONTACT_REVIEW_HOLD_HOURS`). */
  holdHours: number
  /**
   * Revisión 3, punto 2 / revisión 4, punto 1: si se pasa, DEBE identificar
   * la revisión activa que un reanudador ya tiene reclamada
   * (`review.ts::claimBookingReview`) — `reviewId` Y `claimToken`, nunca
   * solo el id. Esa revisión se marca `replaced` en la MISMA transacción en
   * vez de tratarse como "ya existe una revisión activa" (que devolvería
   * `conflict_existing_review`/`idempotent_existing` sin crear nada) SOLO
   * SI: `reviewId` coincide con la revisión activa actual, su `status`
   * sigue siendo `processing`, su `claimToken` coincide exactamente, y su
   * `leaseExpiresAt` sigue vigente según el reloj autoritativo DE POSTGRES
   * (`now()` evaluado por el propio motor, nunca un `Date` de Node) — si
   * cualquiera de estas condiciones falla (otro worker reclamó la revisión
   * mientras tanto, el lease venció, o ya no es la revisión activa),
   * `outcome: 'lease_lost'` y NINGUNA fila se modifica. Usado cuando la
   * reanudación misma topa con OTRO conflicto: la revisión vieja nunca
   * queda cerrada sin salida, la nueva es la única activa a partir de ahí —
   * pero solo si quien reanuda sigue siendo, de verdad, su propietario.
   */
  replaces?: { reviewId: string; claimToken: string }
}

/**
 * Revisión 3 de Fase 4B, punto 1: apertura ATÓMICA — sustituye la secuencia
 * previa `transitionToContactReviewPending` + `createBookingReview`
 * (dos transacciones separadas, ventana real entre ambas donde
 * `contact_review_pending` podía quedar sin ninguna revisión detrás si el
 * proceso caía justo entre medias). Todo en UNA transacción:
 *
 *   1. Bloquea `BookingRequestRecord` (`SELECT ... FOR UPDATE`) — serializa
 *      cualquier apertura concurrente para el MISMO `bookingRequestId`
 *      contra esta misma puerta, sin depender solo del índice único de
 *      abajo.
 *   2. Comprueba que sigue en `verification_processing` (primera apertura)
 *      o ya en `contact_review_pending` (reentrada durante una
 *      reanudación, ver `replacesReviewId`) — cualquier otro estado es
 *      `invalid_state`, nunca se abre una revisión "flotante".
 *   3. Comprueba si ya existe una revisión ACTIVA (`pending`/`processing`)
 *      para esta solicitud:
 *      - Si es exactamente la indicada en `replacesReviewId`: se marca
 *        `replaced` y se continúa (paso 4).
 *      - Si es OTRA revisión activa y el conflicto es "compatible" (mismo
 *        `conflictType` + mismos candidatos — el caso real: dos aperturas
 *        concurrentes que calculan el MISMO conflicto de forma
 *        independiente, p. ej. dos verificaciones del mismo invitado casi a
 *        la vez): se devuelve idempotentemente esa revisión existente, sin
 *        crear una segunda.
 *      - Si es OTRA revisión activa con un conflicto INCOMPATIBLE (el
 *        estado cambió entre ambos cálculos): `conflict_existing_review`,
 *        nunca se crea una segunda revisión activa ni se sobrescribe la
 *        existente.
 *   4. Crea el `BookingReviewRecord` (`pending`) + transiciona
 *      `BookingRequestRecord` a `contact_review_pending` si venía de
 *      `verification_processing` (no-op de estado si ya estaba, caso
 *      `replacesReviewId`) + ambas auditorías — todo confirmado o
 *      revertido junto.
 *
 * Índice único parcial (`booking_review_records_active_booking_request_id_key`,
 * `db/schema.ts`) como defensa en profundidad: si por cualquier vía ajena a
 * esta función se intentara un segundo INSERT activo, Postgres lo rechaza.
 */
export async function openBookingReviewAtomic(
  input: OpenBookingReviewInput,
  actor: AuditActor,
  channel: AuditChannel,
  now: Date = new Date(),
): Promise<OpenBookingReviewOutcome> {
  return bookingDb.transaction(async (tx) => {
    const [record] = await tx
      .select({ status: bookingRequestRecords.status })
      .from(bookingRequestRecords)
      .where(eq(bookingRequestRecords.id, input.bookingRequestId))
      .limit(1)
      .for('update')

    if (!record) {
      return { outcome: 'not_found' }
    }
    if (record.status !== 'verification_processing' && record.status !== 'contact_review_pending') {
      return { outcome: 'invalid_state' }
    }

    const [existing] = await tx
      .select()
      .from(bookingReviewRecords)
      .where(and(eq(bookingReviewRecords.bookingRequestId, input.bookingRequestId), inArray(bookingReviewRecords.status, ['pending', 'processing'])))
      .limit(1)
      .for('update')

    if (input.replaces) {
      // Revisión 4, punto 1: `replaces` NUNCA se acepta solo por el
      // `reviewId` — debe seguir siendo, EN ESTE INSTANTE, la revisión
      // activa, `processing`, con este `claimToken` exacto y lease vigente.
      // Cualquier discrepancia (otro worker la reclamó, el lease venció, ya
      // se cerró/reemplazó por otra vía) es `lease_lost`: no se modifica
      // absolutamente nada, ni siquiera se llega a crear la revisión nueva.
      if (!existing || existing.id !== input.replaces.reviewId) {
        return { outcome: 'lease_lost' }
      }

      const replaced = await tx
        .update(bookingReviewRecords)
        .set({ status: 'replaced', resolvedAt: now, claimToken: null, claimedAt: null, leaseExpiresAt: null })
        .where(
          and(
            eq(bookingReviewRecords.id, existing.id),
            eq(bookingReviewRecords.status, 'processing'),
            eq(bookingReviewRecords.claimToken, input.replaces.claimToken),
            // Reloj autoritativo DE POSTGRES (revisión 4, punto 5) — nunca
            // el `now` de Node recibido como parámetro, que pudo capturarse
            // antes de I/O real (EspoCRM) con latencia impredecible.
            gt(bookingReviewRecords.leaseExpiresAt, sql`now()`),
          ),
        )
        .returning({ id: bookingReviewRecords.id })

      if (replaced.length === 0) {
        return { outcome: 'lease_lost' }
      }

      await recordRawBookingAuditEvent(
        {
          entity: 'BookingReviewRecord',
          entityId: existing.id,
          field: 'status',
          previousValue: existing.status,
          newValue: 'replaced',
          reasonCode: 'ContactReviewReplaced',
          actor,
          channel,
          occurredAt: now.toISOString(),
        },
        tx,
      )
    } else if (existing) {
      const compatible =
        existing.conflictType === input.conflictType &&
        sameOpaqueIdSet(existing.candidateContactIds, input.candidateContactIds) &&
        sameOpaqueIdSet(existing.candidateMeetingIds, input.candidateMeetingIds)

      if (!compatible) {
        return { outcome: 'conflict_existing_review', review: existing }
      }

      if (record.status === 'verification_processing') {
        await tx
          .update(bookingRequestRecords)
          .set({ status: 'contact_review_pending' })
          .where(and(eq(bookingRequestRecords.id, input.bookingRequestId), eq(bookingRequestRecords.status, 'verification_processing')))
        await recordRawBookingAuditEvent(
          {
            entity: 'BookingRequestRecord',
            entityId: input.bookingRequestId,
            field: 'status',
            previousValue: 'verification_processing',
            newValue: 'contact_review_pending',
            reasonCode: CONFLICT_TYPE_TO_AUDIT_REASON[input.conflictType],
            actor,
            channel,
            occurredAt: now.toISOString(),
          },
          tx,
        )
      }
      return { outcome: 'idempotent_existing', review: existing }
    }

    const expiresAt = new Date(now.getTime() + input.holdHours * 60 * 60 * 1000)
    const [created] = await tx
      .insert(bookingReviewRecords)
      .values({
        bookingRequestId: input.bookingRequestId,
        conflictType: input.conflictType,
        candidateContactIds: input.candidateContactIds,
        candidateMeetingIds: input.candidateMeetingIds,
        status: 'pending',
        expiresAt,
      })
      .returning()

    if (!created) {
      throw new Error('No se pudo crear BookingReviewRecord.')
    }

    if (record.status === 'verification_processing') {
      await tx
        .update(bookingRequestRecords)
        .set({ status: 'contact_review_pending' })
        .where(and(eq(bookingRequestRecords.id, input.bookingRequestId), eq(bookingRequestRecords.status, 'verification_processing')))
      await recordRawBookingAuditEvent(
        {
          entity: 'BookingRequestRecord',
          entityId: input.bookingRequestId,
          field: 'status',
          previousValue: 'verification_processing',
          newValue: 'contact_review_pending',
          reasonCode: CONFLICT_TYPE_TO_AUDIT_REASON[input.conflictType],
          actor,
          channel,
          occurredAt: now.toISOString(),
        },
        tx,
      )
    }

    await recordRawBookingAuditEvent(
      {
        entity: 'BookingReviewRecord',
        entityId: created.id,
        field: 'status',
        previousValue: null,
        newValue: 'pending',
        actor,
        channel,
        occurredAt: now.toISOString(),
        reasonCode: CONFLICT_TYPE_TO_AUDIT_REASON[input.conflictType],
      },
      tx,
    )

    return { outcome: 'opened', review: created }
  })
}

export async function findBookingReviewById(id: string): Promise<BookingReviewRow | null> {
  const [row] = await bookingDb.select().from(bookingReviewRecords).where(eq(bookingReviewRecords.id, id)).limit(1)
  return row ?? null
}

/** La revisión ACTIVA (si la hay) de una solicitud — a lo sumo una `pending`/`processing` por bookingRequestId en un momento dado (índice único parcial, `db/schema.ts`). */
export async function findActiveBookingReviewByBookingRequestId(bookingRequestId: string): Promise<BookingReviewRow | null> {
  const [row] = await bookingDb
    .select()
    .from(bookingReviewRecords)
    .where(and(eq(bookingReviewRecords.bookingRequestId, bookingRequestId), inArray(bookingReviewRecords.status, ['pending', 'processing'])))
    .limit(1)
  return row ?? null
}

/**
 * Listado paginado para el endpoint interno — SOLO columnas no sensibles
 * (nunca `candidateContactIds`/`candidateMeetingIds` en el LISTADO; el
 * detalle de una revisión concreta, `findBookingReviewById`, sí los expone
 * — revisión 3, punto 5 — pero sigue siendo `internal/**`, protegido por
 * `X-Internal-Api-Secret`, y nunca PII).
 */
export async function listPendingBookingReviews(limit = 50, offset = 0): Promise<
  Pick<BookingReviewRow, 'id' | 'bookingRequestId' | 'conflictType' | 'createdAt' | 'expiresAt'>[]
> {
  return bookingDb
    .select({
      id: bookingReviewRecords.id,
      bookingRequestId: bookingReviewRecords.bookingRequestId,
      conflictType: bookingReviewRecords.conflictType,
      createdAt: bookingReviewRecords.createdAt,
      expiresAt: bookingReviewRecords.expiresAt,
    })
    .from(bookingReviewRecords)
    .where(eq(bookingReviewRecords.status, 'pending'))
    .orderBy(bookingReviewRecords.createdAt)
    .limit(limit)
    .offset(offset)
}

/** Total de revisiones `pending` — para la metadata de paginación del endpoint interno (revisión 3, punto 5). */
export async function countPendingBookingReviews(): Promise<number> {
  const [row] = await bookingDb.select({ total: count() }).from(bookingReviewRecords).where(eq(bookingReviewRecords.status, 'pending'))
  return row?.total ?? 0
}

/** Revisiones `pending` cuyo `expiresAt` ya venció — candidatas al barrido de caducidad (reconciliation.ts). Nunca incluye `processing` — ver `listStaleProcessingBookingReviews`. */
export async function listExpiredBookingReviews(now: Date): Promise<BookingReviewRow[]> {
  return bookingDb
    .select()
    .from(bookingReviewRecords)
    .where(and(eq(bookingReviewRecords.status, 'pending'), lt(bookingReviewRecords.expiresAt, now)))
}

// ---------------------------------------------------------------------------
// Workflow durable con lease — revisión 3 de Fase 4B, punto 2. Mismo patrón
// exacto que el lease de `booking_outbox_jobs` (revisión 3 de Fase 4A,
// punto 1): reclamo con una única `UPDATE ... WHERE ... RETURNING`, sin
// mantener ninguna transacción de Postgres abierta mientras `review.ts`
// llama al adaptador de EspoCRM (que puede ser HTTP real).
// ---------------------------------------------------------------------------

/** Duración del lease concedido en cada reclamo de revisión — una reanudación cruza I/O real (EspoCRM) con latencia impredecible; una reanudación cuyo lease vence se trata como abandonada y vuelve a ser reclamable (barrido, revisión 3 punto 9). */
const REVIEW_LEASE_DURATION_MINUTES = 5

export type ClaimedBookingReviewRow = BookingReviewRow & { claimToken: string }

export type ClaimBookingReviewOutcome =
  | { outcome: 'claimed'; review: ClaimedBookingReviewRow }
  | { outcome: 'not_found' }
  /** `processing` con lease todavía vigente (propio de otra reanudación en curso), o una carrera perdida contra otro reclamo — nunca se confunde con `already_closed`: el llamante puede reintentar más tarde. */
  | { outcome: 'in_progress' }
  | { outcome: 'already_closed' }

/**
 * Reclama atómicamente una revisión `pending`, o una `processing` cuyo
 * lease ya venció (reanudación abandonada) — única `UPDATE ... WHERE ...
 * RETURNING`, mono-fila, sin transacción envolvente. Solo el poseedor del
 * `claimToken` devuelto puede cerrarla (`closeBookingReviewResolved`) o
 * devolverla a `pending` tras un fallo transitorio
 * (`releaseBookingReviewToPending`).
 */
export async function claimBookingReview(reviewId: string, now: Date = new Date()): Promise<ClaimBookingReviewOutcome> {
  const claimToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + REVIEW_LEASE_DURATION_MINUTES * 60 * 1000)

  const updated = await bookingDb
    .update(bookingReviewRecords)
    .set({ status: 'processing', claimToken, claimedAt: now, leaseExpiresAt })
    .where(
      and(
        eq(bookingReviewRecords.id, reviewId),
        or(eq(bookingReviewRecords.status, 'pending'), and(eq(bookingReviewRecords.status, 'processing'), lt(bookingReviewRecords.leaseExpiresAt, now))),
      ),
    )
    .returning()

  const [claimed] = updated
  if (claimed) {
    return { outcome: 'claimed', review: claimed as ClaimedBookingReviewRow }
  }

  const [current] = await bookingDb.select({ status: bookingReviewRecords.status }).from(bookingReviewRecords).where(eq(bookingReviewRecords.id, reviewId)).limit(1)
  if (!current) {
    return { outcome: 'not_found' }
  }
  if (current.status === 'pending' || current.status === 'processing') {
    return { outcome: 'in_progress' }
  }
  return { outcome: 'already_closed' }
}

/**
 * Fallo transitorio durante una reanudación (p. ej. EspoCRM caído a mitad
 * de `completeBookingToMeeting`) — nunca se pierde la revisión: vuelve de
 * inmediato a `pending`, reclamable por el siguiente intento (dirigido o de
 * barrido). Solo el poseedor del `claimToken` vigente puede hacerlo — si el
 * lease ya se recuperó por otro (`lease_lost`), esta llamada NUNCA
 * sobrescribe el trabajo del nuevo propietario.
 */
export async function releaseBookingReviewToPending(reviewId: string, claimToken: string): Promise<'released' | 'lease_lost'> {
  const updated = await bookingDb
    .update(bookingReviewRecords)
    .set({ status: 'pending', claimToken: null, claimedAt: null, leaseExpiresAt: null })
    .where(and(eq(bookingReviewRecords.id, reviewId), eq(bookingReviewRecords.status, 'processing'), eq(bookingReviewRecords.claimToken, claimToken)))
    .returning({ id: bookingReviewRecords.id })
  return updated.length > 0 ? 'released' : 'lease_lost'
}

/** Revisiones `processing` cuyo lease venció — reanudaciones abandonadas, candidatas al barrido de recuperación (reconciliation.ts, revisión 3 punto 9). */
export async function listStaleProcessingBookingReviews(now: Date): Promise<BookingReviewRow[]> {
  return bookingDb
    .select()
    .from(bookingReviewRecords)
    .where(and(eq(bookingReviewRecords.status, 'processing'), lt(bookingReviewRecords.leaseExpiresAt, now)))
}

export type CloseResolvedReviewOutcome = 'closed' | 'lease_lost' | 'not_found'

/**
 * Cierra como `resolved` una revisión que el llamante ya tiene reclamada
 * (`claimToken` exacto) — usado por `review.ts::resolveBookingReview`
 * SOLO DESPUÉS de confirmar que `BookingRequestRecord` alcanzó de verdad
 * `pending_approval` (la propia reanudación, `completeBookingToMeeting`, ya
 * confirmó y auditó esa transición por su cuenta — este cierre es
 * puramente el bookkeeping de `BookingReviewRecord`, nunca vuelve a tocar
 * la solicitud). Si el lease ya se perdió (otro worker lo recuperó, o la
 * revisión ya se cerró/reemplazó por otra vía), `lease_lost` — nunca
 * sobrescribe el resultado de otro propietario.
 */
export async function closeBookingReviewResolved(
  reviewId: string,
  claimToken: string,
  resolutionContactId: string,
  resolvedBy: string,
  actor: AuditActor,
  channel: AuditChannel,
  now: Date = new Date(),
): Promise<CloseResolvedReviewOutcome> {
  return bookingDb.transaction(async (tx) => {
    const [review] = await tx
      .select({ status: bookingReviewRecords.status, claimToken: bookingReviewRecords.claimToken })
      .from(bookingReviewRecords)
      .where(eq(bookingReviewRecords.id, reviewId))
      .limit(1)
      .for('update')

    if (!review) {
      return 'not_found'
    }
    if (review.status !== 'processing' || review.claimToken !== claimToken) {
      return 'lease_lost'
    }

    const updated = await tx
      .update(bookingReviewRecords)
      .set({ status: 'resolved', resolvedAt: now, resolvedBy, resolutionContactId, claimToken: null, claimedAt: null, leaseExpiresAt: null })
      .where(and(eq(bookingReviewRecords.id, reviewId), eq(bookingReviewRecords.status, 'processing'), eq(bookingReviewRecords.claimToken, claimToken)))
      .returning({ id: bookingReviewRecords.id })

    if (updated.length === 0) {
      return 'lease_lost'
    }

    await recordRawBookingAuditEvent(
      {
        entity: 'BookingReviewRecord',
        entityId: reviewId,
        field: 'status',
        previousValue: 'processing',
        newValue: 'resolved',
        actor,
        channel,
        occurredAt: now.toISOString(),
      },
      tx,
    )

    return 'closed'
  })
}

export type CloseReviewAndResolveRequestOutcome = 'closed' | 'already_closed' | 'not_found' | 'lease_lost'

/**
 * Revisión 3 de Fase 4B, punto 3: transición transaccional COMPLETA para
 * rechazo/caducidad — cierre de `BookingReviewRecord`, resolución de
 * `BookingRequestRecord`, ambas auditorías, y marcado/purga de
 * `PendingGuestIdentity`/`PendingAuthenticatedContactDetails` — TODO en una
 * única transacción de `gapssa_booking` (todas esas tablas viven en la
 * misma base física), se confirman o revierten juntas. Antes de esta
 * revisión eran operaciones separadas (`closeBookingReview` +
 * `resolveBookingRequest` + purga, cada una su propia transacción) — un
 * fallo entre cualquiera de ellas podía dejar la revisión cerrada con la
 * solicitud todavía `contact_review_pending`, o la solicitud resuelta con
 * PII sin purgar.
 *
 * `claimToken` es obligatorio si la revisión está `processing` (reanudación
 * en curso) — sin él, o si no coincide, `lease_lost`; si la revisión sigue
 * `pending` (nunca se llegó a reclamar, camino normal de rechazo/caducidad
 * manual), no se exige.
 */
export async function closeBookingReviewAndResolveRequestTransactionally(
  reviewId: string,
  reviewTargetStatus: 'rejected' | 'expired',
  claimToken: string | null,
  resolution: 'contact_review_rejected' | 'contact_review_expired',
  reasonCode: 'ContactReviewRejectedByStaff' | 'ContactReviewExpired',
  purgeTrigger: 'review_rejected' | 'review_expired',
  resolvedBy: string | null,
  actor: AuditActor,
  channel: AuditChannel,
  now: Date = new Date(),
): Promise<CloseReviewAndResolveRequestOutcome> {
  return bookingDb.transaction(async (tx) => {
    const [review] = await tx.select().from(bookingReviewRecords).where(eq(bookingReviewRecords.id, reviewId)).limit(1).for('update')
    if (!review) {
      return 'not_found'
    }

    if (review.status === 'processing') {
      if (!claimToken || review.claimToken !== claimToken) {
        return 'lease_lost'
      }
    } else if (review.status !== 'pending') {
      return 'already_closed'
    }

    const updatedReview = await tx
      .update(bookingReviewRecords)
      .set({ status: reviewTargetStatus, resolvedAt: now, resolvedBy, resolutionContactId: null, claimToken: null, claimedAt: null, leaseExpiresAt: null })
      .where(and(eq(bookingReviewRecords.id, reviewId), inArray(bookingReviewRecords.status, ['pending', 'processing'])))
      .returning({ id: bookingReviewRecords.id })

    if (updatedReview.length === 0) {
      return 'already_closed'
    }

    await recordRawBookingAuditEvent(
      {
        entity: 'BookingReviewRecord',
        entityId: reviewId,
        field: 'status',
        previousValue: review.status,
        newValue: reviewTargetStatus,
        actor,
        channel,
        occurredAt: now.toISOString(),
      },
      tx,
    )

    const requestOutcome = await resolveBookingRequestWithinTx(tx, review.bookingRequestId, resolution, reasonCode, actor, channel, now)
    if (requestOutcome !== 'resolved') {
      // Revisión 4, punto 4: la solicitud ya estaba resuelta por otra vía
      // (p. ej. el barrido de otra pasada, o una decisión manual directa
      // mientras la revisión seguía abierta) — la revisión igualmente queda
      // cerrada arriba (nunca se deja sin salida), pero NUNCA se asume que
      // la PII ya fue purgada por esa otra vía: puede existir la misma
      // ventana real que este módulo corrige en su propio camino normal
      // (resolución confirmada, purga todavía pendiente si el proceso cayó
      // entre ambos pasos). Se comprueba el estado REAL, dentro de la MISMA
      // transacción, y se purga solo si `decidePendingGuestIdentityPurgeTrigger`
      // puede determinar un disparador seguro a partir de él — nunca a
      // ciegas, nunca inventando una decisión.
      const [currentRequest] = await tx
        .select({
          status: bookingRequestRecords.status,
          resolution: bookingRequestRecords.resolution,
          meetingId: bookingRequestRecords.meetingId,
          clientAccountId: bookingRequestRecords.clientAccountId,
        })
        .from(bookingRequestRecords)
        .where(eq(bookingRequestRecords.id, review.bookingRequestId))
        .limit(1)

      if (currentRequest) {
        // `now` sirve aquí solo como `recoveryDeadline` — irrelevante en la
        // práctica porque `currentRequest.status` nunca es
        // `verification_processing` en este punto (la única rama que la
        // usa), pero `decidePendingGuestIdentityPurgeTrigger` exige el
        // parámetro.
        const trigger = decidePendingGuestIdentityPurgeTrigger(currentRequest, now, now)
        if (trigger) {
          // Idempotente: purgePending*WithinTx no-opea (sin volver a
          // auditar) si la fila ya no está `active` — seguro llamarlo
          // aunque la purga real ya hubiera ocurrido.
          if (currentRequest.clientAccountId) {
            await purgePendingAuthenticatedContactDetailsWithinTx(tx, review.bookingRequestId, trigger, now)
          } else {
            await purgePendingGuestIdentityWithinTx(tx, review.bookingRequestId, trigger, now)
          }
        }
        // trigger === null: el estado real no permite determinar una purga
        // segura desde aquí — se deja para que el barrido de conciliación
        // (`listRequestsWithOrphanedActivePii`) lo cuente como inconsistencia,
        // nunca se purga a ciegas.
      }

      return 'closed'
    }

    const [record] = await tx
      .select({ clientAccountId: bookingRequestRecords.clientAccountId })
      .from(bookingRequestRecords)
      .where(eq(bookingRequestRecords.id, review.bookingRequestId))
      .limit(1)

    if (record?.clientAccountId) {
      await purgePendingAuthenticatedContactDetailsWithinTx(tx, review.bookingRequestId, purgeTrigger, now)
    } else {
      await purgePendingGuestIdentityWithinTx(tx, review.bookingRequestId, purgeTrigger, now)
    }

    return 'closed'
  })
}

// ---------------------------------------------------------------------------
// Conciliación de revisiones — revisión 3 de Fase 4B, punto 9. Solo
// DETECTAN estados parciales/heredados; nunca deciden qué Contact es
// correcto ni resuelven nada por su cuenta — `reconciliation.ts` los cuenta
// como `reviewInconsistencies` para revisión manual (mismo principio que
// `inconsistentMeetings`).
// ---------------------------------------------------------------------------

/** `contact_review_pending` sin ninguna revisión activa (`pending`/`processing`) detrás — el mismo tipo de fallo que la apertura atómica (punto 1) existe para prevenir, detectado aquí por si ocurrió antes de esta revisión o por una vía ajena a `openBookingReviewAtomic`. */
export async function listContactReviewPendingRequestsWithoutActiveReview(): Promise<BookingRequestRow[]> {
  const rows = await bookingDb
    .select({ request: bookingRequestRecords })
    .from(bookingRequestRecords)
    .leftJoin(
      bookingReviewRecords,
      and(eq(bookingReviewRecords.bookingRequestId, bookingRequestRecords.id), inArray(bookingReviewRecords.status, ['pending', 'processing'])),
    )
    .where(and(eq(bookingRequestRecords.status, 'contact_review_pending'), isNull(bookingReviewRecords.id)))
  return rows.map((row) => row.request)
}

/** Revisión activa (`pending`/`processing`) cuya solicitud YA NO está `contact_review_pending` (se resolvió/expiró/aprobó por otra vía sin cerrar la revisión) — nunca debería ocurrir pasando siempre por las puertas de este archivo, detectado igualmente por si una migración/incidente previo lo produjo. */
export async function listOrphanedActiveBookingReviews(): Promise<BookingReviewRow[]> {
  const rows = await bookingDb
    .select({ review: bookingReviewRecords })
    .from(bookingReviewRecords)
    .innerJoin(bookingRequestRecords, eq(bookingRequestRecords.id, bookingReviewRecords.bookingRequestId))
    .where(and(inArray(bookingReviewRecords.status, ['pending', 'processing']), ne(bookingRequestRecords.status, 'contact_review_pending')))
  return rows.map((row) => row.review)
}

/**
 * Más de una revisión activa para el mismo `bookingRequestId` — inalcanzable
 * hacia delante gracias al índice único parcial (`db/schema.ts`), pero
 * puede existir en datos heredados de antes de esa migración. Nunca se
 * elige una automáticamente; solo se reporta para que un operador decida
 * cuál es la vigente.
 */
export async function listDuplicateActiveBookingReviewGroups(): Promise<{ bookingRequestId: string; reviewIds: string[] }[]> {
  const rows = await bookingDb
    .select({ bookingRequestId: bookingReviewRecords.bookingRequestId, id: bookingReviewRecords.id })
    .from(bookingReviewRecords)
    .where(inArray(bookingReviewRecords.status, ['pending', 'processing']))

  const byRequest = new Map<string, string[]>()
  for (const row of rows) {
    const list = byRequest.get(row.bookingRequestId) ?? []
    list.push(row.id)
    byRequest.set(row.bookingRequestId, list)
  }
  return [...byRequest.entries()].filter(([, ids]) => ids.length > 1).map(([bookingRequestId, reviewIds]) => ({ bookingRequestId, reviewIds }))
}

// ---------------------------------------------------------------------------
// Conciliación de revisiones huérfanas tras éxito durable — revisión 4 de
// Fase 4B, punto 2. Ventana real e inevitable: `completeBookingToMeeting`
// confirma `Meeting`/`meetingId`/`pending_approval` y purga la PII en pasos
// separados (no una única transacción distribuida con EspoCRM); si el
// proceso cae o pierde el lease entre ese resultado durable y
// `closeBookingReviewResolved`, la revisión queda activa indefinidamente
// aunque el resultado real ya sea correcto. Nunca vuelve a elegir Contact,
// nunca llama a `findOrCreateContact`, nunca crea otro Meeting — el
// resultado durable YA demuestra que el flujo terminó, esto es solo
// bookkeeping de `BookingReviewRecord`.
// ---------------------------------------------------------------------------

export type BookingReviewRowWithRequestStatus = BookingReviewRow & { bookingRequestStatus: BookingRequestRow['status'] }

/**
 * Revisiones activas (`pending`/`processing`) cuya `BookingRequestRecord` ya
 * demuestra un resultado durable de éxito: `meetingId` escrito Y `status` en
 * `pending_approval` (la reanudación llegó al final) o `resolved` (una
 * decisión posterior — aprobación/rechazo/caducidad del centro — ya cerró el
 * ciclo completo). Candidatas al cierre seguro de
 * `closeOrphanedBookingReviewAfterLinkedRequest`.
 */
export async function listActiveBookingReviewsForLinkedRequests(): Promise<BookingReviewRowWithRequestStatus[]> {
  const rows = await bookingDb
    .select({ review: bookingReviewRecords, bookingRequestStatus: bookingRequestRecords.status })
    .from(bookingReviewRecords)
    .innerJoin(bookingRequestRecords, eq(bookingRequestRecords.id, bookingReviewRecords.bookingRequestId))
    .where(
      and(
        inArray(bookingReviewRecords.status, ['pending', 'processing']),
        isNotNull(bookingRequestRecords.meetingId),
        inArray(bookingRequestRecords.status, ['pending_approval', 'resolved']),
      ),
    )
  return rows.map((row) => ({ ...row.review, bookingRequestStatus: row.bookingRequestStatus }))
}

export type CloseOrphanedReviewAfterLinkedRequestOutcome = 'reconciled' | 'skipped_active_lease' | 'already_closed'

/**
 * Cierra como `resolved` una revisión huérfana cuya solicitud ya demuestra
 * éxito durable — CAS puro, sin exigir ningún `claimToken` del llamante (el
 * barrido no es su propietario, nunca lo reclama primero):
 *
 *   - `pending`: cierre directo.
 *   - `processing` con lease YA VENCIDO (reloj de Postgres): se recupera y
 *     cierra en la misma operación — una reanudación abandonada cuyo
 *     resultado ya es durable no necesita esperar a
 *     `recoverStaleProcessingReviews` primero.
 *   - `processing` con lease VIGENTE: `skipped_active_lease` — nunca se le
 *     arrebata la fila a un worker activo; queda para una pasada posterior.
 *
 * `resolvedBy`/`resolutionContactId` quedan `null` (nunca se inventa qué
 * operador o qué Contact "decidió" esto — es bookkeeping de conciliación,
 * no una decisión humana).
 */
export async function closeOrphanedBookingReviewAfterLinkedRequest(
  reviewId: string,
  actor: AuditActor,
  channel: AuditChannel,
  now: Date = new Date(),
): Promise<CloseOrphanedReviewAfterLinkedRequestOutcome> {
  return bookingDb.transaction(async (tx) => {
    const [review] = await tx
      .select({ status: bookingReviewRecords.status })
      .from(bookingReviewRecords)
      .where(eq(bookingReviewRecords.id, reviewId))
      .limit(1)
      .for('update')

    if (!review || (review.status !== 'pending' && review.status !== 'processing')) {
      return 'already_closed'
    }

    const updated = await tx
      .update(bookingReviewRecords)
      .set({ status: 'resolved', resolvedAt: now, resolvedBy: null, resolutionContactId: null, claimToken: null, claimedAt: null, leaseExpiresAt: null })
      .where(
        and(
          eq(bookingReviewRecords.id, reviewId),
          or(
            eq(bookingReviewRecords.status, 'pending'),
            and(eq(bookingReviewRecords.status, 'processing'), lt(bookingReviewRecords.leaseExpiresAt, sql`now()`)),
          ),
        ),
      )
      .returning({ id: bookingReviewRecords.id })

    if (updated.length === 0) {
      // O bien seguía `processing` con lease vigente (nunca se arrebata), o
      // bien otra pasada/petición ya la cerró entre el SELECT y el UPDATE —
      // el `SELECT ... FOR UPDATE` de arriba serializa esto último, así que
      // en la práctica solo puede ser lease vigente.
      return review.status === 'processing' ? 'skipped_active_lease' : 'already_closed'
    }

    await recordRawBookingAuditEvent(
      {
        entity: 'BookingReviewRecord',
        entityId: reviewId,
        field: 'status',
        previousValue: review.status,
        newValue: 'resolved',
        reasonCode: 'ContactReviewReconciledAfterBookingLinked',
        actor,
        channel,
        occurredAt: now.toISOString(),
      },
      tx,
    )

    return 'reconciled'
  })
}

// ---------------------------------------------------------------------------
// Conciliación de PII huérfana tras un resultado durable — revisión 4 de
// Fase 4B, punto 4. Misma ventana de fondo que la sección anterior, pero
// del lado de `PendingGuestIdentity`/`PendingAuthenticatedContactDetails` en
// vez de `BookingReviewRecord`: `meetingId` escrito o la solicitud ya
// `resolved`, con la identidad pendiente todavía `active`.
// ---------------------------------------------------------------------------

export type BookingRequestWithOrphanedPii = Pick<BookingRequestRow, 'id' | 'status' | 'resolution' | 'meetingId' | 'clientAccountId'>

/**
 * Solicitudes con `meetingId` ya escrito, o ya `resolved`, cuya identidad
 * pendiente (invitado o cliente autenticado) sigue `active` — candidatas al
 * disparador seguro de `decidePendingGuestIdentityPurgeTrigger`
 * (`review.ts::reconcileOrphanedPendingPii`). Nunca incluye solicitudes
 * todavía en curso sin Meeting (`pending_verification`/
 * `verification_processing`/`contact_review_pending` sin `meetingId`): ahí
 * la identidad SIGUE haciendo falta, conservarla es lo correcto.
 */
export async function listRequestsWithOrphanedActivePii(): Promise<BookingRequestWithOrphanedPii[]> {
  const candidateCondition = or(eq(bookingRequestRecords.status, 'resolved'), isNotNull(bookingRequestRecords.meetingId))

  const guestRows = await bookingDb
    .select({
      id: bookingRequestRecords.id,
      status: bookingRequestRecords.status,
      resolution: bookingRequestRecords.resolution,
      meetingId: bookingRequestRecords.meetingId,
      clientAccountId: bookingRequestRecords.clientAccountId,
    })
    .from(bookingRequestRecords)
    .innerJoin(pendingGuestIdentities, eq(pendingGuestIdentities.bookingRequestId, bookingRequestRecords.id))
    .where(and(eq(pendingGuestIdentities.status, 'active'), candidateCondition))

  const authRows = await bookingDb
    .select({
      id: bookingRequestRecords.id,
      status: bookingRequestRecords.status,
      resolution: bookingRequestRecords.resolution,
      meetingId: bookingRequestRecords.meetingId,
      clientAccountId: bookingRequestRecords.clientAccountId,
    })
    .from(bookingRequestRecords)
    .innerJoin(pendingAuthenticatedContactDetails, eq(pendingAuthenticatedContactDetails.bookingRequestId, bookingRequestRecords.id))
    .where(and(eq(pendingAuthenticatedContactDetails.status, 'active'), candidateCondition))

  return [...guestRows, ...authRows]
}

// ---------------------------------------------------------------------------
// pending_authenticated_contact_details — revisión 2 de Fase 4B, punto 3
// (packages/contracts/src/booking.ts, PendingAuthenticatedContactDetails).
// Contraparte de pending_guest_identities para el flujo de cliente
// autenticado — mismo patrón exacto, sin `email`/`gapssaAccountId` (se
// derivan siempre de `clientAccountId`).
// ---------------------------------------------------------------------------

export type PendingAuthenticatedContactDetailsRow = typeof pendingAuthenticatedContactDetails.$inferSelect

export interface EncryptedAuthenticatedContactInput {
  firstName: EncryptedField
  lastName: EncryptedField
  phone: EncryptedField
}

/** Se llama dentro de la MISMA transacción que `createAuthenticatedBookingRequest` — mismo motivo que `pendingGuestIdentities` en `createGuestBookingRequest`. */
export async function insertPendingAuthenticatedContactDetailsWithinTx(
  tx: BookingTx,
  bookingRequestId: string,
  identity: EncryptedAuthenticatedContactInput,
  expiresAt: Date,
): Promise<void> {
  await tx.insert(pendingAuthenticatedContactDetails).values({
    bookingRequestId,
    firstNameCiphertext: identity.firstName.ciphertext,
    firstNameNonce: identity.firstName.nonce,
    firstNameKeyVersion: identity.firstName.keyVersion,
    lastNameCiphertext: identity.lastName.ciphertext,
    lastNameNonce: identity.lastName.nonce,
    lastNameKeyVersion: identity.lastName.keyVersion,
    phoneCiphertext: identity.phone.ciphertext,
    phoneNonce: identity.phone.nonce,
    phoneKeyVersion: identity.phone.keyVersion,
    status: 'active',
    expiresAt,
  })
}

export async function findPendingAuthenticatedContactDetails(bookingRequestId: string): Promise<PendingAuthenticatedContactDetailsRow | null> {
  const [row] = await bookingDb
    .select()
    .from(pendingAuthenticatedContactDetails)
    .where(and(eq(pendingAuthenticatedContactDetails.bookingRequestId, bookingRequestId), eq(pendingAuthenticatedContactDetails.status, 'active')))
    .limit(1)
  return row ?? null
}

/**
 * Cuerpo reutilizable de `purgePendingAuthenticatedContactDetails`,
 * asumiendo que `tx` YA es una transacción abierta por el llamante — usado
 * por `closeBookingReviewAndResolveRequestTransactionally` (revisión 3,
 * punto 3) para que el marcado/DELETE de esta tabla se confirme/revierta
 * junto con el cierre de la revisión y la resolución de la solicitud.
 * Mismo patrón que `resolveBookingRequestWithinTx`.
 */
export async function purgePendingAuthenticatedContactDetailsWithinTx(
  tx: BookingTx,
  bookingRequestId: string,
  trigger: PendingGuestIdentityPurgeTrigger,
  now: Date,
): Promise<void> {
  const targetStatus = trigger === 'meeting_linked' ? ('consumed' as const) : ('discarded' as const)

  const updated = await tx
    .update(pendingAuthenticatedContactDetails)
    .set({ status: targetStatus })
    .where(and(eq(pendingAuthenticatedContactDetails.bookingRequestId, bookingRequestId), eq(pendingAuthenticatedContactDetails.status, 'active')))
    .returning({ id: pendingAuthenticatedContactDetails.id })

  if (updated.length === 0) {
    return
  }

  await recordRawBookingAuditEvent(
    {
      entity: 'PendingAuthenticatedContactDetails',
      entityId: bookingRequestId,
      field: 'status',
      previousValue: 'active',
      newValue: targetStatus,
      actor: { type: 'system', name: 'bff' },
      channel: 'web',
      occurredAt: now.toISOString(),
      reasonCode: PURGE_TRIGGER_REASON_CODE[trigger],
    },
    tx,
  )

  await tx.delete(pendingAuthenticatedContactDetails).where(eq(pendingAuthenticatedContactDetails.bookingRequestId, bookingRequestId))
}

/** Mismo patrón exacto que `purgePendingGuestIdentity` — ver ese comentario. */
export async function purgePendingAuthenticatedContactDetails(
  bookingRequestId: string,
  trigger: PendingGuestIdentityPurgeTrigger,
  now: Date = new Date(),
): Promise<void> {
  await bookingDb.transaction((tx) => purgePendingAuthenticatedContactDetailsWithinTx(tx, bookingRequestId, trigger, now))
}

/**
 * Motivo técnico auditable por disparador de purga — solo dos de los tres
 * disparadores alcanzables en esta fase (`meeting_linked` no tiene un
 * `AuditReasonCode` propio: no es un motivo de rechazo/expiración, así que
 * `reasonCode` queda `undefined`, campo opcional en `RawAuditEntry`).
 */
const PURGE_TRIGGER_REASON_CODE: Partial<Record<PendingGuestIdentityPurgeTrigger, AuditReasonCode>> = {
  verification_expired: 'VerificationExpired',
  recovery_window_exceeded: 'RecoveryWindowExceeded',
  review_rejected: 'ContactReviewRejectedByStaff',
  review_expired: 'ContactReviewExpired',
}

/**
 * Paso 8 del flujo recuperable — marca la transición (auditada,
 * `PendingGuestIdentity.status`: `active -> consumed|discarded`) y borra
 * físicamente poco después, en la misma transacción (booking.ts: "DELETE
 * físico... el job de limpieza la elimina poco después de marcarla" — aquí
 * "poco después" es la misma transacción, no una pasada aparte, porque no
 * hay ningún motivo para retener una fila ya marcada ni un segundo hueco de
 * inconsistencia que cubrir). Idempotente: si la fila ya no está `active`
 * (purgada por un intento anterior), no-op, sin volver a auditar.
 */
/**
 * Cuerpo reutilizable de `purgePendingGuestIdentity`, asumiendo que `tx` YA
 * es una transacción abierta por el llamante — mismo motivo que
 * `purgePendingAuthenticatedContactDetailsWithinTx`.
 */
export async function purgePendingGuestIdentityWithinTx(
  tx: BookingTx,
  bookingRequestId: string,
  trigger: PendingGuestIdentityPurgeTrigger,
  now: Date,
): Promise<void> {
  const targetStatus = trigger === 'meeting_linked' ? ('consumed' as const) : ('discarded' as const)

  const updated = await tx
    .update(pendingGuestIdentities)
    .set({ status: targetStatus })
    .where(and(eq(pendingGuestIdentities.bookingRequestId, bookingRequestId), eq(pendingGuestIdentities.status, 'active')))
    .returning({ id: pendingGuestIdentities.id })

  if (updated.length === 0) {
    return
  }

  await recordRawBookingAuditEvent(
    {
      entity: 'PendingGuestIdentity',
      entityId: bookingRequestId,
      field: 'status',
      previousValue: 'active',
      newValue: targetStatus,
      actor: { type: 'guest', guestId: bookingRequestId },
      channel: 'web',
      occurredAt: now.toISOString(),
      reasonCode: PURGE_TRIGGER_REASON_CODE[trigger],
    },
    tx,
  )

  await tx.delete(pendingGuestIdentities).where(eq(pendingGuestIdentities.bookingRequestId, bookingRequestId))
}

export async function purgePendingGuestIdentity(
  bookingRequestId: string,
  trigger: PendingGuestIdentityPurgeTrigger,
  now: Date = new Date(),
): Promise<void> {
  await bookingDb.transaction((tx) => purgePendingGuestIdentityWithinTx(tx, bookingRequestId, trigger, now))
}

export type ResolveBookingRequestOutcome = 'resolved' | 'already_resolved' | 'not_found'

/** `BookingRequestRecord.reasonCode` (BOOKING_REASON_CODES) y `AuditEntry.reasonCode` (AUDIT_REASON_CODES) son dos enums distintos que casi coinciden por nombre — único desajuste real: "Approved" aquí es "ApprovedByStaff" en auditoría. */
const BOOKING_REASON_TO_AUDIT_REASON: Record<BookingReasonCode, AuditReasonCode> = {
  Approved: 'ApprovedByStaff',
  RejectedByStaff: 'RejectedByStaff',
  ApprovalExpired: 'ApprovalExpired',
  VerificationExpired: 'VerificationExpired',
  RecoveryWindowExceeded: 'RecoveryWindowExceeded',
  ContactReviewRejectedByStaff: 'ContactReviewRejectedByStaff',
  ContactReviewExpired: 'ContactReviewExpired',
}

/**
 * Resuelve la solicitud (`status -> "resolved"`) y audita la transición de
 * `resolution` (`null -> valor`, dominio válido para valores en crudo —
 * ver `RAW_VALUE_VALIDATORS` en `packages/contracts/src/audit.ts`) en la
 * MISMA transacción — negocio y auditoría se confirman o revierten juntos,
 * mismo principio que `completePasswordReset` (Fase 3).
 */
/**
 * Cuerpo reutilizable de `resolveBookingRequest`, asumiendo que `tx` YA es
 * una transacción abierta por el llamante — usado por
 * `decisionRecovery.ts` para combinar la decisión del Meeting (adaptador
 * simulado) y la resolución de la solicitud en una única transacción de
 * `gapssa_booking` cuando ambas tablas viven en la misma base de datos
 * física. Nunca abre su propia transacción (a diferencia de
 * `resolveBookingRequest`) — hacerlo anidada dentro de otra no está
 * soportado de forma segura por el driver.
 */
export async function resolveBookingRequestWithinTx(
  tx: BookingTx,
  id: string,
  resolution: BookingRequestResolution,
  reasonCode: BookingReasonCode,
  actor: AuditActor,
  channel: AuditChannel,
  now: Date,
): Promise<ResolveBookingRequestOutcome> {
  const [record] = await tx
    .select({ status: bookingRequestRecords.status })
    .from(bookingRequestRecords)
    .where(eq(bookingRequestRecords.id, id))
    .limit(1)
    .for('update')

  if (!record) {
    return 'not_found'
  }
  if (record.status === 'resolved') {
    return 'already_resolved'
  }

  const updated = await tx
    .update(bookingRequestRecords)
    .set({ status: 'resolved', resolvedAt: now, resolution, reasonCode })
    .where(and(eq(bookingRequestRecords.id, id), ne(bookingRequestRecords.status, 'resolved')))
    .returning({ id: bookingRequestRecords.id })

  if (updated.length === 0) {
    return 'already_resolved'
  }

  await recordRawBookingAuditEvent(
    {
      entity: 'BookingRequestRecord',
      entityId: id,
      field: 'resolution',
      previousValue: null,
      newValue: resolution,
      actor,
      channel,
      occurredAt: now.toISOString(),
      reasonCode: BOOKING_REASON_TO_AUDIT_REASON[reasonCode],
    },
    tx,
  )

  return 'resolved'
}

/**
 * Resuelve la solicitud (`status -> "resolved"`) y audita la transición de
 * `resolution` (`null -> valor`, dominio válido para valores en crudo —
 * ver `RAW_VALUE_VALIDATORS` en `packages/contracts/src/audit.ts`) en la
 * MISMA transacción — negocio y auditoría se confirman o revierten juntos,
 * mismo principio que `completePasswordReset` (Fase 3).
 */
export async function resolveBookingRequest(
  id: string,
  resolution: BookingRequestResolution,
  reasonCode: BookingReasonCode,
  actor: AuditActor,
  channel: AuditChannel,
  now: Date = new Date(),
): Promise<ResolveBookingRequestOutcome> {
  return bookingDb.transaction((tx) => resolveBookingRequestWithinTx(tx, id, resolution, reasonCode, actor, channel, now))
}

// ---------------------------------------------------------------------------
// booking_outbox_jobs — acceso a datos del outbox de reservas (revisión 2
// de Fase 4A, punto 3; leases de revisión 3, punto 1). La orquestación
// (llamar a Redis/SMTP) vive en `otpOutbox.ts`, nunca aquí — esta capa solo
// hace lectura/escritura de Postgres, mismo principio que el resto de este
// archivo.
// ---------------------------------------------------------------------------

export type GuestVerificationOtpJobRow = typeof bookingOutboxJobs.$inferSelect
/** Job recién reclamado — `claimToken` siempre presente (lo acaba de escribir el propio reclamo), a diferencia de `GuestVerificationOtpJobRow.claimToken` (nullable en reposo). */
export type ClaimedGuestVerificationOtpJob = GuestVerificationOtpJobRow & { claimToken: string }

const GUEST_VERIFICATION_OTP_JOB_TYPE = 'send_guest_verification_otp' as const
const OUTBOX_RETRY_BACKOFF_MINUTES = 5
/**
 * Duración del lease concedido en cada reclamo — mientras no venza, ningún
 * otro reclamo (dirigido o de barrido) puede tomar el job. Si
 * `markGuestVerificationOtpJobCompleted`/`...FailedRetryable` nunca llega a
 * ejecutarse tras un reclamo (el proceso cae entre el reclamo y esa
 * escritura final, un caso distinto de "SMTP falló" que "el propio
 * bookkeeping de Postgres falló"), el job quedaría en `processing` para
 * siempre sin este mecanismo — un job cuyo `leaseExpiresAt` venció se trata
 * como abandonado y vuelve a ser reclamable por cualquier worker.
 */
const LEASE_DURATION_MINUTES = 2

/**
 * Reclamo transaccional del job, identificado por `bookingRequestId` (como
 * mucho un job de este tipo por solicitud) — una única sentencia
 * `UPDATE ... WHERE ... RETURNING`, atómica sin necesidad de mantener una
 * transacción de Postgres abierta mientras se llama a Redis/SMTP (latencia
 * real e impredecible). Genera un `claimToken` criptográficamente aleatorio
 * nuevo en cada reclamo ganado — el llamante lo pasa tal cual a
 * `markGuestVerificationOtpJobCompleted`/`...FailedRetryable`, que solo
 * escriben si ese token sigue siendo el vigente (revisión 3, punto 1).
 *
 * Elegibilidad exacta (revisión 3, punto 2) — un job es reclamable si:
 * - `pending`: siempre.
 * - `failed_retryable`: solo si `nextAttemptAt <= now` (nunca antes).
 * - `processing`: solo si `leaseExpiresAt < now` (lease vencido, abandonado).
 * - `completed`: nunca.
 *
 * Dos llamadas concurrentes a procesar el mismo job (p. ej. el best-effort
 * inmediato tras crear la solicitud y un reintento idempotente casi
 * simultáneo, o dos pasadas del barrido) nunca pueden ganar el reclamo las
 * dos: Postgres serializa el `UPDATE` sobre la misma fila y la segunda
 * evalúa su `WHERE` ya contra el `claimToken`/`leaseExpiresAt` que la
 * primera acaba de escribir — no actualiza ninguna fila. Evita el doble
 * envío concurrente sin bloqueo explícito adicional (`SELECT ... FOR
 * UPDATE`/`SKIP LOCKED`) y sin mantener una transacción abierta.
 */
export async function claimGuestVerificationOtpJob(bookingRequestId: string, now: Date): Promise<ClaimedGuestVerificationOtpJob | null> {
  const claimToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MINUTES * 60_000)
  const [job] = await bookingDb
    .update(bookingOutboxJobs)
    .set({ status: 'processing', claimToken, claimedAt: now, leaseExpiresAt, updatedAt: now })
    .where(
      and(
        eq(bookingOutboxJobs.bookingRequestId, bookingRequestId),
        eq(bookingOutboxJobs.jobType, GUEST_VERIFICATION_OTP_JOB_TYPE),
        or(
          eq(bookingOutboxJobs.status, 'pending'),
          and(eq(bookingOutboxJobs.status, 'failed_retryable'), lte(bookingOutboxJobs.nextAttemptAt, now)),
          and(eq(bookingOutboxJobs.status, 'processing'), lt(bookingOutboxJobs.leaseExpiresAt, now)),
        ),
      ),
    )
    .returning()
  return job ? { ...job, claimToken } : null
}

export type MarkOutboxJobOutcome = 'updated' | 'lease_lost'

/**
 * Solo escribe si la fila SIGUE `processing` con ESTE `claimToken` exacto —
 * si otro worker ya recuperó el lease (venció y fue reclamado de nuevo)
 * antes de que esta llamada llegue, `claimToken` ya no coincide y la
 * condición no gana ninguna fila: `'lease_lost'`, nunca sobrescribe el
 * resultado del nuevo propietario. El llamante (`otpOutbox.ts`) nunca trata
 * `'lease_lost'` como error — el correo, si se llegó a enviar, ya salió; lo
 * único que se pierde es EL BOOKKEEPING de este worker concreto, nunca la
 * corrección del job (el nuevo propietario decide su destino).
 */
export async function markGuestVerificationOtpJobCompleted(jobId: string, claimToken: string, now: Date): Promise<MarkOutboxJobOutcome> {
  const updated = await bookingDb
    .update(bookingOutboxJobs)
    .set({
      status: 'completed',
      completedAt: now,
      updatedAt: now,
      lastErrorCode: null,
      nextAttemptAt: null,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(bookingOutboxJobs.id, jobId), eq(bookingOutboxJobs.status, 'processing'), eq(bookingOutboxJobs.claimToken, claimToken)))
    .returning({ id: bookingOutboxJobs.id })
  return updated.length > 0 ? 'updated' : 'lease_lost'
}

/** Misma condición de propiedad del lease que `markGuestVerificationOtpJobCompleted` — ver ese comentario. */
export async function markGuestVerificationOtpJobFailedRetryable(
  jobId: string,
  claimToken: string,
  currentAttempts: number,
  errorCode: BookingOutboxJobErrorCode,
  now: Date,
): Promise<MarkOutboxJobOutcome> {
  const updated = await bookingDb
    .update(bookingOutboxJobs)
    .set({
      status: 'failed_retryable',
      attempts: currentAttempts + 1,
      lastErrorCode: errorCode,
      nextAttemptAt: new Date(now.getTime() + OUTBOX_RETRY_BACKOFF_MINUTES * 60_000),
      updatedAt: now,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(bookingOutboxJobs.id, jobId), eq(bookingOutboxJobs.status, 'processing'), eq(bookingOutboxJobs.claimToken, claimToken)))
    .returning({ id: bookingOutboxJobs.id })
  return updated.length > 0 ? 'updated' : 'lease_lost'
}

export type LinkOtpChallengeOutcome = 'linked' | 'not_pending'

/**
 * Vincula el reto vigente a la solicitud — revisión 3, punto 5: transición
 * CAS atómica única que decide a la vez "¿sigue siendo un objetivo válido
 * para enviar un código?" (`status = 'pending_verification'` exacto,
 * `verificationExpiresAt > now`) y "vincula el reto". Antes esta función
 * solo comprobaba el estado (y aceptaba también `verification_processing`,
 * un resto de una permisividad que el flujo real nunca alcanza: no existe
 * ningún reto que verificar hasta que ESTA MISMA llamada lo vincula, así
 * que la solicitud no puede haber avanzado a `verification_processing`
 * antes de la primera vinculación exitosa) sin comprobar el plazo — dejaba
 * una ventana real entre "el barrido/otpOutbox comprueba el plazo" y "el
 * reto queda vinculado" en la que la solicitud podía caducar en medio: un
 * código que nace inutilizable. Al mover la comprobación del plazo AL
 * PROPIO `WHERE` de este `UPDATE`, la decisión y la escritura son la misma
 * operación atómica de Postgres — ninguna carrera posible entre ambas.
 *
 * Revisión 3 (siguiente ronda) — el reloj autoritativo es el DE POSTGRES
 * (`sql\`now()\``, evaluado por el propio motor en el instante en que
 * ejecuta este `UPDATE`), nunca un `Date` capturado antes en Node: entre el
 * momento en que `processGuestVerificationOtpJob` captura su `now` (inicio
 * del barrido/reintento) y el instante real en que esta sentencia llega a
 * Postgres pueden pasar segundos (creación/rotación del reto en Redis,
 * espera de conexión, etc.) — comparar contra esa hora obsoleta podría
 * seguir vinculando una solicitud que ya venció. Por eso esta función ya no
 * acepta `now` como parámetro: no hay ningún valor "autoritativo" que un
 * llamante pueda inyectar aquí. Cualquier comprobación previa en Node
 * (`otpOutbox.ts`) es solo una optimización de salida rápida, nunca la
 * garantía — la garantía es exclusivamente esta sentencia.
 */
export async function linkOtpChallengeIfPending(bookingRequestId: string, challengeId: string): Promise<LinkOtpChallengeOutcome> {
  const updated = await bookingDb
    .update(bookingRequestRecords)
    .set({ otpChallengeId: challengeId })
    .where(
      and(
        eq(bookingRequestRecords.id, bookingRequestId),
        eq(bookingRequestRecords.status, 'pending_verification'),
        gt(bookingRequestRecords.verificationExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: bookingRequestRecords.id })

  return updated.length > 0 ? 'linked' : 'not_pending'
}

export interface EligibleGuestVerificationOtpJobCandidate {
  bookingRequestId: string
  /** Por qué rama de elegibilidad entró este candidato — únicamente para clasificar `BookingOutboxSweepReport.abandonedRecovered` en `reconciliation.ts`; el reclamo real (`claimGuestVerificationOtpJob`) vuelve a decidir la elegibilidad de forma atómica e independiente, así que una foto obsoleta aquí nunca compromete la corrección, como mucho una etiqueta de informe imprecisa en una carrera rarísima. */
  reason: 'pending' | 'retry_due' | 'abandoned_processing'
}

/**
 * Disparador durable del outbox (revisión 3, punto 4) — lista, sin
 * bloquear ninguna fila (`SELECT` simple, sin `FOR UPDATE`), hasta `limit`
 * candidatos elegibles de MÁS ANTIGUOS a más recientes. No hace falta
 * `SELECT ... FOR UPDATE SKIP LOCKED` aquí: el reclamo real y atómico ya
 * ocurre en `claimGuestVerificationOtpJob` (un `UPDATE ... WHERE ...`
 * mono-fila, serializado por Postgres por su cuenta) cuando
 * `reconciliation.ts::sweepOutboxJobs` procesa cada candidato — listar sin
 * bloqueo y reclamar fila a fila por separado evita mantener abierta
 * cualquier transacción mientras se llama a Redis/SMTP, y dos pasadas de
 * barrido concurrentes que listen los mismos candidatos simplemente
 * competirán por el mismo reclamo atómico más abajo, exactamente igual que
 * dos reclamos dirigidos concurrentes.
 */
export async function listEligibleGuestVerificationOtpJobs(
  now: Date,
  limit: number,
): Promise<EligibleGuestVerificationOtpJobCandidate[]> {
  const rows = await bookingDb
    .select({ bookingRequestId: bookingOutboxJobs.bookingRequestId, status: bookingOutboxJobs.status })
    .from(bookingOutboxJobs)
    .where(
      and(
        eq(bookingOutboxJobs.jobType, GUEST_VERIFICATION_OTP_JOB_TYPE),
        or(
          eq(bookingOutboxJobs.status, 'pending'),
          and(eq(bookingOutboxJobs.status, 'failed_retryable'), lte(bookingOutboxJobs.nextAttemptAt, now)),
          and(eq(bookingOutboxJobs.status, 'processing'), lt(bookingOutboxJobs.leaseExpiresAt, now)),
        ),
      ),
    )
    .orderBy(bookingOutboxJobs.createdAt)
    .limit(limit)

  return rows.map((row) => ({
    bookingRequestId: row.bookingRequestId,
    reason: row.status === 'pending' ? 'pending' : row.status === 'failed_retryable' ? 'retry_due' : 'abandoned_processing',
  }))
}
