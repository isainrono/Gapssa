import { relations, sql } from 'drizzle-orm'
import {
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  CLIENT_ACCOUNT_STATUSES,
  CREDENTIAL_TYPES,
  ESPO_LINK_STATUSES,
  INDEPENDENCE_STATUSES,
  SESSION_REVOKED_REASONS,
  EMAIL_VERIFICATION_REQUEST_STATUSES,
  PASSWORD_RESET_REQUEST_STATUSES,
  GUARDIAN_LINK_STATUSES,
  INDEPENDENCE_REQUEST_STATUSES,
  OUTBOX_JOB_TYPES,
  OUTBOX_JOB_STATUSES,
} from '@gapssa/contracts'
import { AUDIT_CHANNELS, AUDIT_REASON_CODES } from '@gapssa/contracts'

/**
 * Esquema de `gapssa_auth` (Postgres, base separada de `gapssa_cms` y
 * `gapssa_booking` — ver infra/postgres/README.md). Espejo tipado de los
 * contratos de `packages/contracts/src/auth.ts`; cualquier cambio de forma
 * debe hacerse en ambos sitios a la vez, igual que `cEstadoReserva` con
 * EspoCRM (`estado-reserva.ts`).
 *
 * Deliberadamente SIN `import 'server-only'`, a diferencia de `client.ts`:
 * `drizzle-kit generate`/`drizzle-kit check` cargan este módulo
 * directamente con `require()` de Node, fuera del bundler de Next.js — el
 * mismo motivo por el que `payload.env.ts` tampoco lo lleva (ver el
 * comentario de ese archivo). No contiene secretos ni lógica de conexión,
 * solo definiciones de tabla, así que no necesita esa frontera.
 *
 * `pgEnum` en vez de `text` con `CHECK`: Postgres valida el dominio en el
 * propio tipo de columna (defensa en profundidad además de la validación
 * de aplicación en `packages/contracts`), y `drizzle-kit generate` detecta
 * automáticamente cuando el enum de TypeScript y el de Postgres divergen.
 */

export const clientAccountStatusEnum = pgEnum('client_account_status', CLIENT_ACCOUNT_STATUSES)
export const credentialTypeEnum = pgEnum('credential_type', CREDENTIAL_TYPES)
export const espoLinkStatusEnum = pgEnum('espo_link_status', ESPO_LINK_STATUSES)
export const independenceStatusEnum = pgEnum('independence_status', INDEPENDENCE_STATUSES)
export const sessionRevokedReasonEnum = pgEnum('session_revoked_reason', SESSION_REVOKED_REASONS)
export const emailVerificationStatusEnum = pgEnum(
  'email_verification_request_status',
  EMAIL_VERIFICATION_REQUEST_STATUSES,
)
export const passwordResetStatusEnum = pgEnum(
  'password_reset_request_status',
  PASSWORD_RESET_REQUEST_STATUSES,
)
export const guardianLinkStatusEnum = pgEnum('guardian_link_status', GUARDIAN_LINK_STATUSES)
export const independenceRequestStatusEnum = pgEnum(
  'independence_request_status',
  INDEPENDENCE_REQUEST_STATUSES,
)
export const auditChannelEnum = pgEnum('audit_channel', AUDIT_CHANNELS)
export const auditReasonCodeEnum = pgEnum('audit_reason_code', AUDIT_REASON_CODES)
export const auditValueRepresentationEnum = pgEnum('audit_value_representation', [
  'raw',
  'redacted',
  'event',
])
export const auditActorTypeEnum = pgEnum('audit_actor_type', ['user', 'guest', 'system'])
export const outboxJobTypeEnum = pgEnum('outbox_job_type', OUTBOX_JOB_TYPES)
export const outboxJobStatusEnum = pgEnum('outbox_job_status', OUTBOX_JOB_STATUSES)

// ---------------------------------------------------------------------------
// client_accounts
// ---------------------------------------------------------------------------

