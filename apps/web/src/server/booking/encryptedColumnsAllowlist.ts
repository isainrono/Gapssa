import 'server-only'
import { sql } from 'drizzle-orm'

import type { BookingDbClient } from './db/client'

/**
 * Lista cerrada de tablas/campos cifrados con AES-256-GCM
 * (`server/crypto/fieldCrypto.ts`, columnas `<campo>_ciphertext`/
 * `<campo>_nonce`/`<campo>_key_version`) — punto 6 de la revisión: un
 * análisis de nombres de columna por sí solo puede dar falsa seguridad
 * ("no hay más columnas que las que ya conocíamos" puede estar
 * simplemente desactualizado). `verifyNoUnlistedEncryptedColumns` compara
 * esta lista contra el esquema REAL de Postgres (`information_schema`),
 * nunca contra una suposición — si aparece una columna `*_ciphertext`
 * nueva no listada aquí, la comprobación falla hasta que se actualice
 * esta lista a propósito.
 */
export const ENCRYPTED_COLUMNS_ALLOWLIST: ReadonlyArray<{ table: string; fields: readonly string[] }> = [
  { table: 'pending_guest_identities', fields: ['first_name', 'last_name', 'email', 'phone'] },
  { table: 'pending_authenticated_contact_details', fields: ['first_name', 'last_name', 'phone'] },
]

export interface EncryptedColumnsAuditResult {
  ok: boolean
  /** Pares tabla/campo con columna `*_ciphertext` real en Postgres que NO están en el allowlist. */
  unlisted: Array<{ table: string; field: string }>
  /** Pares tabla/campo del allowlist cuya columna `*_ciphertext` YA NO existe en Postgres (allowlist desactualizado en la otra dirección — también se reporta, nunca se ignora). */
  missing: Array<{ table: string; field: string }>
}

/**
 * Audita el esquema REAL del Postgres conectado (`information_schema.columns`,
 * esquema `public`) — nunca una suposición sobre `db/schema.ts`. Solo
 * busca columnas `%_ciphertext` (patrón inequívoco: ninguna otra columna
 * de este dominio usa ese sufijo, a diferencia de `%_key_version`, que
 * también coincide con columnas de HMAC versionado como
 * `identity_fingerprint_key_version`/`access_token_key_version`/
 * `email_lookup_hmac_key_version` — esas NUNCA son AES, así que
 * filtrar por `_key_version` daría falsos positivos).
 */
export async function verifyNoUnlistedEncryptedColumns(db: BookingDbClient): Promise<EncryptedColumnsAuditResult> {
  const rows = (await db.execute(
    sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name like '%\\_ciphertext' escape '\\'`,
  )) as unknown as { rows: Array<{ table_name: string; column_name: string }> }

  const realPairs = new Set<string>()
  for (const row of rows.rows) {
    const field = row.column_name.replace(/_ciphertext$/, '')
    realPairs.add(`${row.table_name}::${field}`)
  }

  const allowedPairs = new Set<string>()
  for (const entry of ENCRYPTED_COLUMNS_ALLOWLIST) {
    for (const field of entry.fields) {
      allowedPairs.add(`${entry.table}::${field}`)
    }
  }

  const unlisted: Array<{ table: string; field: string }> = []
  for (const pair of realPairs) {
    if (!allowedPairs.has(pair)) {
      const [table, field] = pair.split('::') as [string, string]
      unlisted.push({ table, field })
    }
  }

  const missing: Array<{ table: string; field: string }> = []
  for (const pair of allowedPairs) {
    if (!realPairs.has(pair)) {
      const [table, field] = pair.split('::') as [string, string]
      missing.push({ table, field })
    }
  }

  return { ok: unlisted.length === 0 && missing.length === 0, unlisted, missing }
}
