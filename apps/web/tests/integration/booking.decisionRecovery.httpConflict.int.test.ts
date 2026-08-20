import { randomUUID } from 'node:crypto'

import { buildApprovalExpiryOperationKey } from '@gapssa/contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createPendingApprovalBookingRequestForTesting, findBookingRequestRow } from './bookingDb'

import type { EspoBookingAdapter } from '../../src/server/booking/espoAdapter'

/**
 * Corrección de puerta 4, bloqueo de concurrencia — el caso documentado en
 * `docs/fase4b-decision-flow-final.md` §5/§10: dos decisiones HUMANAS
 * distintas compitiendo por el mismo `bookingRequestId` contra el
 * adaptador HTTP real hacían que `HttpEspoBookingAdapter.putDecide` (`PutDecide`,
 * 409 `idempotency_key_reused`) se propagara sin capturar, produciendo un
 * 500 evitable en vez de una reconciliación limpia.
 *
 * Nunca reproducible contra `SimulatedEspoBookingAdapter` (el CAS de
 * Postgres decide el ganador sin mirar `operationKey`, ver la nota del
 * propio `decisionRecovery.ts`) — por eso este fichero, a diferencia de
 * `booking.decisionRecovery.int.test.ts`, construye `HttpEspoBookingAdapter`
 * directamente contra `FakeEspoServer` (réplica fiel del wire format real
 * de `PutDecide`, incluido el cuerpo de texto plano — no JSON — del 409
 * `idempotency_key_reused`) en vez de pasar por el endpoint
 * `/internal/decisions` del servidor de pruebas (que solo conoce el
 * adaptador simulado — `ESPO_BOOKING_ADAPTER` nunca se activa en `http`
 * para ningún entorno compartido, encargo explícito).
 *
 * `server-only` y `./db/client` se mockean igual que
 * `booking.simulatedEspoAdapter.contract.int.test.ts` (única forma segura
 * de importar código de servidor en el propio proceso de Vitest sin
 * arriesgar tocar el `gapssa_booking` real de desarrollo — `bookingDb` se
 * redirige explícitamente a `gapssa_booking_test_<random>`, la misma base
 * efímera que ya usa el resto de la suite de integración).
 */

vi.mock('server-only', () => ({}))

vi.mock('../../src/server/booking/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { Pool } = await import('pg')
  const schema = await import('../../src/server/booking/db/schema')
  const { inject } = await import('vitest')
  const pool = new Pool({ connectionString: inject('integrationBookingDatabaseUrl') })
  return { bookingDb: drizzle(pool, { schema }) }
})

const { applyOrAdoptBookingDecision } = await import('../../src/server/booking/decisionRecovery')
const { HttpEspoBookingAdapter, EspoApiError } = await import('../../src/server/booking/httpEspoAdapter')
const { FakeEspoServer } = await import('../contract/fakeEspoServer')
const { SimulatedEspoBookingAdapter } = await import('../../src/server/booking/espoAdapter')

function httpAdapterConfig(server: InstanceType<typeof FakeEspoServer>) {
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    apiKey: server.apiKey,
    timeoutMs: 2000,
    maxRetries: 0,
    retryBaseDelayMs: 10,
    maxResponseBytes: 1_000_000,
    professionalUserIds: [],
  }
}

/**
 * Adaptador mínimo, deliberadamente NO instancia de `SimulatedEspoBookingAdapter`
 * (`decisionRecovery.ts` lo enruta por su rama "adaptador real" con
 * cualquier objeto que no lo sea) — implementa solo lo que
 * `applyOrAdoptBookingDecision` toca. Nunca real, nunca red: usado para
 * forzar deterministamente ramas difíciles de reproducir con temporización
 * real (fallo de red durante la relectura, error desconocido propagado).
 */
