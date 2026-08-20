import 'server-only'
import { and, eq, ne } from 'drizzle-orm'

import {
  decideAccountAgeCategory,
  normalizeEmail,
  type ClientAccountStatus,
  type IndependenceStatus,
} from '@gapssa/contracts'

import { recordEventAuditEvent, recordRawAuditEvent } from './audit'
import { authDb } from './db/client'
import {
  clientAccounts,
  credentials,
  emailVerificationRequests,
  guardianLinks,
  independenceRequests,
  passwordResetRequests,
} from './db/schema'
import { enqueueEvaluateEspoLinkJob } from './outbox'
import { revokeAllSessionsForAccountInTx } from './session'

/**
 * Acceso a `gapssa_auth` para cuentas de cliente, credenciales y las
 * solicitudes de verificación/recuperación. Capa fina sobre Drizzle: no
 * decide reglas de negocio (eso vive en las rutas API y en
 * `packages/contracts`), solo lee/escribe.
 *
 * Revisión 2 de Fase 3: varias operaciones que antes eran dos sentencias
 * sueltas (INSERT cuenta + INSERT credencial; SELECT "la última pendiente"
 * + UPDATE) pasan a ser transaccionales/atómicas — ver el razonamiento en
 * cada función. Objetivo: ningún fallo parcial (proceso caído entre dos
 * sentencias, dos peticiones concurrentes) debe dejar una cuenta sin
 * credencial, una activación a medias, o una doble concesión.
 */

export type ClientAccountRow = typeof clientAccounts.$inferSelect

export async function findAccountByEmail(email: string): Promise<ClientAccountRow | null> {
  const normalized = normalizeEmail(email)
  const [row] = await authDb.select().from(clientAccounts).where(eq(clientAccounts.email, normalized)).limit(1)
  return row ?? null
}

export async function findAccountById(accountId: string): Promise<ClientAccountRow | null> {
  const [row] = await authDb.select().from(clientAccounts).where(eq(clientAccounts.id, accountId)).limit(1)
  return row ?? null
}

export interface CreateAccountInput {
  email: string
  dateOfBirth: string
  locale: string
}

/**
 * Crea la cuenta y su credencial de contraseña en una única transacción
 * Postgres. Antes eran dos sentencias sueltas (`createAccount` +
 * `createPasswordCredential`): un fallo del proceso entre ambas dejaba una
 * cuenta sin ninguna forma de autenticar, y sin ruta de recuperación
 * (el registro repetido con el mismo correo solo trataba la cuenta como
 * "ya existente" y no reparaba nada). Con una sola transacción, o se crean
 * las dos filas o no se crea ninguna — nunca un estado intermedio visible.
 */
export async function createAccountWithPasswordCredential(
  input: CreateAccountInput,
  secretHash: string,
): Promise<ClientAccountRow> {
  return authDb.transaction(async (tx) => {
    const [account] = await tx
      .insert(clientAccounts)
      .values({
        email: normalizeEmail(input.email),
        dateOfBirth: input.dateOfBirth,
        locale: input.locale,
        status: 'pending_verification',
      })
      .returning()

    if (!account) {
      throw new Error('No se pudo crear la cuenta.')
    }

    const now = new Date()
    await tx.insert(credentials).values({
      accountId: account.id,
      type: 'password',
      secretHash,
      createdAt: now,
      updatedAt: now,
      rotatedAt: now,
    })

    return account
  })
}

export interface RequestAccountDeletionResult {
  transitioned: boolean
  /** Estado real leído bajo bloqueo en el momento de la transición — nunca un valor capturado antes de abrir la transacción. */
  previousStatus: ClientAccountStatus
  /** Ids de las sesiones que esta llamada de verdad revocó — nunca todas las de la cuenta, solo las que transicionaron aquí. */
  revokedSessionIds: string[]
}

