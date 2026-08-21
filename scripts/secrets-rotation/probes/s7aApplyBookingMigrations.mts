// scripts/secrets-rotation/probes/s7aApplyBookingMigrations.mts
//
// Subpuerta S7A (rotate-all-interactive.sh::gate_s7a()) — aplica las
// migraciones PENDIENTES de `gapssa_booking` con el runner OFICIAL
// (drizzle-orm/node-postgres/migrator vía runBookingMigrations,
// apps/web/src/server/booking/db/migrate.ts — mismo código exacto que
// `npm run booking:db:migrate`, nunca reimplementado aquí). Aplica
// SIEMPRE la lista COMPLETA de migraciones de
// apps/web/drizzle/booking/migrations/ (el propio runner es incremental:
// una migración cuyo hash ya está en `drizzle.__drizzle_migrations` es
// un no-op, nunca se reaplica) — gate_s7a() ya comprobó ANTES, con
// probes/s7SchemaPreflight.mts, que hay algo pendiente; nunca se invoca
// este script si el esquema ya estaba al día.
//
// Drizzle envuelve TODAS las migraciones pendientes en una ÚNICA
// transacción (pg-core/dialect.js::migrate — session.transaction) — un
// fallo a mitad de un archivo NUNCA deja DDL a medias comprometido: la
// base queda EXACTAMENTE como antes de este intento, y basta con
// corregir el problema y volver a lanzar '--only S7A'. Nunca toca
// $SECRETS_FILE, nunca importa nada de server/booking/fieldEncryptionRotation.ts
// ni emailLookupHmacRotation.ts (cero recifrado/reindexado — eso es
// EXCLUSIVAMENTE gate_s7()).
//
// Contrato de stdout (schema "s7a-apply"): un único documento JSON.

import { assertRotationEnvironmentAllowed } from '../../../apps/web/src/server/booking/rotationSafetyChecks'
import { runBookingMigrations } from '../../../apps/web/src/server/booking/db/migrate'
import { serverEnv } from '../../../apps/web/src/server/env'

async function main() {
  assertRotationEnvironmentAllowed()
  await runBookingMigrations(serverEnv.DATABASE_URL_BOOKING)
  console.log(JSON.stringify({ applied: true }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
