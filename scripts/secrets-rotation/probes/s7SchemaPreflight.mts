// scripts/secrets-rotation/probes/s7SchemaPreflight.mts
//
// Preflight de SOLO LECTURA del esquema REAL de `gapssa_booking` — se
// ejecuta como el PRIMER paso de gate_s7() (rotate-all-interactive.sh),
// ANTES de cualquier mutación de $SECRETS_FILE (antes incluso de la
// migración legacy-pre-s7 -> active). Nunca asume que las migraciones de
// Drizzle (apps/web/drizzle/booking/migrations/) ya se aplicaron contra
// la base conectada — lo comprueba contra `information_schema` y contra
// la propia tabla de seguimiento de Drizzle
// (`drizzle.__drizzle_migrations`), nunca contra una suposición.
//
// Causa raíz del incidente real que motiva esta sonda (2026-08-21):
// gate_s7() generaba/activaba v3 en los 4 mapas versionados y SOLO
// ENTONCES lanzaba probes/s7MigrateAndAudit.mts, cuyo primer `SELECT`
// (dentro de una transacción, en fieldEncryptionRotation.ts) referenciaba
// la columna `email_lookup_hmac_key_version` de `pending_guest_identities`
// — añadida por la migración 0008, nunca aplicada contra la base real en
// ese momento. La transacción falló y se revirtió (cero escritura en
// Postgres), pero v3 YA era la versión activa en el almacén externo —
// gate_s7() debía haber comprobado el esquema ANTES de mutar nada.
//
// Nunca selecciona datos de negocio — únicamente metadatos
// (information_schema.columns/schemata, pg_enum/pg_type, y la tabla de
// control de migraciones, que solo contiene hash/timestamp, nunca
// contenido de negocio).
//
// Contrato de stdout (schema "s7-schema-preflight"): un único documento
// JSON, sin filtrado de línea final.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'

import { assertRotationEnvironmentAllowed } from '../../../apps/web/src/server/booking/rotationSafetyChecks'
import { bookingDb } from '../../../apps/web/src/server/booking/db/client'

const JOURNAL_PATH = fileURLToPath(
  new URL('../../../apps/web/drizzle/booking/migrations/meta/_journal.json', import.meta.url),
)

// Columnas/valores de enum introducidos por 0007/0008 (ver sus ficheros
// .sql bajo apps/web/drizzle/booking/migrations/) que
// probes/s7MigrateAndAudit.mts necesita para no fallar a mitad de una
// transacción real — comprobación EXPLÍCITA además del recuento de
// migraciones aplicadas (defensa en profundidad: un recuento correcto no
// demuestra por sí solo que la migración concreta que S7 necesita
// terminó de aplicarse con éxito).
const REQUIRED_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'pending_guest_identities', column: 'email_lookup_hmac_key_version' },
  { table: 'booking_request_records', column: 'access_token_key_version' },
]

const REQUIRED_ENUM_VALUES: ReadonlyArray<{ enumType: string; value: string }> = [
  { enumType: 'booking_audit_reason_code', value: 'MeetingGcsExclusionMismatch' },
  { enumType: 'booking_review_conflict_type', value: 'meeting_gcs_exclusion_mismatch' },
]

interface JournalEntry {
  tag: string
}

function readExpectedMigrationTags(): string[] {
  const raw = readFileSync(JOURNAL_PATH, 'utf8')
  const parsed = JSON.parse(raw) as { entries: JournalEntry[] }
  return parsed.entries.map((e) => e.tag)
}

async function appliedMigrationCount(): Promise<number> {
  const rows = (await bookingDb.execute(
    sql`select to_regclass('drizzle.__drizzle_migrations') as reg`,
  )) as unknown as { rows: Array<{ reg: string | null }> }
  if (!rows.rows[0]?.reg) {
    // El esquema/tabla de control de Drizzle ni siquiera existe todavía
    // — base sin ninguna migración de booking aplicada.
    return 0
  }
  const countRows = (await bookingDb.execute(
    sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
  )) as unknown as { rows: Array<{ n: number }> }
  return countRows.rows[0]?.n ?? 0
}

async function existingColumns(): Promise<Set<string>> {
  const rows = (await bookingDb.execute(
    sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  )) as unknown as { rows: Array<{ table_name: string; column_name: string }> }
  return new Set(rows.rows.map((r) => `${r.table_name}::${r.column_name}`))
}

async function existingEnumValues(): Promise<Set<string>> {
  const rows = (await bookingDb.execute(
    sql`select t.typname as enum_type, e.enumlabel as value from pg_enum e join pg_type t on t.oid = e.enumtypid`,
  )) as unknown as { rows: Array<{ enum_type: string; value: string }> }
  return new Set(rows.rows.map((r) => `${r.enum_type}::${r.value}`))
}

async function main() {
  assertRotationEnvironmentAllowed()

  const expectedTags = readExpectedMigrationTags()
  const applied = await appliedMigrationCount()
  const missingMigrationTags = applied < expectedTags.length ? expectedTags.slice(applied) : []

  const columns = await existingColumns()
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !columns.has(`${c.table}::${c.column}`)).map(
    (c) => `${c.table}.${c.column}`,
  )

  const enumValues = await existingEnumValues()
  const missingEnumValues = REQUIRED_ENUM_VALUES.filter(
    (e) => !enumValues.has(`${e.enumType}::${e.value}`),
  ).map((e) => `${e.enumType}.${e.value}`)

  const ready = missingMigrationTags.length === 0 && missingColumns.length === 0 && missingEnumValues.length === 0

  console.log(
    JSON.stringify({
      ready,
      appliedMigrations: applied,
      expectedMigrations: expectedTags.length,
      missingMigrationTags,
      missingColumns,
      missingEnumValues,
    }),
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