/**
 * Solicitud de eliminación de cuenta: transición condicional y atómica a
 * `pending_deletion` **y** revocación de todas las sesiones activas de la
 * cuenta, en una única transacción Postgres — revisión 5 de Fase 3,
 * sustituye la pareja `setAccountStatusIfNot` + `revokeAllSessionsForAccount`
 * (dos transacciones independientes) que usaba
 * `account/delete-request/route.ts`.
 *
 * Con dos transacciones, un fallo del proceso entre la primera (gana,
 * cuenta ya `pending_deletion` y auditada) y la segunda (revocación de
 * sesiones, nunca llega a ejecutarse) dejaba una cuenta marcada para
 * eliminación con sus sesiones antiguas todavía válidas — exactamente lo
 * que `PLAN_DESARROLLO_WEB_PORTAL.md` §15.1 ("bloquea el acceso de
 * inmediato") prohíbe. Ahora:
 *
 * - bloquea la fila de la cuenta (`SELECT ... FOR UPDATE`);
 * - solo escribe si el estado actual NO es ya `pending_deletion` (evita,
 *   p. ej., una segunda solicitud duplicando la auditoría de una
 *   transición que ya ganó — heredado de la revisión 2/3 de
 *   `setAccountStatusIfNot`, mismo razonamiento: el `previousStatus`
 *   devuelto es el real bajo bloqueo, nunca una instantánea anterior a la
 *   transacción);
 * - audita `ClientAccount.status` (`AccountDeletionRequested`) SOLO en la
 *   rama que de verdad transiciona;
 * - revoca todas las sesiones activas (`revokeAllSessionsForAccountInTx`,
 *   con su propia auditoría por sesión) en el mismo `tx` — se confirman o
 *   revierten junto con la transición de estado, nunca por separado.
 *
 * Idempotente: si la cuenta ya estaba `pending_deletion` (doble clic,
 * reintento), no vuelve a transicionar ni a auditar el cambio de estado,
 * pero SÍ vuelve a intentar la revocación de sesiones de forma defensiva
 * — normalmente un no-op (ya no queda ninguna sesión activa, porque la
 * primera llamada que sí ganó ya las revocó todas en su propia
 * transacción), salvo que exista alguna sesión residual (p. ej. dato
 * manipulado directamente, o un hueco no cubierto en otra parte del
 * sistema) — nunca deja una cuenta `pending_deletion` con sesiones
 * activas, en ningún camino.
 */
export async function requestAccountDeletion(
  accountId: string,
  now: Date = new Date(),
): Promise<RequestAccountDeletionResult | null> {
  return authDb.transaction(async (tx) => {
    const [account] = await tx
      .select({ status: clientAccounts.status })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, accountId))
      .for('update')

    if (!account) {
      return null
    }

    if (account.status === 'pending_deletion') {
      const revokedSessionIds = await revokeAllSessionsForAccountInTx(
        tx,
        accountId,
        'account_deletion_requested',
        now,
      )
      return { transitioned: false, previousStatus: account.status, revokedSessionIds }
    }

    await tx
      .update(clientAccounts)
      .set({ status: 'pending_deletion', updatedAt: now })
      .where(eq(clientAccounts.id, accountId))

    await recordRawAuditEvent(
      {
        entity: 'ClientAccount',
        entityId: accountId,
        field: 'status',
        previousValue: account.status,
        newValue: 'pending_deletion',
        actor: { type: 'user', id: accountId },
        channel: 'web',
        occurredAt: now.toISOString(),
        reasonCode: 'AccountDeletionRequested',
      },
      tx,
    )

    const revokedSessionIds = await revokeAllSessionsForAccountInTx(
      tx,
      accountId,
      'account_deletion_requested',
      now,
    )

    return { transitioned: true, previousStatus: account.status, revokedSessionIds }
  })
}

/**
 * Transición condicional y atómica de `independenceStatus`: solo escribe
 * si el valor actual es exactamente `from` (`UPDATE ... WHERE
 * independence_status = from ... RETURNING`, nunca un SELECT seguido de un
 * UPDATE incondicional). Devuelve si de verdad transicionó — el llamante
 * usa esto para decidir si audita la transición (nunca audita una que no
 * ganó).
 */
