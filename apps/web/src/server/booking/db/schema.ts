import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import {
  AUDIT_CHANNELS,
  AUDIT_REASON_CODES,
  BOOKING_OUTBOX_JOB_ERROR_CODES,
  BOOKING_OUTBOX_JOB_STATUSES,
  BOOKING_OUTBOX_JOB_TYPES,
  BOOKING_REASON_CODES,
  BOOKING_REQUEST_RESOLUTIONS,
  BOOKING_REQUEST_STATUSES,
  BOOKING_REVIEW_CONFLICT_TYPES,
  BOOKING_REVIEW_STATUSES,
  ESTADOS_MEETING_NATIVOS,
  ESTADOS_RESERVA,
  MEETING_RESOLUTION_REASONS,
  PENDING_GUEST_IDENTITY_STATUSES,
} from '@gapssa/contracts'

/**
 * Esquema de `gapssa_booking` (Postgres, base separada de `gapssa_cms` y
 * `gapssa_auth` — ver infra/postgres/README.md). Espejo tipado de
 * `packages/contracts/src/booking.ts`/`estado-reserva.ts`/`audit.ts`,
 * mismo principio que `gapssa_auth`: cualquier cambio de forma se hace en
 * ambos sitios a la vez.
 *
 * Deliberadamente SIN `import 'server-only'` — mismo motivo que
 * `server/auth/db/schema.ts`: `drizzle-kit generate`/`check` cargan este
 * módulo con `require()` fuera del bundler de Next.js.
 *
 * Fase 4A — dos familias de tablas:
 *
 * 1. **Dominio del portal** (`booking_request_records`,
 *    `pending_guest_identities`, `booking_audit_log`): la fuente de verdad
 *    real del flujo de reserva mientras no existe Meeting, y el registro
 *    de auditoría del BFF. Nunca se sustituyen por una integración real.
 *
 * 2. **Adaptador EspoCRM SIMULADO** (`sim_espo_contacts`,
 *    `sim_espo_meetings`): reproducen, dentro de `gapssa_booking`, lo que
 *    en producción vivirá en la MariaDB real de EspoCRM (`Contact`,
 *    `Meeting`). Existen únicamente para que `EspoBookingAdapter`
 *    (server/booking/espoAdapter.ts) tenga un backend real, recuperable y
 *    consultable entre peticiones/reinicios sin tocar la instancia real de
 *    EspoCRM. Cuando se apruebe la integración real (Fase 4+, fuera de
 *    alcance de esta fase), estas dos tablas se abandonan sin migrar datos
 *    — nunca fueron la fuente de verdad de un Contact/Meeting real, solo
 *    la simulación. `EspoBookingAdapter` es la única interfaz que el resto
 *    del código conoce; su implementación simulada es sustituible sin
 *    tocar ningún llamante (mismo patrón que `EspoLinkAdapter` de Fase 3).
 */

export const bookingRequestStatusEnum = pgEnum('booking_request_status', BOOKING_REQUEST_STATUSES)
export const bookingRequestResolutionEnum = pgEnum(
  'booking_request_resolution',
  BOOKING_REQUEST_RESOLUTIONS,
)
export const bookingReasonCodeEnum = pgEnum('booking_reason_code', BOOKING_REASON_CODES)
export const pendingGuestIdentityStatusEnum = pgEnum(
  'pending_guest_identity_status',
  PENDING_GUEST_IDENTITY_STATUSES,
)
export const bookingAuditChannelEnum = pgEnum('booking_audit_channel', AUDIT_CHANNELS)
export const bookingAuditReasonCodeEnum = pgEnum('booking_audit_reason_code', AUDIT_REASON_CODES)
export const bookingAuditValueRepresentationEnum = pgEnum('booking_audit_value_representation', [
  'raw',
  'redacted',
  'event',
])
export const bookingAuditActorTypeEnum = pgEnum('booking_audit_actor_type', ['user', 'guest', 'system'])
export const estadoReservaEnum = pgEnum('sim_espo_estado_reserva', ESTADOS_RESERVA)
export const estadoMeetingNativoEnum = pgEnum('sim_espo_estado_meeting_nativo', ESTADOS_MEETING_NATIVOS)
// "Fase 4B — flujo de decisión final": espejo simulado de
// Meeting.cMotivoResolucionReserva (campo NUEVO, no creado en la instancia
// real de EspoCRM — packages/contracts/src/booking.ts,
// MEETING_RESOLUTION_REASONS). Mantiene al adaptador simulado con la MISMA
// forma de contrato que el adaptador HTTP real tendrá una vez autorizado.
export const meetingResolutionReasonEnum = pgEnum('sim_espo_meeting_resolution_reason', MEETING_RESOLUTION_REASONS)
export const bookingOutboxJobTypeEnum = pgEnum('booking_outbox_job_type', BOOKING_OUTBOX_JOB_TYPES)
export const bookingOutboxJobStatusEnum = pgEnum('booking_outbox_job_status', BOOKING_OUTBOX_JOB_STATUSES)
export const bookingOutboxJobErrorCodeEnum = pgEnum('booking_outbox_job_error_code', BOOKING_OUTBOX_JOB_ERROR_CODES)
export const bookingReviewConflictTypeEnum = pgEnum('booking_review_conflict_type', BOOKING_REVIEW_CONFLICT_TYPES)
export const bookingReviewStatusEnum = pgEnum('booking_review_status', BOOKING_REVIEW_STATUSES)