function stubAdapter(overrides: Partial<EspoBookingAdapter>): EspoBookingAdapter {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop in overrides) {
          return (overrides as Record<string, unknown>)[prop]
        }
        return () => {
          throw new Error(`stubAdapter: '${prop}' no implementado — esta prueba no debería alcanzarlo.`)
        }
      },
    },
  ) as EspoBookingAdapter
}

describe('applyOrAdoptBookingDecision — adaptador HTTP real (FakeEspoServer): concurrencia genuina de dos decisiones humanas', () => {
  let server: InstanceType<typeof FakeEspoServer>

  beforeAll(async () => {
    server = new FakeEspoServer()
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('approve vs. reject concurrentes: exactamente uno se aplica, el otro recibe decision_conflict — nunca un 500 por idempotency_key_reused sin capturar', async () => {
    const meetingId = randomUUID()
    server.meetings.push({ id: meetingId, dateStart: '2026-09-01T09:00:00.000Z', dateEnd: '2026-09-01T10:00:00.000Z', status: 'Planned', cEstadoReserva: 'PendingCenterApproval' })
    const requestId = await createPendingApprovalBookingRequestForTesting({ meetingId })
    const adapter = new HttpEspoBookingAdapter(httpAdapterConfig(server))

    const [approve, reject] = await Promise.all([
      applyOrAdoptBookingDecision(adapter, { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() }),
      applyOrAdoptBookingDecision(adapter, {
        meetingId,
        decision: 'rejected',
        decidedBy: 'staff-b',
        note: 'no compatible con la agenda',
        idempotencyKey: randomUUID(),
      }),
    ])

    // Ninguna de las dos llamadas debe haber lanzado (Promise.all ya lo
    // garantiza al llegar aquí) — el punto central de esta prueba es que
    // NINGUNA se traduce en una excepción no capturada / 500.
    const outcomes = [approve.outcome, reject.outcome].sort()
    expect(outcomes).toEqual(['applied', 'conflict'])

    const winnerIsApprove = approve.outcome === 'applied'
    const loser = winnerIsApprove ? reject : approve
    if (loser.outcome !== 'conflict') throw new Error('el perdedor debía ser conflict')
    expect(loser.existingCEstadoReserva).toBe(winnerIsApprove ? 'Confirmed' : 'Canceled')

    const record = await findBookingRequestRow(requestId)
    expect(record).toMatchObject({ status: 'resolved', resolution: winnerIsApprove ? 'confirmed' : 'rejected' })
  })

  // Nota: "dos bookingRequestId distintos comparten la misma
  // decisionOperationKey" NO es reproducible a este nivel (adaptador HTTP
  // real + Postgres real) — `booking_request_records_decision_operation_key_key`
  // (índice único parcial, `db/schema.ts`) hace que la SEGUNDA fila que
  // intente adoptar una clave ya usada por otra falle en
  // `ensureDecisionOperationKey` con una violación de restricción, antes
  // siquiera de llamar al adaptador; nunca llega a `PutDecide`. El caso
  // "el Meeting releído sigue PendingCenterApproval tras un
  // idempotency_key_reused" (que SÍ debe tratarse como `inconsistent`, no
  // como éxito) se prueba de forma determinista con el adaptador stub más
  // abajo — a este nivel (Postgres real) esa combinación de estado exige
  // datos ya corruptos de antemano, no algo que esta función pueda producir
  // por sí sola en una carrera legítima.

  it('un rechazo humano tardío contra un Meeting que la caducidad de sistema ya decidió (secuencial, vía el mismo adaptador HTTP): conflict, nunca sobrescribe', async () => {
    const meetingId = randomUUID()
    server.meetings.push({ id: meetingId, dateStart: '2026-09-04T09:00:00.000Z', dateEnd: '2026-09-04T10:00:00.000Z', status: 'Planned', cEstadoReserva: 'PendingCenterApproval' })
    const requestId = await createPendingApprovalBookingRequestForTesting({ meetingId })
    const adapter = new HttpEspoBookingAdapter(httpAdapterConfig(server))

    // La caducidad de sistema (reconciliation.ts::sweepExpiredApprovals) no
    // pasa por applyOrAdoptBookingDecision — llama a expireMeeting()
    // directamente, con su propia operationKey determinista. La
    // reproducimos aquí llamando al mismo método que usaría ese barrido.
    const expired = await adapter.expireMeeting({ meetingId, operationKey: buildApprovalExpiryOperationKey(requestId) })
    expect(expired?.cEstadoReserva).toBe('Canceled')
    expect(expired?.resolutionReason).toBe('ApprovalExpired')

    const late = await applyOrAdoptBookingDecision(adapter, {
      meetingId,
      decision: 'rejected',
      decidedBy: 'staff-late',
      note: 'intento de rechazo tardío',
      idempotencyKey: randomUUID(),
    })
    expect(late.outcome).toBe('conflict')
    if (late.outcome !== 'conflict') throw new Error('unreachable')
    expect(late.existingCEstadoReserva).toBe('Canceled')

    const record = await findBookingRequestRow(requestId)
    // Nunca resuelta por esta vía — la caducidad de sistema, no esta
    // llamada, es quien debe adoptarla (reconciliation.ts, fuera de alcance
    // de este fichero).
    expect((record as { status: string }).status).toBe('pending_approval')
  })
})

describe('applyOrAdoptBookingDecision — adaptador stub: ramas deterministas del catch de idempotency_key_reused', () => {
  it('409 idempotency_key_reused conocido, relectura compatible -> applied (nunca un 500)', async () => {
    const meetingId = randomUUID()
    const requestId = await createPendingApprovalBookingRequestForTesting({ meetingId })
    let calls = 0
    const adapter = stubAdapter({
      decideMeeting: async () => {
        calls += 1
        throw new EspoApiError('EspoCRM respondió 409.', 'corr-1', 409, 'idempotency_key_reused')
      },
      getMeetingById: async () => ({
        id: meetingId,
        contactIds: [],
        bookingRequestId: requestId,
        treatmentId: 't',
        professionalId: 'p',
        zoneId: 'z',
        startAt: new Date(),
        endAt: new Date(),
        cEstadoReserva: 'Confirmed',
        status: 'Planned',
        decidedBy: 'staff-other',
        decidedAt: new Date(),
        note: null,
        resolutionReason: 'Approved',
        cExcluirGoogleCalendarSync: false,
      }),
    })

    const result = await applyOrAdoptBookingDecision(adapter, { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() })
    expect(result.outcome).toBe('applied')
    expect(calls).toBe(1)
  })

  it('409 idempotency_key_reused conocido, relectura con combinación cEstadoReserva/resolutionReason incoherente -> inconsistent, nunca éxito inventado', async () => {
    const meetingId = randomUUID()
    const requestId = await createPendingApprovalBookingRequestForTesting({ meetingId })
    const adapter = stubAdapter({
      decideMeeting: async () => {
        throw new EspoApiError('EspoCRM respondió 409.', 'corr-2', 409, 'idempotency_key_reused')
      },
      getMeetingById: async () => ({
        id: meetingId,
        contactIds: [],
        bookingRequestId: requestId,
        treatmentId: 't',
        professionalId: 'p',
        zoneId: 'z',
        startAt: new Date(),
        endAt: new Date(),
        // Combinación incoherente: Confirmed nunca debería tener
        // resolutionReason null (dato heredado/corrupto) — `deriveResolutionFromDecidedMeeting`
        // devuelve null a propósito, nunca adivina.
        cEstadoReserva: 'Confirmed',
        status: 'Planned',
        decidedBy: 'staff-other',
        decidedAt: new Date(),
        note: null,
        resolutionReason: null,
        cExcluirGoogleCalendarSync: false,
      }),
    })

    const result = await applyOrAdoptBookingDecision(adapter, { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() })
    expect(result.outcome).toBe('inconsistent')
  })

  it('409 idempotency_key_reused conocido, pero el Meeting sigue PendingCenterApproval en la relectura -> inconsistent, nunca éxito inventado', async () => {
    const meetingId = randomUUID()
    const requestId = await createPendingApprovalBookingRequestForTesting({ meetingId })
    const adapter = stubAdapter({
      decideMeeting: async () => {
        throw new EspoApiError('EspoCRM respondió 409.', 'corr-2b', 409, 'idempotency_key_reused')
      },
      getMeetingById: async () => ({
        id: meetingId,
        contactIds: [],
        bookingRequestId: requestId,
        treatmentId: 't',
        professionalId: 'p',
        zoneId: 'z',
        startAt: new Date(),
        endAt: new Date(),
        cEstadoReserva: 'PendingCenterApproval',
        status: 'Planned',
        decidedBy: null,
        decidedAt: null,
        note: null,
        resolutionReason: null,
        cExcluirGoogleCalendarSync: false,
      }),
    })

    const result = await applyOrAdoptBookingDecision(adapter, { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() })
    expect(result.outcome).toBe('inconsistent')
    if (result.outcome !== 'inconsistent') throw new Error('unreachable')
    expect(result.cEstadoReserva).toBe('PendingCenterApproval')
  })

  it('409 idempotency_key_reused conocido, pero la relectura falla por red -> el fallo de red se propaga, nunca se convierte en éxito ni en conflict', async () => {
    const meetingId = randomUUID()
    await createPendingApprovalBookingRequestForTesting({ meetingId })
    const adapter = stubAdapter({
      decideMeeting: async () => {
        throw new EspoApiError('EspoCRM respondió 409.', 'corr-3', 409, 'idempotency_key_reused')
      },
      getMeetingById: async () => {
        throw new EspoApiError('Fallo de red o timeout en GET /api/v1/Meeting/x.', 'corr-4')
      },
    })

    await expect(
      applyOrAdoptBookingDecision(adapter, { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ correlationId: 'corr-4' })
  })

  it('decideMeeting lanza un 500 desconocido -> se propaga tal cual, nunca se trata como conflicto reconciliable', async () => {
    const meetingId = randomUUID()
    await createPendingApprovalBookingRequestForTesting({ meetingId })
    const adapter = stubAdapter({
      decideMeeting: async () => {
        throw new EspoApiError('EspoCRM respondió 500.', 'corr-5', 500)
      },
    })

    await expect(
      applyOrAdoptBookingDecision(adapter, { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 500 })
  })

  it('decideMeeting lanza un 401 -> se propaga tal cual, nunca se trata como conflicto reconciliable', async () => {
    const meetingId = randomUUID()
    await createPendingApprovalBookingRequestForTesting({ meetingId })
    const adapter = stubAdapter({
      decideMeeting: async () => {
        throw new EspoApiError('Credencial inválida.', 'corr-6', 401)
      },
    })

    await expect(
      applyOrAdoptBookingDecision(adapter, { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('un 409 distinto (cuerpo JSON ajeno, no idempotency_key_reused) nunca se confunde con el código contractual conocido -> se propaga', async () => {
    const meetingId = randomUUID()
    await createPendingApprovalBookingRequestForTesting({ meetingId })
    const adapter = stubAdapter({
      decideMeeting: async () => {
        throw new EspoApiError('EspoCRM respondió 409.', 'corr-7', 409, { status: 'conflict', reason: 'algo_completamente_distinto' })
      },
    })

    await expect(
      applyOrAdoptBookingDecision(adapter, { meetingId, decision: 'approved', decidedBy: 'staff-a', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409, correlationId: 'corr-7' })
  })

  it('nunca instancia SimulatedEspoBookingAdapter por accidente al construir el stub (control de la propia prueba)', () => {
    const adapter = stubAdapter({})
    expect(adapter instanceof SimulatedEspoBookingAdapter).toBe(false)
  })
})