export async function setAccountIndependenceStatusIf(
  accountId: string,
  from: IndependenceStatus,
  to: IndependenceStatus,
): Promise<boolean> {
  const result = await authDb
    .update(clientAccounts)
    .set({ independenceStatus: to, updatedAt: new Date() })
    .where(and(eq(clientAccounts.id, accountId), eq(clientAccounts.independenceStatus, from)))
    .returning({ id: clientAccounts.id })
  return result.length > 0
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

export type CredentialRow = typeof credentials.$inferSelect

export async function findPasswordCredential(accountId: string): Promise<CredentialRow | null> {
  const [row] = await authDb
    .select()
    .from(credentials)
    .where(and(eq(credentials.accountId, accountId), eq(credentials.type, 'password')))
    .limit(1)
  return row ?? null
}

// ---------------------------------------------------------------------------
// Verificación de correo — registro y activación recuperables
// ---------------------------------------------------------------------------

export interface IssueEmailVerificationRequestInput {
  accountId: string
  otpChallengeId: string
  expiresAt: Date
}

/**
 * Sustituye la solicitud de verificación pendiente anterior (si la había)
 * por una nueva, en una única transacción: marca explícitamente como
 * `expired` cualquier fila `pending` previa de la cuenta antes de insertar
 * la nueva, para no acumular varias solicitudes `pending` indistinguibles
 * (usado tanto por el registro inicial como por el reenvío,
 * `verify-email/resend`). El reto anterior en Redis ya queda invalidado
 * por `otpService.requestOtp` (mismo propósito+sujeto) — esto es el
 * equivalente en Postgres, donde antes no había ninguna sustitución
 * explícita.
 */
export async function replacePendingEmailVerificationRequest(
  input: IssueEmailVerificationRequestInput,
): Promise<void> {
  await authDb.transaction(async (tx) => {
    await tx
      .update(emailVerificationRequests)
      .set({ status: 'expired' })
      .where(and(eq(emailVerificationRequests.accountId, input.accountId), eq(emailVerificationRequests.status, 'pending')))

    await tx.insert(emailVerificationRequests).values({
      accountId: input.accountId,
      status: 'pending',
      otpChallengeId: input.otpChallengeId,
      expiresAt: input.expiresAt,
    })
  })
}

export type CompleteEmailVerificationOutcome =
  | 'activated'
  | 'already_active'
  /** La cuenta existe pero no está en `pending_verification` ni ya `active` — p. ej. `suspended`/`pending_deletion`. Nunca transiciona. */
  | 'invalid_account_state'
  /**
   * No existe una `EmailVerificationRequest` `pending` para esta cuenta con
   * exactamente este `otpChallengeId` — incluye el caso de cuenta
   * inexistente (resultado controlado, nunca una excepción). Nunca
   * transiciona.
   */
  | 'verification_request_not_found'

/**
 * Activa la cuenta de forma condicional y atómica, en una única transacción
 * con bloqueo de fila (`SELECT ... FOR UPDATE`) — **solo** admite la
 * transición `pending_verification -> active`:
 *
 * - `active` ya verificada es idempotente (`'already_active'`, sin
 *   escritura).
 * - `suspended`, `pending_deletion` o cualquier otro estado no
 *   `pending_verification` nunca transicionan (`'invalid_account_state'`) —
 *   revisión 3 de Fase 3: antes de esta corrección, un OTP emitido mientras
 *   la cuenta estaba `pending_verification` podía reactivar una cuenta
 *   suspendida o marcada para eliminación si el código se verificaba
 *   *después* de que un administrador cambiara el estado.
 * - La propia `UPDATE` de `client_accounts` lleva la condición de estado en
 *   el `WHERE` (no solo la comprobación previa en Node) — la fuente de
 *   verdad de si la transición ganó es esa cláusula, no el `SELECT`.
 * - Exige que exista una `EmailVerificationRequest` `pending` para esta
 *   cuenta cuyo `otpChallengeId` coincida exactamente con el reto que
 *   `verifyOtp` acaba de validar (`'verification_request_not_found'` si
 *   no) — nunca marca "todas las solicitudes pendientes" de la cuenta,
 *   solo la fila concreta atada a ese reto.
 *
 * Se invoca en dos caminos: (1) el normal, cuando `otpService.verifyOtp`
 * devuelve `'verified'`; (2) el de recuperación, cuando devuelve
 * `'already_consumed'` con `codeMatchesConsumedChallenge: true` — el reto
 * en Redis ya se consumió en un intento anterior (código correcto), pero
 * esta función (la activación en Postgres) nunca llegó a ejecutarse por un
 * fallo de infraestructura entre ambos pasos. Llamarla de nuevo con el
 * mismo `accountId`+`otpChallengeId` completa la activación de forma
 * segura, sin depender de si esta es la primera o la enésima vez que se
 * invoca para ese resultado.
 *
 * Revisión 4 de Fase 3: la entrada de auditoría `ClientAccount.status`
 * (`pending_verification -> active`) y el encolado del trabajo posterior
 * `evaluate_espo_link` (`outbox.ts`) se insertan dentro de esta MISMA
 * transacción, solo en la rama que de verdad gana (`updatedAccount.length
 * > 0`) — nunca después del commit. Una caída entre el `UPDATE` y estas dos
 * escrituras ya no puede ocurrir: o las tres se confirman juntas, o
 * ninguna, y una repetición idempotente (`'already_active'`) nunca las
 * repite porque ni siquiera llega a esa rama.
 */
export async function completeEmailVerification(
  accountId: string,
  otpChallengeId: string,
): Promise<CompleteEmailVerificationOutcome> {
  return authDb.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: clientAccounts.id, status: clientAccounts.status, emailVerifiedAt: clientAccounts.emailVerifiedAt })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, accountId))
      .for('update')

    if (!account) {
      return 'verification_request_not_found'
    }

    if (account.status === 'active' && account.emailVerifiedAt !== null) {
      return 'already_active'
    }

    if (account.status !== 'pending_verification') {
      return 'invalid_account_state'
    }

    const [pendingRequest] = await tx
      .select({ id: emailVerificationRequests.id })
      .from(emailVerificationRequests)
      .where(
        and(
          eq(emailVerificationRequests.accountId, accountId),
          eq(emailVerificationRequests.status, 'pending'),
          eq(emailVerificationRequests.otpChallengeId, otpChallengeId),
        ),
      )
      .limit(1)
      .for('update')

    if (!pendingRequest) {
      return 'verification_request_not_found'
    }

    const now = new Date()
    const updatedAccount = await tx
      .update(clientAccounts)
      .set({ status: 'active', emailVerifiedAt: now, updatedAt: now })
      .where(and(eq(clientAccounts.id, accountId), eq(clientAccounts.status, 'pending_verification')))
      .returning({ id: clientAccounts.id })

    if (updatedAccount.length === 0) {
      return 'invalid_account_state'
    }

    await tx
      .update(emailVerificationRequests)
      .set({ status: 'verified', verifiedAt: now })
      .where(and(eq(emailVerificationRequests.id, pendingRequest.id), eq(emailVerificationRequests.status, 'pending')))

    await recordRawAuditEvent(
      {
        entity: 'ClientAccount',
        entityId: accountId,
        field: 'status',
        previousValue: 'pending_verification',
        newValue: 'active',
        actor: { type: 'user', id: accountId },
        channel: 'email',
        occurredAt: now.toISOString(),
        reasonCode: 'AccountEmailVerified',
      },
      tx,
    )

    await enqueueEvaluateEspoLinkJob(tx, accountId)

    return 'activated'
  })
}