export const clientAccounts = pgTable(
  'client_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Ya normalizado (minúsculas, sin espacios) por normalizeEmail() antes
    // de insertar — el índice único opera sobre el valor tal cual se
    // guarda, sin una expresión lower() adicional.
    email: text('email').notNull(),
    status: clientAccountStatusEnum('status').notNull().default('pending_verification'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    dateOfBirth: date('date_of_birth', { mode: 'string' }).notNull(),
    locale: text('locale').notNull(),
    espoLinkStatus: espoLinkStatusEnum('espo_link_status').notNull().default('unlinked'),
    espoContactId: text('espo_contact_id'),
    independenceStatus: independenceStatusEnum('independence_status')
      .notNull()
      .default('not_applicable'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('client_accounts_email_key').on(table.email),
    index('client_accounts_espo_contact_id_idx').on(table.espoContactId),
  ],
)

export const clientAccountsRelations = relations(clientAccounts, ({ many }) => ({
  credentials: many(credentials),
  sessions: many(sessions),
  emailVerificationRequests: many(emailVerificationRequests),
  passwordResetRequests: many(passwordResetRequests),
  guardianLinksAsGuardian: many(guardianLinks, { relationName: 'guardianAccount' }),
  guardianLinksAsMinor: many(guardianLinks, { relationName: 'minorAccount' }),
  independenceRequests: many(independenceRequests),
}))

// ---------------------------------------------------------------------------
// credentials
// ---------------------------------------------------------------------------

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    type: credentialTypeEnum('type').notNull(),
    // Cadena PHC completa de Argon2id (algoritmo+parámetros+sal+hash) —
    // nunca la contraseña en claro. Ver packages/contracts/src/auth.ts.
    secretHash: text('secret_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('credentials_account_id_type_key').on(table.accountId, table.type)],
)

export const credentialsRelations = relations(credentials, ({ one }) => ({
  account: one(clientAccounts, {
    fields: [credentials.accountId],
    references: [clientAccounts.id],
  }),
}))

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    // SHA-256 hex del token de sesión — el token en claro solo vive en la
    // cookie del navegador, nunca en la base de datos. Ver
    // packages/contracts/src/auth.ts (Session).
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: sessionRevokedReasonEnum('revoked_reason'),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_account_id_idx').on(table.accountId),
  ],
)

export const sessionsRelations = relations(sessions, ({ one }) => ({
  account: one(clientAccounts, { fields: [sessions.accountId], references: [clientAccounts.id] }),
}))

// ---------------------------------------------------------------------------
// email_verification_requests
// ---------------------------------------------------------------------------

export const emailVerificationRequests = pgTable(
  'email_verification_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    status: emailVerificationStatusEnum('status').notNull().default('pending'),
    // Referencia opaca al OtpChallenge.id emitido en Redis — el código y su
    // hash nunca se persisten aquí (packages/contracts/src/otp.ts).
    otpChallengeId: text('otp_challenge_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (table) => [
    index('email_verification_requests_account_id_idx').on(table.accountId),
    index('email_verification_requests_status_idx').on(table.status),
  ],
)

// ---------------------------------------------------------------------------
// password_reset_requests
// ---------------------------------------------------------------------------

export const passwordResetRequests = pgTable(
  'password_reset_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    status: passwordResetStatusEnum('status').notNull().default('pending'),
    otpChallengeId: text('otp_challenge_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    idempotencyKey: uuid('idempotency_key').notNull(),
  },
  (table) => [
    uniqueIndex('password_reset_requests_idempotency_key_key').on(table.idempotencyKey),
    index('password_reset_requests_account_id_idx').on(table.accountId),
  ],
)

// ---------------------------------------------------------------------------
// guardian_links
// ---------------------------------------------------------------------------

export const guardianLinks = pgTable(
  'guardian_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guardianAccountId: uuid('guardian_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    minorAccountId: uuid('minor_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    status: guardianLinkStatusEnum('status').notNull().default('pending_minor_confirmation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => clientAccounts.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => clientAccounts.id),
  },
  (table) => [
    index('guardian_links_minor_account_id_idx').on(table.minorAccountId),
    index('guardian_links_guardian_account_id_idx').on(table.guardianAccountId),
    // Un mismo tutor no puede tener dos vínculos vivos (pendiente o activo)
    // para el mismo menor a la vez — la regla de "máximo dos tutores" en sí
    // (dos guardian_account_id DISTINTOS) se aplica en la capa de
    // repositorio con bloqueo de fila real (mismo patrón que
    // protectAdminRole.ts para "último administrador"), no aquí: un índice
    // no puede contar filas con valores distintos de una columna.
    uniqueIndex('guardian_links_unique_live_pair')
      .on(table.guardianAccountId, table.minorAccountId)
      .where(sql`${table.status} in ('pending_minor_confirmation', 'active')`),
  ],
)

