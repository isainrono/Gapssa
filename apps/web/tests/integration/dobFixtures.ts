/**
 * Fechas de nacimiento coherentes para las pruebas de integración de
 * tutor–menor/independencia — calculadas relativas al reloj real en el
 * momento de ejecutar la suite (nunca fechas fijas de calendario, que se
 * habrían quedado "adultas" u "obsoletas" según cuándo se ejecute la
 * prueba). Revisión 2 de Fase 3: la revisión anterior usaba `ADULT_DOB`
 * para las cuentas etiquetadas como "menor", así que ninguna prueba
 * ejercitaba de verdad la validación de edad.
 */

function isoDateYearsAgo(years: number, extraDays = 0): string {
  const now = new Date()
  const date = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - extraDays))
  return date.toISOString().slice(0, 10)
}

/** Claramente adulta (30 años) — nunca cerca del límite. */
export const ADULT_DOB = isoDateYearsAgo(30)

/** Claramente menor (10 años) — nunca cerca del límite. */
export const MINOR_DOB = isoDateYearsAgo(10)

/** Cumplió 18 hace una semana — adulta, pero cerca del límite (para probar el borde sin acercarse a un cumpleaños real durante la ejecución). */
export const RECENTLY_ADULT_DOB = isoDateYearsAgo(18, 7)

/** Menor a punto de cumplir 18 (dentro de una semana) — sigue siendo menor en el momento de la prueba. */
export const ALMOST_ADULT_MINOR_DOB = isoDateYearsAgo(18, -7)