// ---------------------------------------------------------------------------
// booking_request_records — packages/contracts/src/booking.ts, BookingRequestRecord.
// Fuente de verdad del ESTADO de la solicitud. Nunca contiene datos
// personales del invitado (ver pending_guest_identities).
// ---------------------------------------------------------------------------

export const bookingRequestRecords = pgTable(
  'booking_request_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Referencia opaca a gapssa_auth.client_accounts.id — base de datos
    // física distinta, nunca un FK real. Null en el flujo de invitado.
    clientAccountId: uuid('client_account_id'),
    // Referencia opaca al Meeting (id de sim_espo_meetings en esta fase,
    // futuro id de EspoCRM real) — nunca un FK real, para que la forma de
    // esta tabla no dependa del adaptador concreto (§ comentario de
    // cabecera). Null hasta que se completa la verificación.
    meetingId: text('meeting_id'),
    treatmentId: text('treatment_id').notNull(),
    professionalId: text('professional_id').notNull(),
    zoneId: text('zone_id').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    status: bookingRequestStatusEnum('status').notNull().default('pending_verification'),
    verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }).notNull(),
    approvalExpiresAt: timestamp('approval_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: bookingRequestResolutionEnum('resolution'),
    reasonCode: bookingReasonCodeEnum('reason_code'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    // Hash canónico del payload de creación (packages/contracts/src/idempotency.ts,
    // computePayloadHash) — permite distinguir un reintento legítimo
    // (misma clave + mismo payload) de un conflicto (misma clave + payload
    // distinto) sin guardar el payload original completo. El payload nunca
    // contiene PII en claro: los campos de identidad/contacto entran como
    // una huella HMAC versionada (server/booking/identityFingerprint.ts),
    // nunca el correo/teléfono/nombre normalizados directamente.
    payloadHash: text('payload_hash').notNull(),
    // Con qué versión de BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS se
    // calculó la huella de identidad incluida en `payloadHash` — permite
    // recalcularla con la MISMA versión (nunca la activa actual) al
    // comprobar un reintento, para que rotar el secreto activo no rompa la
    // detección de replay de una solicitud todavía viva.
    identityFingerprintKeyVersion: text('identity_fingerprint_key_version').notNull(),
    // Con qué versión de BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS se firmó
    // el token de acceso de invitado devuelto al crear esta solicitud —
    // escrita una vez al crear, nunca recalculada. NULL en el flujo
    // autenticado (clientAccountId no nulo): esas solicitudes nunca emiten
    // un token de acceso, la sesión ya prueba identidad. Verificar un
    // token presentado usa SIEMPRE esta versión guardada (nunca "probar
    // todas las presentes en el mapa"): una versión desconocida (retirada
    // prematuramente) es un error explícito, nunca una aceptación
    // silenciosa. Permite retirar una versión vieja del mapa solo cuando
    // countLiveBookingRequestsReferencingAccessTokenVersions (para esa
    // versión) llega a 0 — mismo criterio objetivo que
    // identityFingerprintKeyVersion ya usa para el HMAC de huella.
    accessTokenKeyVersion: text('access_token_key_version'),
    // Reto de verificación exacto (Redis OtpChallenge.id) atado a esta
    // solicitud — solo invitado; null en el flujo autenticado (la sesión
    // ya prueba identidad, sin espera de OTP). Mismo patrón que
    // password_reset_requests.otp_challenge_id (gapssa_auth): nunca "la
        // última solicitud pendiente", siempre el reto exacto que verifyOtp
    // validó.
    otpChallengeId: text('otp_challenge_id'),
    // "Fase 4B — flujo de decisión final", punto 3: clave de idempotencia
    // de la DECISIÓN (aprobar/rechazar), distinta de `idempotencyKey`
    // (que cubre la CREACIÓN de la solicitud, ciclo de vida anterior).
    // Nula hasta la primera llamada a `/internal/decisions`; una vez
    // escrita (vía `ensureDecisionOperationKey`, upsert atómico con
    // `COALESCE`, ANTES de llamar al adaptador), es la clave estable que
    // se reenvía a `adapter.decideMeeting`/EspoCRM `PutDecide` en
    // cualquier reintento posterior — nunca se genera una UUID nueva por
    // reintento.
    decisionOperationKey: text('decision_operation_key'),
  },
  (table) => [
    uniqueIndex('booking_request_records_idempotency_key_key').on(table.idempotencyKey),
    uniqueIndex('booking_request_records_decision_operation_key_key')
      .on(table.decisionOperationKey)
      .where(sql`${table.decisionOperationKey} IS NOT NULL`),
    index('booking_request_records_status_idx').on(table.status),
    index('booking_request_records_client_account_id_idx').on(table.clientAccountId),
    index('booking_request_records_meeting_id_idx').on(table.meetingId),
    // Detección de solapes por profesional/zona (disponibilidad, límite de
    // capacidad) — el filtrado fino por intervalo ocurre en la consulta,
    // este índice solo acota el rango de filas candidatas.
    index('booking_request_records_professional_time_idx').on(
      table.professionalId,
      table.startAt,
      table.endAt,
    ),
    index('booking_request_records_zone_time_idx').on(table.zoneId, table.startAt, table.endAt),
    // Barrido de conciliación (docs/contratos-portal-v1.md §8.3): ambas
    // columnas se consultan con `status = ... AND <deadline> < now()`.
    index('booking_request_records_verification_expires_at_idx').on(table.verificationExpiresAt),
    index('booking_request_records_approval_expires_at_idx').on(table.approvalExpiresAt),
  ],
)

