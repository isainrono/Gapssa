import 'server-only'
import { randomBytes, createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { isSessionUsable, type AuditReasonCode, type SessionRevokedReason } from '@gapssa/contracts'

import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../../lib/auth/cookieNames'
import { serverEnv } from '../env'
import { recordRawAuditEvent } from './audit'
import { authDb, type AuthTx } from './db/client'
import { clientAccounts, sessions } from './db/schema'

/** `Session.revokedReason` (dominio propio del campo) -> `AuditReasonCode` (dominio propio de la auditoría) — dos enums cerrados independientes que representan conceptos parecidos, ver auth.ts. */
const SESSION_REVOKED_REASON_TO_AUDIT_REASON: Readonly<Record<SessionRevokedReason, AuditReasonCode>> = {
  user_logout: 'SessionRevokedByUser',
  user_revoked_other_session: 'SessionRevokedByUser',
  password_changed: 'SessionRevokedByPasswordChange',
  admin_action: 'SessionRevokedByAdmin',
  expired_idle: 'SessionExpiredIdle',
  expired_absolute: 'SessionExpiredAbsolute',
  account_deletion_requested: 'AccountDeletionRequested',
}

/** Motivos en los que quien actúa es el propio dueño de la cuenta (identidad ya probada por sesión activa u OTP) — el resto son iniciativa del sistema o de un administrador. */
const USER_INITIATED_REVOCATION_REASONS: ReadonlySet<SessionRevokedReason> = new Set([
  'user_logout',
  'user_revoked_other_session',
  'password_changed',
  'account_deletion_requested',
])

/** `tx` opcional — revisión 4 de Fase 3: cuando el llamante ya tiene una transacción abierta para la propia revocación, se pasa aquí para que ambas se confirmen juntas (ver revokeSessionById/revokeAllSessionsForAccount/getActiveSessionFromCookies). */
async function auditSessionRevoked(
  sessionId: string,
  accountId: string,
  reason: SessionRevokedReason,
  now: Date,
  tx?: AuthTx,
): Promise<void> {
  await recordRawAuditEvent(
    {
      entity: 'Session',
      entityId: sessionId,
      field: 'revokedReason',
      previousValue: null,
      newValue: reason,
      actor: USER_INITIATED_REVOCATION_REASONS.has(reason)
        ? { type: 'user', id: accountId }
        : { type: 'system', name: 'bff' },
      channel: 'web',
      occurredAt: now.toISOString(),
      reasonCode: SESSION_REVOKED_REASON_TO_AUDIT_REASON[reason],
    },
    tx,
  )
}

/**
 * Sesiones del portal — cookie `HttpOnly`, `Secure` en producción y
 * `SameSite=Lax` (`PLAN_DESARROLLO_WEB_PORTAL.md` §6.2/§15). `Lax`, no
 * `Strict`: un enlace de verificación abierto desde un cliente de correo
 * es una navegación de nivel superior entre sitios — `Strict` la trataría
 * como "sin cookie", rompiendo el flujo de acceso sin contraseña.
 *
 * El token de sesión en claro solo vive en la cookie del navegador; la
 * base de datos guarda únicamente `tokenHash` (SHA-256) — igual que un
 * OTP, nunca el secreto en sí (`packages/contracts/src/auth.ts`).
 */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export interface CreatedSession {
  sessionId: string
  accountId: string
  expiresAt: Date
}

/**
 * Crea una sesión nueva y planta la cookie — se usa exclusivamente tras
 * autenticar con éxito (login por contraseña o sin contraseña), nunca
 * antes: no existen sesiones "anónimas" pre-autenticación en este diseño,
 * así que cada login emite un token nuevo por construcción (rotación de
 * sesión tras autenticación, `PLAN_DESARROLLO_WEB_PORTAL.md` §6.2), sin
 * reutilizar ningún identificador previo.
 */
export async function createSession(
  accountId: string,
  context: { ipAddress: string | null; userAgent: string | null },
): Promise<CreatedSession> {
  const token = generateToken()
  const tokenHash = hashToken(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + serverEnv.AUTH_SESSION_ABSOLUTE_TTL_DAYS * 86_400_000)

  const [row] = await authDb
    .insert(sessions)
    .values({
      accountId,
      tokenHash,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })
    .returning({ id: sessions.id })

  if (!row) {
    throw new Error('No se pudo crear la sesión.')
  }

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })

  // Token CSRF de doble envío, regenerado en cada login — no HttpOnly a
  // propósito: el cliente debe poder leerlo para reenviarlo como cabecera
  // en peticiones que mutan estado (ver csrf.ts).
  const csrfToken = generateToken()
  cookieStore.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })

  return { sessionId: row.id, accountId, expiresAt }
}

export interface ActiveSession {
  id: string
  accountId: string
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
}