// ---------------------------------------------------------------------------
// Recuperación de contraseña — solicitud y consumo recuperables
// ---------------------------------------------------------------------------

export interface IssuePasswordResetRequestInput {
  accountId: string
  otpChallengeId: string
  expiresAt: Date
  idempotencyKey: string
}

/** Mismo patrón que `replacePendingEmailVerificationRequest`, para `password_reset_requests`. */
export async function replacePendingPasswordResetRequest(input: IssuePasswordResetRequestInput): Promise<void> {
  await authDb.transaction(async (tx) => {
    await tx
      .update(passwordResetRequests)
      .set({ status: 'expired' })
      .where(and(eq(passwordResetRequests.accountId, input.accountId), eq(passwordResetRequests.status, 'pending')))

    await tx.insert(passwordResetRequests).values({
      accountId: input.accountId,
      status: 'pending',
      otpChallengeId: input.otpChallengeId,
      expiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
    })
  })
}

export type CompletePasswordResetOutcome =
  | 'completed'
  | 'already_completed'
  | 'request_not_found'
  /**
   * La solicitud existe y está `pending`, pero no hay credencial de
   * contraseña para la cuenta (o la `UPDATE` no afectó a ninguna fila) —
   * estado inconsistente que nunca debería darse por construcción
   * (`createAccountWithPasswordCredential` crea cuenta+credencial en la
   * misma transacción, revisión 2), pero se comprueba explícitamente en
   * vez de asumirlo: nunca se marca la solicitud como consumida ni se
   * responde como si la contraseña se hubiera cambiado sin haber rotado
   * ninguna fila real.
   */
  | 'credential_missing'

