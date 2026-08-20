import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'

import type { OutboxJobErrorCode } from '@gapssa/contracts'

import { recordRawAuditEvent } from './audit'
import { authDb, type AuthTx } from './db/client'
import { clientAccounts, outboxJobs } from './db/schema'
import { decideEspoLinkAction, type EspoLinkAdapter } from './espoLink'

/**
 * Outbox mínimo (`packages/contracts/src/outbox.ts`) para trabajo posterior
 * a `pending_verification -> active` que no debe ejecutarse dentro de esa
 * transacción — hoy la evaluación de vinculación con EspoCRM (adaptador
 * simulado), documentada como futura integración externa real
 * (`docs/fase3-autenticacion.md` §6). `enqueueEvaluateEspoLinkJob` se llama
 * SIEMPRE desde dentro de la transacción que activa la cuenta
 * (`repository.ts`, `completeEmailVerification`) — el job y la activación
 * se confirman o se revierten juntos. `processEvaluateEspoLinkJobForAccount`
 * se invoca después, fuera de esa transacción (normalmente justo tras el
 * commit, en la propia ruta HTTP, con su propio try/catch — un fallo aquí
 * nunca debe hacer fallar la respuesta de verificación, que ya tuvo éxito).
 *
 * Recuperabilidad: si el proceso muere entre el commit de la activación y
 * el procesamiento del job, el job queda `pending` en Postgres — una
 * llamada posterior (esta misma función, invocada de nuevo con la misma
 * cuenta) lo retoma. Si el adaptador falla durante el procesamiento, el job
 * pasa a `failed_retryable` con `attempts`/`nextAttemptAt`/`lastErrorCode`
 * — nunca se pierde, nunca queda "a medias" (todo el trabajo de una
 * ejecución de `processEvaluateEspoLinkJobForAccount` vive en una única
 * transacción: o se marca `completed` junto con cualquier escritura de
 * negocio que le corresponda, o se marca `failed_retryable`, nunca ninguna
 * de las dos a medio camino).
 */

const OUTBOX_RETRY_BACKOFF_MINUTES = 5

export async function enqueueEvaluateEspoLinkJob(tx: AuthTx, accountId: string): Promise<void> {
  // Sin payload más allá de accountId+jobType a propósito ("payload mínimo
  // y sin PII innecesaria") — el correo de la cuenta se relee fresco desde
  // client_accounts en el momento de procesar, nunca se copia aquí.
  await tx.insert(outboxJobs).values({ jobType: 'evaluate_espo_link', accountId, status: 'pending' })
}

export type ProcessEvaluateEspoLinkJobOutcome = 'completed' | 'no_pending_job' | 'failed_retryable'

async function markJobFailedRetryable(
  tx: AuthTx,
  jobId: string,
  currentAttempts: number,
  errorCode: OutboxJobErrorCode,
  now: Date,
): Promise<void> {
  await tx
    .update(outboxJobs)
    .set({
      status: 'failed_retryable',
      attempts: currentAttempts + 1,
      lastErrorCode: errorCode,
      nextAttemptAt: new Date(now.getTime() + OUTBOX_RETRY_BACKOFF_MINUTES * 60_000),
      updatedAt: now,
    })
    .where(eq(outboxJobs.id, jobId))
}

/**
 * Procesa (si existe) el job `evaluate_espo_link` sin resolver de una
 * cuenta. Idempotente: si no queda ningún job `pending`/`failed_retryable`
 * para esa cuenta (ya se completó antes, o nunca se encoló), es un no-op
 * (`'no_pending_job'`) — nunca reevalúa ni reescribe una decisión ya
 * tomada. Bloquea el job y la cuenta (`FOR UPDATE`) dentro de una única
 * transacción: la llamada al adaptador (simulado, sin I/O real en esta
 * fase) y la escritura de su resultado se confirman o revierten juntas.
 */
export async function processEvaluateEspoLinkJobForAccount(
  adapter: EspoLinkAdapter,
  accountId: string,
  now: Date = new Date(),
): Promise<ProcessEvaluateEspoLinkJobOutcome> {
  return authDb.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(outboxJobs)
      .where(
        and(
          eq(outboxJobs.accountId, accountId),
          eq(outboxJobs.jobType, 'evaluate_espo_link'),
          inArray(outboxJobs.status, ['pending', 'failed_retryable']),
        ),
      )
      .limit(1)
      .for('update')

    if (!job) {
      return 'no_pending_job'
    }

    const [account] = await tx
      .select({ id: clientAccounts.id, email: clientAccounts.email, espoLinkStatus: clientAccounts.espoLinkStatus })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, accountId))
      .for('update')

    if (!account) {
      // No alcanzable en esta fase (no hay eliminación real de cuentas),
      // pero un job nunca debe quedar "colgado" si algún día lo fuera.
      await markJobFailedRetryable(tx, job.id, job.attempts, 'account_not_found', now)
      return 'failed_retryable'
    }

    let decision: ReturnType<typeof decideEspoLinkAction>
    try {
      const candidates = await adapter.searchCandidateContacts({ email: account.email })
      decision = decideEspoLinkAction(candidates)
    } catch {
      // Nunca se registra el mensaje de la excepción real (podría filtrar
      // detalles internos, o en una integración real futura, fragmentos de
      // una respuesta de EspoCRM) — solo el código cerrado.
      await markJobFailedRetryable(tx, job.id, job.attempts, 'espo_link_adapter_error', now)
      return 'failed_retryable'
    }

    if (decision.kind !== 'no_match') {
      const updated = await tx
        .update(clientAccounts)
        .set({ espoLinkStatus: 'pending_review', updatedAt: now })
        .where(and(eq(clientAccounts.id, accountId), eq(clientAccounts.espoLinkStatus, 'unlinked')))
        .returning({ id: clientAccounts.id })

      // Solo audita si de verdad transicionó — nunca "todavía pending_review
      // de un job anterior" ni ningún otro estado ya distinto de 'unlinked'.
      if (updated.length > 0) {
        await recordRawAuditEvent(
          {
            entity: 'ClientAccount',
            entityId: accountId,
            field: 'espoLinkStatus',
            previousValue: 'unlinked',
            newValue: 'pending_review',
            actor: { type: 'system', name: 'bff' },
            channel: 'web',
            occurredAt: now.toISOString(),
            reasonCode: 'EspoLinkProposed',
          },
          tx,
        )
      }
    }

    await tx
      .update(outboxJobs)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(eq(outboxJobs.id, job.id))

    return 'completed'
  })
}