export const guardianLinksRelations = relations(guardianLinks, ({ one }) => ({
  guardianAccount: one(clientAccounts, {
    fields: [guardianLinks.guardianAccountId],
    references: [clientAccounts.id],
    relationName: 'guardianAccount',
  }),
  minorAccount: one(clientAccounts, {
    fields: [guardianLinks.minorAccountId],
    references: [clientAccounts.id],
    relationName: 'minorAccount',
  }),
}))

// ---------------------------------------------------------------------------
// independence_requests
// ---------------------------------------------------------------------------

export const independenceRequests = pgTable(
  'independence_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minorAccountId: uuid('minor_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    status: independenceRequestStatusEnum('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    otpChallengeId: text('otp_challenge_id').notNull(),
    identityConfirmationMethod: text('identity_confirmation_method')
      .notNull()
      .default('email_otp_reconfirmation'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [index('independence_requests_minor_account_id_idx').on(table.minorAccountId)],
)

// ---------------------------------------------------------------------------
// auth_audit_log — almacén de AuditEntry validados (packages/contracts/src/audit.ts).
// Solo eventos estructurados: ninguna nota humana de texto libre vive aquí
// (esa vive en EspoCRM, ver docs/contratos-portal-v1.md §7.4). Cada fila
// debe haber pasado por createRawAuditEntry/createRedactedAuditEntry/
// validateAuditEntry antes de insertarse — el repositorio nunca escribe un
// objeto sin validar (ver server/auth/audit.ts).
// ---------------------------------------------------------------------------

export const authAuditLog = pgTable(
  'auth_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    actorType: auditActorTypeEnum('actor_type').notNull(),
    // Id de usuario/invitado si actorType = 'user'|'guest'; null si 'system'.
    actorId: text('actor_id'),
    // Nombre del sistema si actorType = 'system'; null en otro caso.
    actorSystemName: text('actor_system_name'),
    channel: auditChannelEnum('channel').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reasonCode: auditReasonCodeEnum('reason_code'),
    valueRepresentation: auditValueRepresentationEnum('value_representation').notNull(),
    field: text('field'),
    // Solo para valueRepresentation = 'raw': valores ya validados contra un
    // enum cerrado (RAW_VALUE_VALIDATORS) antes de llegar aquí — jsonb solo
    // por comodidad de tipo, nunca contenido libre (audit.ts lo impide).
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    // Solo para valueRepresentation = 'redacted'.
    redactedAlgorithm: text('redacted_algorithm'),
    redactedDigest: text('redacted_digest'),
    redactedChangeKind: text('redacted_change_kind'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_audit_log_entity_entity_id_idx').on(table.entity, table.entityId),
    index('auth_audit_log_occurred_at_idx').on(table.occurredAt),
  ],
)

// ---------------------------------------------------------------------------
// outbox_jobs — trabajo posterior a una transición de negocio que no puede
// ejecutarse dentro de la misma transacción Postgres (p. ej. la futura
// integración real con EspoCRM, hoy un adaptador simulado —
// server/auth/outbox.ts, server/auth/espoLink.ts, revisión 4 de Fase 3,
// docs/fase3-autenticacion.md §6). El job se encola en la MISMA transacción
// que la transición que lo origina (nunca después, nunca en memoria) y se
// procesa de forma recuperable e idempotente por accountId+jobType.
// ---------------------------------------------------------------------------

export const outboxJobs = pgTable(
  'outbox_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobType: outboxJobTypeEnum('job_type').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    status: outboxJobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    // Motivo cerrado del último fallo (OutboxJobErrorCode) — nunca un
    // mensaje de excepción libre, ver packages/contracts/src/outbox.ts.
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_jobs_status_next_attempt_at_idx').on(table.status, table.nextAttemptAt),
    // Idempotencia por cuenta+tipo: mientras exista un job sin resolver
    // (pending/failed_retryable) para esa cuenta+tipo, no se puede encolar
    // otro — evita que un reintento de la transición de negocio que lo
    // origina duplique el trabajo posterior. Una vez 'completed', un job
    // nuevo para la misma cuenta+tipo sí puede volver a encolarse (no hay
    // caso de negocio que lo necesite todavía en esta fase, pero el índice
    // no lo impide innecesariamente).
    uniqueIndex('outbox_jobs_unique_unresolved_account_job_type')
      .on(table.accountId, table.jobType)
      .where(sql`${table.status} in ('pending', 'failed_retryable')`),
  ],
)