/**
 * Rota la credencial de contraseña, consume la solicitud de recuperación
 * exacta y revoca TODAS las sesiones activas de la cuenta — todo en una
 * única transacción Postgres con bloqueo de fila. Idempotente y
 * recuperable: ver el razonamiento de `completeEmailVerification` (mismo
 * patrón de invocación en el camino normal, `verifyOtp -> 'verified'`, y
 * en el de recuperación, `'already_consumed'` con
 * `codeMatchesConsumedChallenge: true`).
 *
 * Revisión 4 de Fase 3: la auditoría `PasswordResetCompleted` ya se
 * insertaba dentro de esta transacción. Revisión 5 de Fase 3, dos
 * correcciones adicionales:
 *
 * 1. **`otpChallengeId` exacto**: antes se tomaba "la" solicitud `pending`
 *    de la cuenta (asumiendo que solo puede haber una, por construcción de
 *    `replacePendingPasswordResetRequest`) sin comprobar que fuera la
 *    atada al reto que `verifyOtp` acaba de validar — mismo hueco que
 *    `completeIndependenceRequest` cerró en la revisión 4 para
 *    independencia. Ahora se bloquea la fila exacta
 *    `accountId + otpChallengeId`, nunca "cualquier pendiente".
 * 2. **Revocación de sesiones dentro de la misma transacción**: antes,
 *    `password/reset/route.ts` llamaba a `revokeAllSessionsForAccount`
 *    (su propia transacción, después del commit de esta) — un fallo del
 *    proceso entre ambas dejaba la contraseña ya rotada con las sesiones
 *    antiguas todavía válidas. Ahora `revokeAllSessionsForAccountInTx` se
 *    invoca con el `tx` de esta función: rotación de credencial, consumo
 *    de la solicitud, revocación de todas las sesiones y la auditoría de
 *    cada una (más `PasswordResetCompleted`) se confirman o revierten
 *    juntas — nunca un estado intermedio visible.
 *
 * Como toda la transición vive en una única transacción, un fallo a
 * mitad de camino (antes de comprometer) revierte TODO — la fila
 * `password_reset_requests` exacta sigue `pending`, así que un reintento
 * con el mismo `otpChallengeId` (recuperación vía `already_consumed` en
 * Redis) vuelve a caer en la rama `'pending'` y completa el flujo entero
 * de una vez, nunca a medias. `'already_completed'` solo se devuelve
 * cuando la fila ya está `consumed` — y por construcción (todo en una
 * transacción) eso implica que credencial, solicitud y revocación de
 * sesiones ya se confirmaron juntas en un intento anterior; no hay ningún
 * trabajo pendiente que recuperar en ese caso.
 *
 * Comprobación defensiva añadida en la revisión de cierre de Fase 3: antes
 * de esta corrección, la `UPDATE` de `credentials` se ejecutaba a ciegas
 * (sin `.returning()`) y la solicitud se marcaba `consumed` con
 * independencia de si esa `UPDATE` había afectado a alguna fila. Con
 * cuenta+credencial creadas siempre juntas (revisión 2,
 * `createAccountWithPasswordCredential`) esto nunca debería ocurrir en la
 * práctica, pero de ocurrir (dato corrupto, migración incompleta),
 * consumía igualmente la solicitud sin haber rotado ninguna contraseña
 * real — el llamante nunca se enteraba. Ahora se verifica explícitamente
 * (`'credential_missing'`) y la solicitud permanece `pending`, para que un
 * reintento futuro (una vez resuelto el estado subyacente) pueda
 * completarla.
 */