/**
 * Motivo de revocación defensiva cuando `getActiveSessionFromCookies`
 * encuentra una sesión técnicamente no revocada de una cuenta que ya no
 * está `active` — nunca debería ocurrir por el camino normal de la
 * aplicación (`login/route.ts` solo crea sesiones para cuentas `active`,
 * y `requestAccountDeletion` revoca todas las sesiones en la misma
 * transacción que marca `pending_deletion`), pero cierra el hueco de
 * cualquier fila que haya quedado residual (fallo no cubierto, dato
 * manipulado directamente) — revisión 5 de Fase 3, ver
 * `docs/fase3-autenticacion.md`. `pending_deletion` reutiliza el motivo ya
 * específico de esa transición; cualquier otro estado no-`active`
 * (`suspended`, o el inalcanzable-por-diseño `pending_verification`) usa
 * `admin_action` — ninguno de los dos es "el usuario cerró sesión".
 */
function revokedReasonForInactiveAccount(accountStatus: string): SessionRevokedReason {
  return accountStatus === 'pending_deletion' ? 'account_deletion_requested' : 'admin_action'
}

/**
 * Lee la cookie de sesión, valida contra la base de datos (nunca solo la
 * cookie) y actualiza `lastSeenAt` — la comprobación de inactividad de 30
 * minutos (`SESSION_IDLE_TIMEOUT_MINUTES`, auth.ts) se aplica sobre este
 * campo. Si la sesión ya no es utilizable (revocada, expirada por
 * inactividad o por TTL absoluto), la marca como revocada con el motivo
 * correspondiente y devuelve `null` — nunca dos peticiones sucesivas dejan
 * una sesión vencida "viva a medias".
 *
 * Revisión 5 de Fase 3: la consulta ahora hace `JOIN` con `client_accounts`
 * y comprueba `status === 'active'` **antes** de cualquier otra cosa —
 * nunca solo el estado de la propia fila `sessions`. Cierra la ventana en
 * la que una cuenta pasaba a `suspended`/`pending_deletion` y una sesión
 * emitida mientras era `active` seguía siendo, en sí misma,
 * `isSessionUsable` (no revocada, no vencida) y por tanto autorizaba
 * peticiones igualmente — el bloqueo de acceso de
 * `PLAN_DESARROLLO_WEB_PORTAL.md` §15.1 exige lo contrario. Una cuenta
 * `pending_verification` (nunca alcanzable por el flujo normal de login,
 * que solo crea sesiones para `active`) tampoco autoriza nunca por esta
 * vía. Si la cuenta no está `active`, la sesión se revoca de forma
 * defensiva (idempotente) y se audita, en la misma transacción — nunca se
 * actualiza `lastSeenAt` para una cuenta no activa.
 */
export async function getActiveSessionFromCookies(): Promise<ActiveSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return null
  }

  const tokenHash = hashToken(token)
  const [row] = await authDb
    .select({
      id: sessions.id,
      accountId: sessions.accountId,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      revokedAt: sessions.revokedAt,
      accountStatus: clientAccounts.status,
    })
    .from(sessions)
    .innerJoin(clientAccounts, eq(sessions.accountId, clientAccounts.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1)
  if (!row) {
    return null
  }

  const now = new Date()

  if (row.accountStatus !== 'active') {
    if (row.revokedAt === null) {
      const reason = revokedReasonForInactiveAccount(row.accountStatus)
      await authDb.transaction(async (tx) => {
        const result = await tx
          .update(sessions)
          .set({ revokedAt: now, revokedReason: reason })
          .where(and(eq(sessions.id, row.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id })
        if (result.length > 0) {
          await auditSessionRevoked(row.id, row.accountId, reason, now, tx)
        }
      })
    }
    return null
  }

  if (
    !isSessionUsable(
      {
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      },
      now,
    )
  ) {
    // Si ya estaba revocada por otro motivo (logout, cambio de
    // contraseña...), no lo sobreescribas con "expirada" — el registro de
    // auditoría del motivo original debe conservarse. La condición
    // `isNull(revokedAt)` vive en el propio WHERE del UPDATE (no solo en
    // el `if` de arriba): dos peticiones concurrentes con la misma cookie
    // ya vencida podían, antes de esta revisión, leer las dos
    // `revokedAt === null` y escribir/auditar las dos — una auditoría
    // duplicada de una única transición real. Con la condición en el
    // UPDATE, como mucho una gana, y solo esa audita.
    if (row.revokedAt === null) {
      const reason: SessionRevokedReason =
        now.getTime() >= row.expiresAt.getTime() ? 'expired_absolute' : 'expired_idle'
      // Revisión 4 de Fase 3: UPDATE + auditoría en una única transacción —
      // antes eran dos sentencias sueltas; una caída entre ambas dejaba una
      // sesión marcada como expirada sin ninguna entrada duradera que lo
      // explicara.
      await authDb.transaction(async (tx) => {
        const result = await tx
          .update(sessions)
          .set({ revokedAt: now, revokedReason: reason })
          .where(and(eq(sessions.id, row.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id })
        if (result.length > 0) {
          await auditSessionRevoked(row.id, row.accountId, reason, now, tx)
        }
      })
    }
    return null
  }

  await authDb.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.id))

  return {
    id: row.id,
    accountId: row.accountId,
    createdAt: row.createdAt,
    lastSeenAt: now,
    expiresAt: row.expiresAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  }
}

