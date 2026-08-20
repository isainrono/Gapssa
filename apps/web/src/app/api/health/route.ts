import config from '@payload-config'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { pingRedis } from '@/server/redis'
import { withTimeout } from '@/server/withTimeout'

export const dynamic = 'force-dynamic'

const CHECK_TIMEOUT_MS = 3_000

/**
 * Health check de **disponibilidad (readiness)**: comprueba que la app y
 * sus dependencias directas (Postgres vía la API local de Payload, Redis)
 * pueden atender tráfico real. Para saber solo "¿el proceso sigue vivo?"
 * sin depender de nada externo, usar `/api/health/live` — separación
 * deliberada (una readiness caída no debe hacer que un orquestador mate el
 * proceso; una liveness caída sí).
 *
 * No comprueba EspoCRM ni FacturaScripts: todavía no hay integración real
 * con ellos (Fase 3/4). Nunca devuelve mensajes de error, nombres de host,
 * credenciales ni trazas — solo `"ok" | "error"` por dependencia.
 */
export async function GET() {
  const checks: Record<string, 'error' | 'ok'> = { app: 'ok' }
  let overallOk = true

  try {
    const payload = await getPayload({ config })
    await withTimeout(payload.count({ collection: 'users' }), CHECK_TIMEOUT_MS, 'postgresCms')
    checks['postgresCms'] = 'ok'
  } catch {
    checks['postgresCms'] = 'error'
    overallOk = false
  }

  try {
    const pong = await pingRedis(CHECK_TIMEOUT_MS)
    checks['redis'] = pong ? 'ok' : 'error'
    if (!pong) {
      overallOk = false
    }
  } catch {
    checks['redis'] = 'error'
    overallOk = false
  }

  return NextResponse.json(
    { checks, status: overallOk ? 'ok' : 'degraded' },
    {
      headers: { 'Cache-Control': 'no-store' },
      status: overallOk ? 200 : 503,
    },
  )
}