export async function completePasswordReset(
  accountId: string,
  otpChallengeId: string,
  newSecretHash: string,
  now: Date = new Date(),
): Promise<CompletePasswordResetOutcome> {
  return authDb.transaction(async (tx) => {
    // Bloquea la credencial de contraseña — serializa dos restablecimientos
    // concurrentes de la misma cuenta (ninguno de los dos puede rotar dos
    // veces, y como mucho uno gana la carrera contra la condición de
    // `status = 'pending'` de más abajo).
    const [credentialRow] = await tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.accountId, accountId), eq(credentials.type, 'password')))
      .for('update')

    const [request] = await tx
      .select({ id: passwordResetRequests.id, status: passwordResetRequests.status })
      .from(passwordResetRequests)
      .where(
        and(eq(passwordResetRequests.accountId, accountId), eq(passwordResetRequests.otpChallengeId, otpChallengeId)),
      )
      .limit(1)
      .for('update')

    if (!request) {
      return 'request_not_found'
    }

    if (request.status !== 'pending') {
      // `'consumed'`: esta misma solicitud ya completó el flujo entero
      // (credencial + sesiones + auditoría), en una única transacción
      // anterior — repetición idempotente, sin trabajo pendiente. Otro
      // estado (`'expired'`, superada por una solicitud posterior): la
      // misma respuesta controlada, nunca una excepción.
      return request.status === 'consumed' ? 'already_completed' : 'request_not_found'
    }

    if (!credentialRow) {
      return 'credential_missing'
    }

    const updatedCredential = await tx
      .update(credentials)
      .set({ secretHash: newSecretHash, updatedAt: now, rotatedAt: now })
      .where(and(eq(credentials.accountId, accountId), eq(credentials.type, 'password')))
      .returning({ id: credentials.id })

    if (updatedCredential.length === 0) {
      return 'credential_missing'
    }

    await tx
      .update(passwordResetRequests)
      .set({ status: 'consumed', consumedAt: now })
      .where(and(eq(passwordResetRequests.id, request.id), eq(passwordResetRequests.status, 'pending')))

    await revokeAllSessionsForAccountInTx(tx, accountId, 'password_changed', now)

    await recordEventAuditEvent(
      {
        entity: 'ClientAccount',
        entityId: accountId,
        actor: { type: 'user', id: accountId },
        channel: 'email',
        occurredAt: now.toISOString(),
        reasonCode: 'PasswordResetCompleted',
      },
      tx,
    )

    return 'completed'
  })
}

// ---------------------------------------------------------------------------
// Independencia al alcanzar la mayoría de edad
// ---------------------------------------------------------------------------

export type IndependenceRequestRow = typeof independenceRequests.$inferSelect

export interface CreateIndependenceRequestInput {
  minorAccountId: string
  otpChallengeId: string
}

export async function createIndependenceRequest(input: CreateIndependenceRequestInput): Promise<IndependenceRequestRow> {
  const [row] = await authDb
    .insert(independenceRequests)
    .values({
      minorAccountId: input.minorAccountId,
      status: 'pending',
      otpChallengeId: input.otpChallengeId,
    })
    .returning()

  if (!row) {
    throw new Error('No se pudo crear la solicitud de independencia.')
  }
  return row
}

export async function findIndependenceRequestById(id: string): Promise<IndependenceRequestRow | null> {
  const [row] = await authDb.select().from(independenceRequests).where(eq(independenceRequests.id, id)).limit(1)
  return row ?? null
}

export async function listIndependenceRequestsForMinor(minorAccountId: string): Promise<IndependenceRequestRow[]> {
  return authDb.select().from(independenceRequests).where(eq(independenceRequests.minorAccountId, minorAccountId))
}

export type CompleteIndependenceRequestOutcome =
  | 'granted'
  /** Idempotente: esta misma solicitud ya había concedido la independencia (repetición segura, nunca audita dos veces). */
  | 'already_granted'
  /** Solicitud inexistente, o no pertenece a `accountId` — resultado controlado, nunca una excepción. */
  | 'request_not_found'
  /** El `challengeId` validado por `verifyOtp` no coincide con el de esta solicitud — un código de otra solicitud nunca puede completar esta. */
  | 'challenge_mismatch'
  /** Repetición de la comprobación de elegibilidad bajo bloqueo: ya no es adulta, ya no tiene vínculo de tutela histórico, o el estado no lo permite. */
  | 'not_eligible'