// ---------------------------------------------------------------------------
// pending_guest_identities — packages/contracts/src/booking.ts, PendingGuestIdentity.
// Datos de contacto del invitado, SIEMPRE cifrados en la aplicación
// (server/crypto/fieldCrypto.ts) antes de llegar aquí — esta tabla nunca
// ve el valor en claro, solo columnas ciphertext/nonce/keyVersion.
// ---------------------------------------------------------------------------

export const pendingGuestIdentities = pgTable(
  'pending_guest_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingRequestId: uuid('booking_request_id')
      .notNull()
      .references(() => bookingRequestRecords.id, { onDelete: 'cascade' }),
    firstNameCiphertext: text('first_name_ciphertext').notNull(),
    firstNameNonce: text('first_name_nonce').notNull(),
    firstNameKeyVersion: text('first_name_key_version').notNull(),
    lastNameCiphertext: text('last_name_ciphertext').notNull(),
    lastNameNonce: text('last_name_nonce').notNull(),
    lastNameKeyVersion: text('last_name_key_version').notNull(),
    emailCiphertext: text('email_ciphertext').notNull(),
    emailNonce: text('email_nonce').notNull(),
    emailKeyVersion: text('email_key_version').notNull(),
    phoneCiphertext: text('phone_ciphertext').notNull(),
    phoneNonce: text('phone_nonce').notNull(),
    phoneKeyVersion: text('phone_key_version').notNull(),
    // HMAC-SHA-256 del correo normalizado — único mecanismo previsto para
    // contar solicitudes pendientes por correo (MAX_PENDING_REQUESTS_PER_CLIENT).
    // Nunca invertible, nunca sustituye el cifrado de `email*`.
    emailLookupHmac: text('email_lookup_hmac').notNull(),
    // Con qué versión de BOOKING_EMAIL_LOOKUP_HMAC_SECRETS se calculó
    // emailLookupHmac — mismo patrón que el resto de columnas
    // `*KeyVersion` de esta fila. Durante convivencia tras rotar,
    // guestFlow.ts busca bajo TODAS las versiones presentes en el mapa
    // (nunca solo la activa); emailLookupHmacRotation.ts reindexa esta
    // columna (junto con emailLookupHmac) desde el correo DESCIFRADO —
    // nunca desde el propio HMAC, que es de un solo sentido.
    emailLookupHmacKeyVersion: text('email_lookup_hmac_key_version').notNull(),
    status: pendingGuestIdentityStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('pending_guest_identities_booking_request_id_key').on(table.bookingRequestId),
    // Job de limpieza (§3.3 contratos-portal-v1.md): escanea por status sin
    // recorrer toda la tabla.
    index('pending_guest_identities_status_idx').on(table.status),
    index('pending_guest_identities_email_lookup_hmac_idx').on(table.emailLookupHmac),
  ],
)

