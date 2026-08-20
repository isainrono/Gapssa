/**
 * Corrección de puerta 4, auditoría de migraciones — endurece exactamente
 * el mecanismo que falló en el incidente documentado en
 * `docs/fase4b-decision-flow-final.md` §7 (un `sed` mal escapado en un
 * script de verificación hizo que `booking:db:migrate` apuntara, sin
 * intención, al `gapssa_booking` real de desarrollo en vez de a una copia
 * efímera). Este guardia es la única puerta que
 * `tests/integration/global-setup.ts` usa antes de crear/migrar/destruir
 * cualquier base de la suite de integración — nunca vuelve a construirse
 * una URL "a mano" (ni con `sed`, ni con reemplazo de string libre) sin
 * pasar por aquí.
 *
 * Nunca se apoya en "empieza por gapssa_" (`gapssa_booking` también
 * empieza así) ni en "contiene la palabra test" (`gapssa_cms_debug_manual`
 * no la contiene pero tampoco es una base real con nombre exacto conocido,
 * así que el prefijo aprobado explícito la cubre igual) — exige un
 * PREFIJO EXACTO de una lista cerrada, generado siempre por
 * `generateTestDatabaseName()` (`global-setup.ts`), nunca inferido.
 */

const FORBIDDEN_EXACT_DATABASE_NAMES = new Set(['gapssa_booking', 'gapssa_auth', 'gapssa_cms'])

const APPROVED_EPHEMERAL_PREFIXES = ['gapssa_auth_test_', 'gapssa_cms_test_', 'gapssa_booking_test_'] as const

/**
 * Extrae el nombre de base de una URL de conexión Postgres válida — nunca
 * con `sed`/regex sobre el string crudo (esa fue la causa raíz del
 * incidente): `new URL()` es la única forma prevista de interpretar una
 * connection string en este repo (mismo patrón que `withDatabaseName()`,
 * `global-setup.ts`).
 */
function databaseNameFromConnectionString(connectionString: string): string {
  const url = new URL(connectionString)
  const name = url.pathname.replace(/^\//, '')
  if (name === '') {
    throw new Error(`URL de base de datos sin nombre de base: "${connectionString}".`)
  }
  return name
}

/**
 * Aborta (lanza) si `connectionString` apunta a una base real conocida por
 * nombre exacto, o si su nombre no lleva uno de los prefijos efímeros
 * aprobados. Nunca continúa "por si acaso" — cualquier duda es un abort,
 * nunca un best-effort.
 */
export function assertEphemeralTestDatabaseUrl(connectionString: string): void {
  const name = databaseNameFromConnectionString(connectionString)

  if (FORBIDDEN_EXACT_DATABASE_NAMES.has(name)) {
    throw new Error(
      `Guardia de base efímera: "${name}" es una base REAL (gapssa_booking/gapssa_auth/gapssa_cms) — ` +
        'abortado antes de crear, migrar o destruir nada. Nunca se opera sobre estas bases desde la suite de pruebas.',
    )
  }

  const hasApprovedPrefix = APPROVED_EPHEMERAL_PREFIXES.some((prefix) => name.startsWith(prefix) && name.length > prefix.length)
  if (!hasApprovedPrefix) {
    throw new Error(
      `Guardia de base efímera: "${name}" no lleva ninguno de los prefijos efímeros aprobados ` +
        `(${APPROVED_EPHEMERAL_PREFIXES.join(', ')}) — abortado antes de crear, migrar o destruir nada. ` +
        'Genera el nombre siempre con generateTestDatabaseName(), nunca a mano.',
    )
  }
}
