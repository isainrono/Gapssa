import { Client } from 'pg'
import { inject } from 'vitest'

/** Conexión directa de solo-lectura/aserción a `gapssa_auth_test_<random>` — nunca a `gapssa_auth` real. Una conexión por llamada: volumen de pruebas bajo, no necesita pool. */
export async function withAuthDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: inject('integrationAuthDatabaseUrl') })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function countAccountsByEmail(email: string): Promise<number> {
  return withAuthDb(async (client) => {
    const result = await client.query('select count(*)::int as count from client_accounts where email = $1', [email])
    return (result.rows[0] as { count: number }).count
  })
}

export async function getAccountStatusById(accountId: string): Promise<string | null> {
  return withAuthDb(async (client) => {
    const result = await client.query('select status from client_accounts where id = $1', [accountId])
    return (result.rows[0] as { status: string } | undefined)?.status ?? null
  })
}

export async function findAccountRowByEmail(email: string): Promise<Record<string, unknown> | null> {
  return withAuthDb(async (client) => {
    const result = await client.query('select * from client_accounts where email = $1', [email])
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

export async function auditRowsForEntity(entity: string, entityId: string): Promise<Record<string, unknown>[]> {
  return withAuthDb(async (client) => {
    const result = await client.query(
      'select * from auth_audit_log where entity = $1 and entity_id = $2 order by occurred_at',
      [entity, entityId],
    )
    return result.rows as Record<string, unknown>[]
  })
}

/**
 * Solo para pruebas: reescribe `date_of_birth` directamente en la base
 * efímera, simulando "el tiempo pasó y el joven cumplió 18" sin depender
 * de que la suite se ejecute justo el día de un cumpleaños real — usado
 * para probar que `confirmGuardianLink` vuelve a comprobar la edad en el
 * momento de confirmar, no solo en el momento de solicitar el vínculo.
 */
export async function setAccountDateOfBirthForTesting(accountId: string, dateOfBirth: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query('update client_accounts set date_of_birth = $2 where id = $1', [accountId, dateOfBirth])
  })
}

export async function getGuardianLinkStatus(linkId: string): Promise<string | null> {
  return withAuthDb(async (client) => {
    const result = await client.query('select status from guardian_links where id = $1', [linkId])
    return (result.rows[0] as { status: string } | undefined)?.status ?? null
  })
}

/**
 * Solo para pruebas: fuerza el estado de una cuenta directamente en la
 * base efímera, sin pasar por ninguna transición de la aplicación —
 * simula "el estado cambió mientras tanto" (suspensión, eliminación) para
 * probar que las revalidaciones bajo bloqueo (guardian.ts, repository.ts)
 * usan datos frescos y nunca la instantánea leída antes de una transacción.
 */
export async function setAccountStatusForTesting(accountId: string, status: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query('update client_accounts set status = $2 where id = $1', [accountId, status])
  })
}

/**
 * Solo para pruebas: desincroniza a mano el `otp_challenge_id` de la
 * solicitud de verificación de correo `pending` de una cuenta, simulando
 * que el reto vigente en Redis pertenece a una solicitud distinta de la
 * fila que se está intentando completar — usado para probar que
 * `completeEmailVerification` nunca marca "cualquier solicitud pendiente",
 * solo la atada al `challengeId` exacto que se validó.
 */
export async function setEmailVerificationRequestChallengeIdForTesting(
  accountId: string,
  otpChallengeId: string,
): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query(
      "update email_verification_requests set otp_challenge_id = $2 where account_id = $1 and status = 'pending'",
      [accountId, otpChallengeId],
    )
  })
}

export async function getEmailVerificationRequestStatus(accountId: string): Promise<string | null> {
  return withAuthDb(async (client) => {
    const result = await client.query(
      "select status from email_verification_requests where account_id = $1 order by created_at desc limit 1",
      [accountId],
    )
    return (result.rows[0] as { status: string } | undefined)?.status ?? null
  })
}

/**
 * Solo para pruebas: reproduce a mano el estado heredado e inconsistente
 * que podía dejar la versión de dos transacciones separadas de
 * independencia — `independence_requests.status = 'confirmed'` sin que
 * `client_accounts.independence_status` llegara nunca a `granted` — para
 * probar que `completeIndependenceRequest` lo reconcilia de forma segura
 * en vez de quedarse bloqueado esperando una solicitud que ya nunca volverá
 * a estar `pending`.
 */
export async function setIndependenceRequestStatusForTesting(requestId: string, status: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query('update independence_requests set status = $2 where id = $1', [requestId, status])
  })
}

export async function getIndependenceRequestStatus(requestId: string): Promise<string | null> {
  return withAuthDb(async (client) => {
    const result = await client.query('select status from independence_requests where id = $1', [requestId])
    return (result.rows[0] as { status: string } | undefined)?.status ?? null
  })
}

export async function getIndependenceRequestOtpChallengeId(requestId: string): Promise<string | null> {
  return withAuthDb(async (client) => {
    const result = await client.query('select otp_challenge_id from independence_requests where id = $1', [requestId])
    return (result.rows[0] as { otp_challenge_id: string } | undefined)?.otp_challenge_id ?? null
  })
}