// ---------------------------------------------------------------------------
// pending_authenticated_contact_details — revisión 2 de Fase 4B, punto 3.
// Contraparte de pending_guest_identities para el flujo de CLIENTE
// AUTENTICADO (packages/contracts/src/booking.ts,
// PendingAuthenticatedContactDetails). Nunca `email`/`gapssaAccountId` —
// se derivan siempre de `clientAccountId` en el momento de reanudar.
// Nunca en `gapssa_auth`.
// ---------------------------------------------------------------------------

export const pendingAuthenticatedContactDetails = pgTable(
  'pending_authenticated_contact_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingRequestId: uuid('booking_request_id')
      .notNull()
      .references(() => bookingRequestRecords.id, { onDelete: 'cascade' }),
    firstNameCiphertext: text('first_name_ciphertext').notNull(),
    firstNameNonce: text('first_name_nonce').notNull(),
    firstNameKeyVersion: text('first_name_key_version').notNull(),
    lastNameCiphertext: text('last_name_ciphertext').notNull(),
    lastNameNonce: text('last_name_nonce').notNull(),
    lastNameKeyVersion: text('last_name_key_version').notNull(),
    phoneCiphertext: text('phone_ciphertext').notNull(),
    phoneNonce: text('phone_nonce').notNull(),
    phoneKeyVersion: text('phone_key_version').notNull(),
    status: pendingGuestIdentityStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('pending_authenticated_contact_details_booking_request_id_key').on(table.bookingRequestId),
    index('pending_authenticated_contact_details_status_idx').on(table.status),
  ],
)

// ---------------------------------------------------------------------------
// booking_review_records — revisión 2 de Fase 4B, punto 3/6; workflow
// durable con lease de revisión 3, punto 1/2
// (packages/contracts/src/booking.ts, BookingReviewRecord). Registro
// duradero y mínimo de resolución manual para `contact_review_pending` —
// nunca contiene PII, solo IDs opacos de EspoCRM. Un `bookingRequestId`
// puede tener, a lo largo del tiempo, más de una fila (una revisión
// rechazada/reemplazada + una nueva revisión tras un reintento) — nunca se
// reescribe una fila ya cerrada; el estado ACTIVO se consulta filtrando por
// `status IN ('pending', 'processing')`.
//
// `claimToken`/`claimedAt`/`leaseExpiresAt`: mismo patrón exacto que
// `booking_outbox_jobs` (revisión 3 de Fase 4A, punto 1) — identifican sin
// ambigüedad al propietario vigente de una reanudación en curso
// (`review.ts::claimBookingReview`). Solo el poseedor del `claimToken`
// vigente puede cerrar la revisión (`resolved`) o devolverla a `pending`
// tras un fallo transitorio; un claim cuyo lease venció se trata como
// abandonado y vuelve a ser reclamable. Nunca en `BookingReviewRecord`
// (contrato público) — mismo motivo que `booking_outbox_jobs`: es un
// detalle de bookkeeping interno del BFF, no algo que un operador consulte.
//
// Índice único parcial (`booking_review_records_active_booking_request_id_key`):
// a lo sumo UNA revisión activa (`pending`/`processing`) por
// `bookingRequestId` en un momento dado — defensa en profundidad; la
// apertura atómica real (`repository.ts::openBookingReviewAtomic`) ya
// serializa las aperturas concurrentes bloqueando la fila de
// `BookingRequestRecord` (`SELECT ... FOR UPDATE`) antes de comprobar/crear,
// así que este índice nunca debería, en la práctica, rechazar un INSERT del
// propio flujo — protege contra cualquier vía futura que escriba en esta
// tabla sin pasar por esa única puerta.
// ---------------------------------------------------------------------------

