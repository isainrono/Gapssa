import { describe, expect, it } from 'vitest'

import { assertEphemeralTestDatabaseUrl } from './ephemeralDatabaseGuard'

/**
 * Corrección de puerta 4, auditoría de migraciones: prueba de guardia
 * dedicada — nunca debe ser posible ejecutar una validación destructiva o
 * un fresh-apply de migraciones contra `gapssa_booking`/`gapssa_auth`/
 * `gapssa_cms` reales, ni contra cualquier base sin el prefijo efímero
 * aprobado. `global-setup.ts` es el único llamante en producción de este
 * guardia (antes de crear/migrar/destruir cualquier base de la suite); este
 * fichero prueba la función en sí, aislada.
 */

describe('assertEphemeralTestDatabaseUrl', () => {
  it('rechaza gapssa_booking real', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_booking')).toThrow(/base REAL/)
  })

  it('rechaza gapssa_auth real', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_auth')).toThrow(/base REAL/)
  })

  it('rechaza gapssa_cms real', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_cms')).toThrow(/base REAL/)
  })

  it('rechaza una base sin ningún prefijo efímero aprobado, aunque contenga "test" en el nombre', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/some_test_db')).toThrow(/prefijos efímeros aprobados/)
  })

  it('rechaza un nombre de debug ajeno al patrón efímero (p. ej. una base manual de depuración)', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_cms_debug_manual')).toThrow(
      /prefijos efímeros aprobados/,
    )
  })

  it('rechaza el prefijo exacto sin sufijo aleatorio (nunca operar sobre el propio prefijo como si fuera una base concreta)', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_booking_test_')).toThrow(
      /prefijos efímeros aprobados/,
    )
  })

  it('acepta gapssa_booking_test_<hex> — el patrón real que genera generateTestDatabaseName()', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_booking_test_a1b2c3d4e5f6')).not.toThrow()
  })

  it('acepta gapssa_auth_test_<hex>', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_auth_test_a1b2c3d4e5f6')).not.toThrow()
  })

  it('acepta gapssa_cms_test_<hex>', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_cms_test_a1b2c3d4e5f6')).not.toThrow()
  })

  it('rechaza una URL sin nombre de base en absoluto', () => {
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/')).toThrow(/sin nombre de base/)
  })

  it('nunca usa un patrón "empieza por gapssa_" laxo: gapssa_booking (real) sigue rechazada aunque comparta prefijo textual con gapssa_booking_test_', () => {
    // Caso explícito, no solapado con los anteriores: demuestra que el
    // chequeo es por NOMBRE EXACTO en la lista prohibida, no por prefijo —
    // y que el nombre real no cuela por accidente en la lista de
    // aprobados (gapssa_booking_test_ requiere el sufijo "_test_").
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_booking')).toThrow()
    expect(() => assertEphemeralTestDatabaseUrl('postgresql://user:pass@localhost:5433/gapssa_booking_test_x')).not.toThrow()
  })
})