/**
 * Revisión 3 de Fase 3: sustituye la pareja `markIndependenceRequestConfirmed`
 * + `setAccountIndependenceStatusIf` (dos transacciones Postgres
 * independientes) por una única transacción. Con dos transacciones, un
 * fallo entre la primera (gana) y la segunda (falla) dejaba la solicitud
 * `confirmed` con la cuenta todavía `pending`, el OTP ya consumido en
 * Redis, y un reintento recibiendo `already_consumed` sin ninguna vía para
 * completar la concesión — la API llegaba a responder `{status: "granted"}`
 * sin que la cuenta hubiera transicionado nunca.
 *
 * Dentro de una única transacción:
 * - bloquea la cuenta y la solicitud (`SELECT ... FOR UPDATE`);
 * - comprueba que la solicitud pertenece a `accountId`;
 * - vuelve a comprobar mayoría de edad, vínculo de tutela histórico y que
 *   `independenceStatus` no esté ya `granted`;
 * - actualiza solicitud y cuenta juntas — o se aplican ambas modificaciones
 *   o ninguna (mismo commit/rollback);
 * - nunca devuelve `'granted'` si la cuenta no quedó `granted` de verdad.
 *
 * Recuperabilidad: si un intento anterior dejó la solicitud `confirmed`
 * pero la cuenta todavía no `granted` (el estado inconsistente que producía
 * la versión de dos transacciones, incluido cualquier dato heredado de
 * antes de esta revisión), esta función lo reconcilia en el mismo paso —
 * vuelve a comprobar elegibilidad y completa la concesión — en vez de
 * quedarse bloqueada esperando una solicitud que ya nunca volverá a estar
 * `pending`. Si ambas partes ya habían transicionado, es un no-op
 * idempotente (`'already_granted'`).
 *
 * Revisión 4 de Fase 3, dos correcciones adicionales:
 *
 * 1. **Auditoría atómica**: las entradas `ClientAccount.independenceStatus`
 *    (raw) e `IndependenceRequest` (event, `IndependenceGranted`) se
 *    insertan dentro de esta misma transacción, solo en la rama que de
 *    verdad concede (`granted.length > 0`) — nunca en `'already_granted'`.
 *    `previousValue` es el `independenceStatus` real leído bajo bloqueo al
 *    principio de la transacción (`account.independenceStatus`), nunca un
 *    valor asumido — en el camino normal siempre es `'pending'`, pero en
 *    una reconciliación heredada podría no serlo, y afirmar `'pending'` a
 *    ciegas sería, en sí mismo, un valor de auditoría potencialmente falso.
 *
 * 2. **Política de challenge exacto, también en la reconciliación
 *    heredada**: antes de esta revisión, la comprobación
 *    `otpChallengeId !== challengeId` solo se aplicaba cuando
 *    `request.status === 'pending'` — una solicitud `confirmed` con la
 *    cuenta todavía `pending` (el estado inconsistente heredado que esta
 *    misma función reconcilia) aceptaba **cualquier** OTP de propósito
 *    `independence_confirmation` válido para la cuenta, sin comprobar que
 *    perteneciera a esta solicitud concreta — contradice la garantía
 *    documentada de que toda recuperación se ata a la fila y al reto
 *    exactos (mismo principio que `completeEmailVerification`/
 *    `otpChallengeId` en verificación de correo).
 *
 *    La comprobación ahora es incondicional, para `pending` y para
 *    `confirmed` por igual: `challengeId` debe coincidir siempre con
 *    `request.otpChallengeId`. Esto ya implementa, sin infraestructura
 *    nueva, la política pedida:
 *    - **Reto original todavía vigente y coincide**: `verifyOtp` lo valida
 *      contra el puntero actual en Redis para
 *      `independence_confirmation`+`accountId`; si nadie ha pedido un OTP
 *      nuevo para esa cuenta desde que se creó `request`, el puntero
 *      sigue siendo `request.otpChallengeId` — `challengeId` coincide y la
 *      reconciliación procede (tanto si `verifyOtp` devuelve `'verified'`
 *      como `'already_consumed'` con `codeMatchesConsumedChallenge: true`
 *      para ese mismo reto).
 *    - **Reto original ya no es el vigente** (caducó y el puntero se
 *      sobrescribió, o la propia cuenta pidió un OTP nuevo mientras
 *      tanto): `verifyOtp` valida contra ESE otro reto, `result.challengeId`
 *      no coincide con `request.otpChallengeId` de la fila heredada, y esta
 *      función devuelve `'challenge_mismatch'` — nunca concede con un
 *      código que no demuestra conocer el reto exacto de esta solicitud.
 *      La vía de reconciliación explícita y segura ya existe sin construir
 *      nada nuevo: `isEligibleForIndependenceRequest` (`packages/contracts`)
 *      sigue considerando elegible una cuenta con `independenceStatus:
 *      'pending'` (solo excluye `'granted'`), así que
 *      `POST /api/auth/independence-requests` puede volver a llamarse —
 *      crea una `IndependenceRequest` NUEVA con su propio reto (la
 *      transición `not_applicable -> pending` de la cuenta es un no-op
 *      porque ya está `pending`, sin auditoría duplicada), y esa solicitud
 *      nueva se completa por el camino normal (`status === 'pending'`),
 *      atada a su propio challenge desde el principio. La fila heredada
 *      `confirmed` queda para siempre en ese estado terminal-no-terminal
 *      (nunca vuelve a `pending`, nunca se borra) — inofensivo: en cuanto
 *      la cuenta pasa a `granted` por la solicitud nueva, cualquier
 *      intento posterior de completar la fila heredada cae en el primer
 *      `if` (`'already_granted'`). Nunca se implementó un job
 *      administrativo/reconciliador separado: la vía de "pedir un reto
 *      nuevo" ya cubre el caso sin superficie nueva que auditar/proteger.
 */
