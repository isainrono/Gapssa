import 'server-only'

/**
 * Aritmética de horario de apertura consciente de zona horaria, sin añadir
 * una dependencia nueva al proyecto (`date-fns`/`@date-fns/tz` solo están
 * en el lockfile como dependencia transitiva de otro paquete, nunca usados
 * en `apps/web` — no se adopta aquí como dependencia directa). Usa
 * `Intl.DateTimeFormat`, ya disponible en el runtime de Node, con la
 * técnica estándar de "adivinar en UTC, formatear en la zona, corregir la
 * diferencia" para convertir hora local -> instante UTC.
 *
 * `startAt`/`endAt` (packages/contracts/src/booking.ts) son siempre ISO
 * 8601 en UTC — este módulo es el único lugar de `server/booking` que
 * conoce la zona horaria real del centro (`BOOKING_TIME_ZONE`), para poder
 * calcular en qué instante UTC abre/cierra un día de apertura concreto.
 */

export const BOOKING_TIME_ZONE = 'Europe/Madrid'

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/**
 * Día de la semana (0=domingo..6=sábado) de la fecha calendario que
 * corresponde a `date` cuando se observa en `timeZone` — el día de la
 * semana de una fecha Y-M-D es el mismo en cualquier zona horaria, así que
 * basta con leer los componentes de calendario locales y aplicarlos sobre
 * una fecha UTC "sintética" para obtenerlo con `getUTCDay()`.
 */
export function getZonedWeekday(date: Date, timeZone: string = BOOKING_TIME_ZONE): number {
  const { year, month, day } = getZonedParts(date, timeZone)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function getZonedDateKey(date: Date, timeZone: string = BOOKING_TIME_ZONE): string {
  const { year, month, day } = getZonedParts(date, timeZone)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Convierte una hora de pared local (año/mes/día/hora/minuto, en
 * `timeZone`) al instante UTC correspondiente. Dos iteraciones de
 * corrección son suficientes para cualquier desfase horario real (máximo
 * ±14h) — no se intenta resolver el caso patológico de una hora local que
 * no existe o es ambigua por un cambio de DST, irrelevante para los límites
 * de apertura de este negocio (09:00/21:00, lejos de cualquier transición
 * de horario de verano en España).
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = BOOKING_TIME_ZONE,
): Date {
  // `targetAsUtcMs` es fijo: los números de pared deseados, reinterpretados
  // como si fueran UTC — el punto de referencia del que restar el desfase
  // real de la zona en cada iteración. CRÍTICO: cada iteración debe volver
  // a partir de este valor fijo, nunca del `guess` de la iteración
  // anterior — restar el desfase sobre el propio `guess` (en vez de sobre
  // el objetivo fijo) hace que la corrección se acumule dos veces y la
  // convergencia oscile en vez de estabilizarse (detectado con una prueba
  // real: para Europe/Madrid en horario de verano, producía 05:00 UTC en
  // vez de 07:00 UTC para las 09:00 locales).
  const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guessMs = targetAsUtcMs

  for (let i = 0; i < 2; i += 1) {
    const zoned = getZonedParts(new Date(guessMs), timeZone)
    const zonedAsUtcMs = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second)
    const offsetMs = zonedAsUtcMs - guessMs
    guessMs = targetAsUtcMs - offsetMs
  }

  return new Date(guessMs)
}

/** Parsea "HH:MM" (ya validado por server/env.ts) a {hour, minute}. */
export function parseHhMm(value: string): { hour: number; minute: number } {
  const [hourText, minuteText] = value.split(':')
  return { hour: Number(hourText), minute: Number(minuteText) }
}
