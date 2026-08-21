// scripts/secrets-rotation/probes/s7TestFixtureResolve.mts — Bloque 10.
//
// Marca UNA fila de `booking_request_records` como 'resolved' (mismo
// enum de producción, `packages/contracts/src/booking.ts::BOOKING_REQUEST_STATUSES`)
// — simula "la solicitud viva que mantenía bloqueada una retirada se
// resolvió/expiró", el único evento de negocio real que hace que
// `countLiveBookingRequestsReferencingFingerprintVersions`/
// `countLiveBookingRequestsReferencingAccessTokenVersions` dejen de
// contarla (ambas filtran `status <> 'resolved'`). Nunca toca ninguna
// columna de secretos/versión — solo `status`/`resolution`/`resolvedAt`.
//
// SOLO EJECUTABLE CONTRA UN PROYECTO DESECHABLE — misma guarda cerrada
// que el resto de sondas de este bloque.
//
// Uso: node --import tsx s7TestFixtureResolve.mts <bookingRequestId>

import { eq } from 'drizzle-orm'

import { bookingDb } from '../../../apps/web/src/server/booking/db/client'
import { bookingRequestRecords } from '../../../apps/web/src/server/booking/db/schema'

const DISPOSABLE_LABEL_PATTERN = /^gapssa-[a-z0-9]+(-[a-z0-9]+)*-(rehearsal|tests?)-[0-9a-f]{6,}$/

function assertDisposableContext(): void {
  const label = process.env.GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL
  if (!label || !DISPOSABLE_LABEL_PATTERN.test(label)) {
    console.error('ERROR: falta o no casa GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL — esta sonda NUNCA se ejecuta sin esa guarda.')
    process.exit(1)
  }
}

async function main() {
  assertDisposableContext()
  const [, , bookingRequestId] = process.argv
  if (!bookingRequestId) {
    console.error('Uso: s7TestFixtureResolve.mts <bookingRequestId>')
    process.exit(1)
  }
  const result = await bookingDb
    .update(bookingRequestRecords)
    .set({ status: 'resolved', resolution: 'confirmed', resolvedAt: new Date() })
    .where(eq(bookingRequestRecords.id, bookingRequestId))
    .returning({ id: bookingRequestRecords.id })

  console.log(JSON.stringify({ resolved: result.length === 1 }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