export async function completeIndependenceRequest(
  requestId: string,
  accountId: string,
  challengeId: string,
  now: Date,
): Promise<CompleteIndependenceRequestOutcome> {
  return authDb.transaction(async (tx) => {
    const [account] = await tx
      .select({
        id: clientAccounts.id,
        dateOfBirth: clientAccounts.dateOfBirth,
        independenceStatus: clientAccounts.independenceStatus,
      })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, accountId))
      .for('update')

    if (!account) {
      return 'request_not_found'
    }

    const [request] = await tx
      .select({
        id: independenceRequests.id,
        minorAccountId: independenceRequests.minorAccountId,
        status: independenceRequests.status,
        otpChallengeId: independenceRequests.otpChallengeId,
      })
      .from(independenceRequests)
      .where(eq(independenceRequests.id, requestId))
      .for('update')

    if (!request || request.minorAccountId !== accountId) {
      return 'request_not_found'
    }

    if (request.status === 'confirmed' && account.independenceStatus === 'granted') {
      return 'already_granted'
    }

    if (request.status !== 'pending' && request.status !== 'confirmed') {
      // rejected/expired: estado terminal, no se puede completar por esta vía.
      return 'not_eligible'
    }

    if (request.otpChallengeId !== challengeId) {
      // Incondicional — se aplica tanto a una solicitud `pending` normal
      // como a una `confirmed` heredada en reconciliación (revisión 4 de
      // Fase 3, ver el comentario de la función): un código válido para
      // OTRA solicitud, o para un reto reemitido después del original,
      // nunca puede completar esta — nunca se consume ni se modifica nada.
      return 'challenge_mismatch'
    }

    const [historicalGuardianLink] = await tx
      .select({ id: guardianLinks.id })
      .from(guardianLinks)
      .where(eq(guardianLinks.minorAccountId, accountId))
      .limit(1)

    const stillEligible =
      account.independenceStatus !== 'granted' &&
      historicalGuardianLink !== undefined &&
      decideAccountAgeCategory(account.dateOfBirth, now) === 'adult'

    if (!stillEligible) {
      return 'not_eligible'
    }

    if (request.status === 'pending') {
      const confirmed = await tx
        .update(independenceRequests)
        .set({ status: 'confirmed', confirmedAt: now, resolvedAt: now })
        .where(and(eq(independenceRequests.id, requestId), eq(independenceRequests.status, 'pending')))
        .returning({ id: independenceRequests.id })

      if (confirmed.length === 0) {
        return 'not_eligible'
      }
    }

    const granted = await tx
      .update(clientAccounts)
      .set({ independenceStatus: 'granted', updatedAt: now })
      .where(and(eq(clientAccounts.id, accountId), ne(clientAccounts.independenceStatus, 'granted')))
      .returning({ id: clientAccounts.id })

    if (granted.length === 0) {
      // Solo alcanzable si otra transacción concurrente ya concedió la
      // independencia entre la comprobación de elegibilidad y este UPDATE
      // — el bloqueo de la fila de la cuenta ya lo impide en la práctica,
      // pero la condición en el propio WHERE es la fuente de verdad real.
      return 'already_granted'
    }

    await recordRawAuditEvent(
      {
        entity: 'ClientAccount',
        entityId: accountId,
        field: 'independenceStatus',
        previousValue: account.independenceStatus,
        newValue: 'granted',
        actor: { type: 'user', id: accountId },
        channel: 'web',
        occurredAt: now.toISOString(),
        reasonCode: 'IndependenceGranted',
      },
      tx,
    )

    await recordEventAuditEvent(
      {
        entity: 'IndependenceRequest',
        entityId: requestId,
        actor: { type: 'user', id: accountId },
        channel: 'web',
        occurredAt: now.toISOString(),
        reasonCode: 'IndependenceGranted',
      },
      tx,
    )

    return 'granted'
  })
}
