import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Liveness: "¿el proceso Next.js sigue vivo y respondiendo?" — sin tocar
 * Postgres, Redis ni ninguna dependencia externa. Separado de
 * `/api/health` (readiness) a propósito: si Postgres o Redis caen, el
 * proceso de Next.js sigue vivo y no debería reiniciarse por eso; si este
 * endpoint no responde, sí.
 */
export function GET() {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}
