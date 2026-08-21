// scripts/secrets-rotation/probes/s7TestFixtureReset.mts — Bloque 10.
//
// TRUNCATE de las 3 tablas de fixtures de booking, vía el MISMO cliente
// Drizzle real (bookingDb) que el resto de sondas de este bloque —
// nunca `docker run psql` por una red aparte cuyo resultado no se
// comprueba (bug real encontrado durante este mismo bloque: un TRUNCATE
// disparado así, si fallara, se descartaría en silencio y dejaría filas
// de un escenario anterior contaminando el siguiente).
//
// SOLO EJECUTABLE CONTRA UN PROYECTO DESECHABLE — misma guarda cerrada
// que el resto de sondas de este bloque.
//
// Uso: node --import tsx s7TestFixtureReset.mts   (sin stdin, imprime
// {"truncated":true} por stdout tras confirmar recuento cero).

import { sql } from 'drizzle-orm'

import { bookingDb } from '../../../apps/web/src/server/booking/db/client'
import { bookingRequestRecords, pendingGuestIdentities, pendingAuthenticatedContactDetails } from '../../../apps/web/src/server/booking/db/schema'
import { count } from 'drizzle-orm'

const DISPOSABLE_LABEL_PATTERN = /^gapssa-[a-z0-9]+(-[a-z0-9]+)*-(rehearsal|tests?)-[0-9a-f]{6,}$/

function assertDisposableContext(): void {
  const label = process.env.GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL
  if (!label || !DISPOSABLE_LABEL_PATTERN.test(label)) {
    console.error('ERROR: falta o no casa GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL — este reseteador de fixtures NUNCA se ejecuta sin esa guarda.')
    process.exit(1)
  }
}

async function main() {
  assertDisposableContext()
  await bookingDb.execute(sql`TRUNCATE TABLE pending_guest_identities, pending_authenticated_contact_details, booking_request_records CASCADE`)

  const [g] = await bookingDb.select({ value: count() }).from(pendingGuestIdentities)
  const [a] = await bookingDb.select({ value: count() }).from(pendingAuthenticatedContactDetails)
  const [b] = await bookingDb.select({ value: count() }).from(bookingRequestRecords)
  if ((g?.value ?? 0) !== 0 || (a?.value ?? 0) !== 0 || (b?.value ?? 0) !== 0) {
    console.error(`ERROR: el TRUNCATE no dejó las 3 tablas en cero (guest=${g?.value} authenticated=${a?.value} bookingRequests=${b?.value}) — abortado, NUNCA se sigue con un fixture contaminado.`)
    process.exit(1)
  }

  console.log(JSON.stringify({ truncated: true }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