export const bookingReviewRecords = pgTable(
  'booking_review_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingRequestId: uuid('booking_request_id')
      .notNull()
      .references(() => bookingRequestRecords.id, { onDelete: 'cascade' }),
    conflictType: bookingReviewConflictTypeEnum('conflict_type').notNull(),
    // Arrays de IDs opacos (UUID de EspoCRM) — nunca PII. jsonb en vez de
    // una tabla de asociación aparte: son metadatos de trazabilidad interna
    // de tamaño acotado (nunca más que unos pocos candidatos), no una
    // relación que se consulte por su cuenta.
    candidateContactIds: jsonb('candidate_contact_ids').$type<string[] | null>(),
    candidateMeetingIds: jsonb('candidate_meeting_ids').$type<string[] | null>(),
    status: bookingReviewStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    resolutionContactId: text('resolution_contact_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimToken: uuid('claim_token'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  },
  (table) => [
    index('booking_review_records_booking_request_id_idx').on(table.bookingRequestId),
    // Barrido de conciliación / listado de pendientes: ambas columnas se
    // consultan con `status = 'pending' AND expiresAt < now()`.
    index('booking_review_records_status_expires_at_idx').on(table.status, table.expiresAt),
    // Barrido de conciliación (revisión 3, punto 9): reclamos `processing`
    // con lease vencido, abandonados por un worker caído a mitad de una
    // reanudación.
    index('booking_review_records_status_lease_expires_at_idx').on(table.status, table.leaseExpiresAt),
    uniqueIndex('booking_review_records_active_booking_request_id_key')
      .on(table.bookingRequestId)
      .where(sql`${table.status} IN ('pending', 'processing')`),
  ],
)

// ---------------------------------------------------------------------------
// booking_outbox_jobs — revisión 2 de Fase 4A, punto 3; leases de revisión
// 3, punto 1. Único tipo de trabajo hoy: `send_guest_verification_otp`
// (envío recuperable del OTP de verificación de invitado). Nunca guarda el
// código OTP — solo referencia `bookingRequestId`; el reto (Redis) se
// crea/rota durante el procesamiento del job. Mismo patrón que
// `outbox_jobs` de gapssa_auth (`server/auth/db/schema.ts`), con su propio
// catálogo de estados/errores (`packages/contracts/src/bookingOutbox.ts`) —
// bases de datos físicas distintas, sin acoplar un dominio al otro.
//
// `claimToken`/`claimedAt`/`leaseExpiresAt`: identifican sin ambigüedad al
// propietario vigente de un reclamo. `completed`/`failed_retryable` solo
// pueden escribirse mediante `id` + `status = 'processing'` +
// `claim_token` vigente (`repository.ts::markGuestVerificationOtpJob*`) —
// un worker cuyo lease venció y fue recuperado por otro (`leaseExpiresAt`
// superado, otro `UPDATE` ganó el reclamo con un `claimToken` nuevo) nunca
// gana esa condición, así que su escritura final (aunque SMTP sí haya
// aceptado el mensaje) no sobrescribe el resultado del nuevo propietario —
// SMTP no ofrece "exactly-once": lo que este lease evita es una CORRUPCIÓN
// del bookkeeping (dos workers pisándose el estado), nunca un posible
// correo duplicado real, que sigue siendo posible y está documentado en
// `otpOutbox.ts`.
// ---------------------------------------------------------------------------

export const bookingOutboxJobs = pgTable(
  'booking_outbox_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobType: bookingOutboxJobTypeEnum('job_type').notNull(),
    bookingRequestId: uuid('booking_request_id')
      .notNull()
      .references(() => bookingRequestRecords.id, { onDelete: 'cascade' }),
    status: bookingOutboxJobStatusEnum('status').notNull().default('pending'),
    // Cuenta ÚNICAMENTE intentos de ENTREGA FALLIDOS confirmados — nunca
    // reclamos (un reclamo por sí solo no es un intento fallido) ni éxitos.
    // Se incrementa exclusivamente en
    // `markGuestVerificationOtpJobFailedRetryable`; ninguna otra escritura
    // toca esta columna — semántica única, documentada aquí a propósito
    // (revisión 3, punto 2) para que no se mezcle con "número de reclamos".
    attempts: integer('attempts').notNull().default(0),
    // Token aleatorio (crypto.randomUUID) generado en cada reclamo exitoso
    // — identifica sin ambigüedad al worker que posee la fila mientras
    // está `processing`. Null salvo durante `processing`.
    claimToken: uuid('claim_token'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Ventana de "visibilidad" del reclamo — un job `processing` cuyo lease
    // venció se trata como abandonado y vuelve a ser reclamable por
    // cualquier worker (dirigido o vía el barrido, `reconciliation.ts`).
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    // Cuándo vuelve a ser elegible un job `failed_retryable` — el reclamo
    // (dirigido y de barrido) exige `nextAttemptAt <= now()`, nunca antes.
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastErrorCode: bookingOutboxJobErrorCodeEnum('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // Un único job de un tipo dado por solicitud — se crea exactamente una
    // vez, en la misma transacción que el BookingRequestRecord.
    uniqueIndex('booking_outbox_jobs_booking_request_id_job_type_key').on(table.bookingRequestId, table.jobType),
    // Cubren las dos ramas de elegibilidad temporal del reclamo
    // (`failed_retryable` vencido, `processing` con lease vencido) — el
    // barrido de conciliación filtra exactamente por estas combinaciones
    // (`repository.ts::listEligibleGuestVerificationOtpJobs`). El
    // predicado `status = 'pending'` (sin componente temporal) también usa
    // la columna líder de ambos índices, así que no hace falta un tercer
    // índice de solo `status`.
    index('booking_outbox_jobs_status_next_attempt_at_idx').on(table.status, table.nextAttemptAt),
    index('booking_outbox_jobs_status_lease_expires_at_idx').on(table.status, table.leaseExpiresAt),
  ],
)

// ---------------------------------------------------------------------------
// booking_audit_log — almacén de AuditEntry validados
// (packages/contracts/src/audit.ts), mismo patrón exacto que
// gapssa_auth.auth_audit_log (server/auth/db/schema.ts) — tabla separada
// porque vive en una base de datos física distinta, nunca porque la
// política de auditoría difiera. Toda fila pasa por
// createRawAuditEntry/createRedactedAuditEntry/createEventAuditEntry o
// validateAuditEntry antes de insertarse (server/booking/audit.ts).
// ---------------------------------------------------------------------------

export const bookingAuditLog = pgTable(
  'booking_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    actorType: bookingAuditActorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id'),
    actorSystemName: text('actor_system_name'),
    channel: bookingAuditChannelEnum('channel').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reasonCode: bookingAuditReasonCodeEnum('reason_code'),
    valueRepresentation: bookingAuditValueRepresentationEnum('value_representation').notNull(),
    field: text('field'),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    redactedAlgorithm: text('redacted_algorithm'),
    redactedDigest: text('redacted_digest'),
    redactedChangeKind: text('redacted_change_kind'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('booking_audit_log_entity_entity_id_idx').on(table.entity, table.entityId),
    index('booking_audit_log_occurred_at_idx').on(table.occurredAt),
  ],
)

// ---------------------------------------------------------------------------
// sim_espo_contacts / sim_espo_meetings — SOLO simulación (ver cabecera).
// Nunca confundir con el `Contact`/`Meeting` reales de EspoCRM: esta
// simulación sí puede guardar nombre/correo/teléfono en claro porque
// representa, dentro de gapssa_booking, el rol que en producción cumple la
// MariaDB de EspoCRM (que también los guarda en claro hoy) — la regla de
// "nunca PII en claro" de esta fase se aplica a pending_guest_identities
// (Postgres del BFF antes de que exista Meeting), no a esta simulación.
// ---------------------------------------------------------------------------

export const simEspoContacts = pgTable(
  'sim_espo_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Vínculo opaco con gapssa_auth.client_accounts.id cuando el Contact se
    // originó desde una reserva de cliente autenticado ya vinculado — nunca
    // un FK real (otra base de datos física). Mismo campo previsto que
    // `cGapssaAccountId` en docs/fase3-autenticacion.md §6.1.
    gapssaAccountId: uuid('gapssa_account_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sim_espo_contacts_email_idx').on(table.email),
    index('sim_espo_contacts_phone_idx').on(table.phone),
    index('sim_espo_contacts_gapssa_account_id_idx').on(table.gapssaAccountId),
  ],
)