export async function findGuardianLinkRow(
  guardianAccountId: string,
  minorAccountId: string,
): Promise<Record<string, unknown> | null> {
  return withAuthDb(async (client) => {
    const result = await client.query(
      'select * from guardian_links where guardian_account_id = $1 and minor_account_id = $2 order by created_at desc limit 1',
      [guardianAccountId, minorAccountId],
    )
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

// ---------------------------------------------------------------------------
// Inyección de fallos — revisión 4 de Fase 3, pruebas de atomicidad
// auditoría+negocio (§4 del encargo: "pruebas de integración con fallos
// inyectados... comprueba también la base Postgres real después de cada
// fallo"). El servidor de pruebas es un proceso `next dev` aparte (spawn en
// global-setup.ts) — no comparte memoria con este proceso de vitest, así
// que no se puede monkeypatchear ningún módulo de `server/auth/*` desde
// aquí (además, esos módulos llevan `import 'server-only'`, que lanza si se
// importan fuera del bundler de Next). La única superficie real y
// determinista para forzar un fallo dentro de una transacción que el
// servidor sí ejecuta es la propia base de datos: un trigger que hace
// fallar el `INSERT`/`UPDATE` exacto que la transacción intenta escribir,
// activado/desactivado por fila marcadora — nunca `DROP`/`REVOKE`
// permanentes que pudieran filtrarse a otra prueba si algo falla a mitad.
// ---------------------------------------------------------------------------

/**
 * Crea (si no existen) la tabla marcadora y el trigger que hacen fallar
 * cualquier `INSERT` en `auth_audit_log` cuyo `entity_id` esté en la tabla
 * marcadora — usado para simular "la auditoría falla dentro de la
 * transacción de negocio" y comprobar que esta última también se revierte.
 * Idempotente: puede llamarse al principio de cada test que la necesite.
 */
export async function installAuditFailureInjection(): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query(`
      create table if not exists _test_fail_audit_targets (entity_id text primary key);

      create or replace function _test_fail_audit_insert() returns trigger as $$
      begin
        if exists (select 1 from _test_fail_audit_targets where entity_id = new.entity_id) then
          raise exception 'injected_test_audit_failure';
        end if;
        return new;
      end;
      $$ language plpgsql;

      drop trigger if exists _test_fail_audit_trigger on auth_audit_log;
      create trigger _test_fail_audit_trigger
        before insert on auth_audit_log
        for each row execute function _test_fail_audit_insert();
    `)
  })
}

/** Arma el fallo: la próxima vez (y cada vez) que algo intente insertar en `auth_audit_log` con este `entityId`, la sentencia lanza y revierte su transacción. */
export async function enableAuditFailureFor(entityId: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query('insert into _test_fail_audit_targets (entity_id) values ($1) on conflict do nothing', [
      entityId,
    ])
  })
}

/** Desarma el fallo para `entityId` — siempre en un `finally` del test que lo arma, para no filtrarlo a otras pruebas del mismo archivo. */
export async function disableAuditFailureFor(entityId: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query('delete from _test_fail_audit_targets where entity_id = $1', [entityId])
  })
}

/**
 * Mismo mecanismo que `installAuditFailureInjection`, para `outbox_jobs`:
 * hace fallar cualquier `UPDATE` sobre una fila cuyo `account_id` esté en
 * la tabla marcadora — usado para simular "el procesamiento del job de
 * outbox falla después del commit de la activación" y comprobar que el job
 * queda `pending`/reintentable, nunca `completed` a medias.
 */
export async function installOutboxFailureInjection(): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query(`
      create table if not exists _test_fail_outbox_targets (account_id uuid primary key);

      create or replace function _test_fail_outbox_update() returns trigger as $$
      begin
        if exists (select 1 from _test_fail_outbox_targets where account_id = new.account_id) then
          raise exception 'injected_test_outbox_failure';
        end if;
        return new;
      end;
      $$ language plpgsql;

      drop trigger if exists _test_fail_outbox_trigger on outbox_jobs;
      create trigger _test_fail_outbox_trigger
        before update on outbox_jobs
        for each row execute function _test_fail_outbox_update();
    `)
  })
}

export async function enableOutboxFailureFor(accountId: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query('insert into _test_fail_outbox_targets (account_id) values ($1) on conflict do nothing', [
      accountId,
    ])
  })
}

export async function disableOutboxFailureFor(accountId: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query('delete from _test_fail_outbox_targets where account_id = $1', [accountId])
  })
}

export async function findOutboxJobsForAccount(
  accountId: string,
  jobType = 'evaluate_espo_link',
): Promise<Record<string, unknown>[]> {
  return withAuthDb(async (client) => {
    const result = await client.query(
      'select * from outbox_jobs where account_id = $1 and job_type = $2 order by created_at',
      [accountId, jobType],
    )
    return result.rows as Record<string, unknown>[]
  })
}