export async function listActiveSessionsForAccount(accountId: string): Promise<ActiveSession[]> {
  const rows = await authDb.select().from(sessions).where(eq(sessions.accountId, accountId))
  const now = new Date()
  return rows
    .filter((row) =>
      isSessionUsable(
        {
          revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
          lastSeenAt: row.lastSeenAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        },
        now,
      ),
    )
    .map((row) => ({
      id: row.id,
      accountId: row.accountId,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
    }))
}

/**
 * Revoca una sesión concreta — usada tanto por "cerrar esta sesión" como
 * por "cerrar aquella otra sesión" desde /mi-cuenta. No-op (y devuelve
 * `false`) si ya estaba revocada, para no sobreescribir el motivo
 * original. `accountId` forma parte del propio `WHERE` (no solo se
 * comprueba después): una sesión de otra cuenta no se toca en absoluto,
 * ni siquiera si `sessionId` es válido pero pertenece a otro dueño.
 */
export async function revokeSessionById(
  sessionId: string,
  accountId: string,
  reason: SessionRevokedReason,
): Promise<boolean> {
  const now = new Date()
  // Revisión 4 de Fase 3: UPDATE + auditoría atómicos, mismo razonamiento
  // que getActiveSessionFromCookies.
  return authDb.transaction(async (tx) => {
    const result = await tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id })

    const revoked = result.length > 0
    if (revoked) {
      await auditSessionRevoked(sessionId, accountId, reason, now, tx)
    }
    return revoked
  })
}

/**
 * Revoca todas las sesiones activas de una cuenta **dentro de una
 * transacción ya abierta por el llamante** — revisión 5 de Fase 3.
 *
 * Antes (revisión 4), `revokeAllSessionsForAccount` abría una transacción
 * Postgres independiente POR SESIÓN (`Promise.all` de `authDb.transaction`
 * sueltas). Cada una era atómica en sí misma (UPDATE + auditoría de esa
 * sesión), pero el conjunto no lo era: un fallo del proceso a mitad del
 * `Promise.all` dejaba, p. ej. tras un restablecimiento de contraseña, la
 * credencial ya rotada pero solo ALGUNAS sesiones antiguas revocadas —
 * exactamente la ventana que este helper cierra. Ahora el bloqueo
 * (`SELECT ... FOR UPDATE`), la actualización masiva y la auditoría de
 * cada sesión revocada de verdad viven en el `tx` que recibe como
 * parámetro — el mismo que el llamante usa para su propia transición de
 * negocio (rotación de credencial, transición a `pending_deletion`...).
 * O se confirman juntas todas las revocaciones+auditorías+la transición
 * que las origina, o no se confirma nada.
 *
 * Idempotente: si se llama dos veces sobre la misma cuenta (mismo `tx` o
 * `tx` distintos en llamadas separadas), la segunda encuentra cero
 * sesiones con `revokedAt IS NULL` que bloquear y no escribe ni audita
 * nada. Devuelve los ids de las sesiones que de verdad se revocaron en
 * esta llamada — nunca todas las de la cuenta, solo las que transicionaron
 * aquí.
 */
export async function revokeAllSessionsForAccountInTx(
  tx: AuthTx,
  accountId: string,
  reason: SessionRevokedReason,
  now: Date,
  exceptSessionId?: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)))
    .for('update')

  const idsToRevoke = rows.map((row) => row.id).filter((id) => id !== exceptSessionId)
  if (idsToRevoke.length === 0) {
    return []
  }

  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(inArray(sessions.id, idsToRevoke), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id })

  for (const revokedRow of revoked) {
    await auditSessionRevoked(revokedRow.id, accountId, reason, now, tx)
  }

  return revoked.map((revokedRow) => revokedRow.id)
}

/**
 * Revoca todas las sesiones de una cuenta como operación de nivel
 * superior — usada cuando no existe ya una transacción mayor de la que
 * formar parte (p. ej. una futura acción administrativa aislada). Abre su
 * propia transacción y delega en `revokeAllSessionsForAccountInTx`.
 *
 * `completePasswordReset` (repository.ts) y `requestAccountDeletion`
 * (repository.ts) NO usan esta función — llaman directamente a
 * `revokeAllSessionsForAccountInTx` con su propio `tx`, para que la
 * revocación masiva se confirme en la misma transacción que la rotación
 * de credencial / transición de cuenta que la origina.
 */
export async function revokeAllSessionsForAccount(
  accountId: string,
  reason: SessionRevokedReason,
  exceptSessionId?: string,
): Promise<void> {
  const now = new Date()
  await authDb.transaction(async (tx) => {
    await revokeAllSessionsForAccountInTx(tx, accountId, reason, now, exceptSessionId)
  })
}

export async function clearSessionCookies(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
  cookieStore.delete(CSRF_COOKIE_NAME)
}