export const simEspoMeetings = pgTable(
  'sim_espo_meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // = cBookingRequestId (packages/contracts/src/booking.ts,
    // MEETING_BOOKING_REQUEST_FIELD) — único: un mismo bookingRequestId
    // representa, por construcción, UNA única reserva (mismo tratamiento/
    // profesional/zona/horario/Contact) — dos intentos de creación
    // concurrentes para el MISMO bookingRequestId (p. ej. dos pestañas
    // verificando el mismo código de invitado casi a la vez,
    // `tests/integration/booking.concurrency.int.test.ts`) son el MISMO
    // reserva, no una ambigüedad real: Postgres, a diferencia de la API
    // REST de EspoCRM (que no ofrece un `PUT`/`INSERT` condicional
    // equivalente), SÍ puede garantizar esta unicidad de forma atómica, y
    // hacerlo aquí es justo el estado objetivo recomendado para la
    // instancia real (`docs/fase4b-integracion-http.md` §10, punto 2,
    // pendiente de autorización). `MeetingLookupResult.duplicate`
    // (`espoAdapter.ts`) sigue existiendo en el contrato — y sigue siendo
    // real y alcanzable en `HttpEspoBookingAdapter`, que no tiene esta
    // protección hoy — pero en el adaptador simulado solo es alcanzable si
    // dos filas llegan a existir por una vía AJENA a `createMeeting` (un
    // dato ya inconsistente antes de esta llamada), nunca por una carrera
    // dentro de la propia creación.
    bookingRequestId: uuid('booking_request_id').notNull(),
    treatmentId: text('treatment_id').notNull(),
    professionalId: text('professional_id').notNull(),
    zoneId: text('zone_id').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    cEstadoReserva: estadoReservaEnum('c_estado_reserva').notNull().default('PendingCenterApproval'),
    status: estadoMeetingNativoEnum('status').notNull().default('Planned'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // "Fase 4B — flujo de decisión final", hueco 3: representación durable
    // y cerrada del motivo de la resolución — NUNCA se deriva de
    // `decidedBy` (ver deriveResolutionFromDecidedMeeting,
    // decisionRecovery.ts). `decidedBy` se conserva solo como dato
    // informativo/depuración, no como fuente de verdad del motivo.
    resolutionReason: meetingResolutionReasonEnum('resolution_reason'),
    // Nota operativa de Gapssa al decidir (p. ej. motivo de rechazo) — vive
    // "en EspoCRM" (esta simulación), NUNCA se copia a booking_audit_log
    // (packages/contracts/src/audit.ts, docs/contratos-portal-v1.md §7.4).
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sim_espo_meetings_booking_request_id_key').on(table.bookingRequestId),
    index('sim_espo_meetings_professional_time_idx').on(table.professionalId, table.startAt, table.endAt),
    index('sim_espo_meetings_zone_time_idx').on(table.zoneId, table.startAt, table.endAt),
    index('sim_espo_meetings_c_estado_reserva_idx').on(table.cEstadoReserva),
  ],
)

/**
 * Revisión 2 de Fase 4B, punto 2: relación muchos-a-muchos real entre
 * `sim_espo_meetings` y `sim_espo_contacts`, reflejando `Meeting.contacts`
 * (`linkMultiple`) en EspoCRM real — no un `contactId` singular NOT NULL
 * como antes. Necesario para poder representar y probar, también en el
 * adaptador simulado, los mismos casos que el adaptador HTTP ya podía leer
 * de un Meeting ajeno al portal: cero Contacts, uno, o varios (Fase 4B,
 * punto 2 — validación de Contact al adoptar).
 */
export const simEspoMeetingContacts = pgTable(
  'sim_espo_meeting_contacts',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => simEspoMeetings.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => simEspoContacts.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.meetingId, table.contactId] }),
    index('sim_espo_meeting_contacts_contact_id_idx').on(table.contactId),
  ],
)