// ---------------------------------------------------------------------------
// Inyección de fallos — revisión 5 de Fase 3. Mismo mecanismo (trigger +
// tabla marcadora) que installAuditFailureInjection/installOutboxFailureInjection
// de arriba, aplicado a `sessions`: hace fallar cualquier `UPDATE` sobre una
// fila cuyo `id` esté en la tabla marcadora — usado para simular "la
// revocación de ESTA sesión concreta falla dentro de la transacción mayor"
// (restablecimiento de contraseña, eliminación de cuenta) y comprobar que
// esa transacción entera revierte, no solo la sesión objetivo. Para "falla
// la auditoría de una sesión concreta" se reutiliza
// `enableAuditFailureFor(sessionId)` (ya genérico por `entity_id`, y las
// filas de auditoría de `Session` usan el id de la propia sesión como
// `entity_id`) — no hace falta ningún mecanismo nuevo para ese caso.
// ---------------------------------------------------------------------------

export async function installSessionRevocationFailureInjection(): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query(`
      create table if not exists _test_fail_session_revocation_targets (session_id uuid primary key);

      create or replace function _test_fail_session_revocation_update() returns trigger as $$
      begin
        if exists (select 1 from _test_fail_session_revocation_targets where session_id = new.id) then
          raise exception 'injected_test_session_revocation_failure';
        end if;
        return new;
      end;
      $$ language plpgsql;

      drop trigger if exists _test_fail_session_revocation_trigger on sessions;
      create trigger _test_fail_session_revocation_trigger
        before update on sessions
        for each row execute function _test_fail_session_revocation_update();
    `)
  })
}

/** Arma el fallo: el próximo `UPDATE` (y cada uno posterior) sobre la sesión `sessionId` lanza y revierte su transacción. */
export async function enableSessionRevocationFailureFor(sessionId: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query(
      'insert into _test_fail_session_revocation_targets (session_id) values ($1) on conflict do nothing',
      [sessionId],
    )
  })
}

/** Desarma el fallo para `sessionId` — siempre en un `finally` del test que lo arma. */
export async function disableSessionRevocationFailureFor(sessionId: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query('delete from _test_fail_session_revocation_targets where session_id = $1', [sessionId])
  })
}

export async function findSessionRowsForAccount(accountId: string): Promise<Record<string, unknown>[]> {
  return withAuthDb(async (client) => {
    const result = await client.query('select * from sessions where account_id = $1 order by created_at', [
      accountId,
    ])
    return result.rows as Record<string, unknown>[]
  })
}

export async function findCredentialRowForAccount(accountId: string): Promise<Record<string, unknown> | null> {
  return withAuthDb(async (client) => {
    const result = await client.query(
      "select * from credentials where account_id = $1 and type = 'password'",
      [accountId],
    )
    return (result.rows[0] as Record<string, unknown>) ?? null
  })
}

export async function getLatestPasswordResetRequestStatus(accountId: string): Promise<string | null> {
  return withAuthDb(async (client) => {
    const result = await client.query(
      'select status from password_reset_requests where account_id = $1 order by created_at desc limit 1',
      [accountId],
    )
    return (result.rows[0] as { status: string } | undefined)?.status ?? null
  })
}

/**
 * Solo para pruebas: desincroniza a mano el `otp_challenge_id` de la
 * solicitud de recuperación `pending` de una cuenta, simulando el mismo
 * hueco que `setEmailVerificationRequestChallengeIdForTesting` cubre para
 * verificación de correo — pero aquí también reproduce el escenario real
 * que motiva `'request_not_found'` en `completePasswordReset`: un `OtpChallenge`
 * válido en Redis (`requestOtp` completó) sin la fila `password_reset_requests`
 * correspondiente en Postgres (p. ej. el proceso cayó entre
 * `requestOtp` y `replacePendingPasswordResetRequest`, o — como aquí — la
 * fila que existe está atada a otro reto). En ambos casos
 * `completePasswordReset` no encuentra `accountId + otpChallengeId` y debe
 * devolver `'request_not_found'` sin rotar la credencial.
 */
export async function setPasswordResetRequestChallengeIdForTesting(
  accountId: string,
  otpChallengeId: string,
): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query(
      "update password_reset_requests set otp_challenge_id = $2 where account_id = $1 and status = 'pending'",
      [accountId, otpChallengeId],
    )
  })
}

/**
 * Solo para pruebas: borra la credencial de contraseña de una cuenta,
 * reproduciendo el estado inconsistente ("cuenta activa sin credencial")
 * que `completePasswordReset` comprueba de forma defensiva
 * (`'credential_missing'`) — nunca debería darse por construcción
 * (`createAccountWithPasswordCredential` crea ambas en la misma
 * transacción), pero la comprobación existe para no consumir la solicitud
 * de recuperación ni responder éxito si, por cualquier motivo, no hay
 * ninguna fila de credencial que rotar.
 */
export async function deleteCredentialForTesting(accountId: string): Promise<void> {
  await withAuthDb(async (client) => {
    await client.query("delete from credentials where account_id = $1 and type = 'password'", [accountId])
  })
}
