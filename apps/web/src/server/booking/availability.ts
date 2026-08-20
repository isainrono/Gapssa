import 'server-only'

import { availabilityConfig } from './availabilityConfig'
import type { EspoBookingAdapter } from './espoAdapter'
import { listUnresolvedOverlapping } from './repository'
import { getZonedWeekday, parseHhMm, zonedTimeToUtc, BOOKING_TIME_ZONE } from './timezone'

/**
 * Algoritmo de búsqueda de huecos — encargo de Fase 4A, punto 3
 * (disponibilidad). Combina, para el día solicitado, la ocupación
 * "definitiva" (`sim_espo_meetings`, vía `EspoBookingAdapter` — lo que en
 * producción sería una consulta real a EspoCRM) con la ocupación
 * "en vuelo" (`booking_request_records` sin Meeting todavía — Postgres,
 * `listUnresolvedOverlapping`): sin esta segunda fuente, dos invitados
 * podrían ver el mismo hueco como libre mientras el primero todavía está
 * verificando su correo (antes de que exista Meeting).
 *
 * Reglas aplicadas (todas desde configuración validada, nunca constantes
 * dispersas — `availabilityConfig.ts`): antelación mínima, horizonte
 * máximo, horario de apertura, granularidad de hueco, capacidad de zona,
 * exclusividad del profesional (nunca dos citas simultáneas de la misma
 * profesional — capacidad implícita 1, independiente de
 * `capacidadSimultanea` de la zona).
 */

export interface AvailabilityQuery {
  treatmentId: string
  professionalId?: string
  /** Fecha en formato YYYY-MM-DD, interpretada como día calendario en BOOKING_TIME_ZONE. */
  date: string
}

export interface AvailabilitySlot {
  startAt: string
  endAt: string
  treatmentId: string
  professionalId: string
  zoneId: string
}

export type AvailabilityResult =
  | { outcome: 'ok'; slots: AvailabilitySlot[] }
  | { outcome: 'treatment_not_found' }
  | { outcome: 'professional_not_found' }
  | { outcome: 'invalid_date' }

/**
 * Repite, para UN candidato concreto (profesional+zona+horario), la misma
 * comprobación de solape que `computeAvailability` hace en bloque para un
 * día entero — usado como última comprobación en Postgres/EspoCRM (previa
 * a la adquisición atómica del `BookingLock` en Redis) en el momento de
 * CREAR una solicitud, tanto de invitado como de cliente autenticado
 * (`guestFlow.ts`/`authenticatedFlow.ts` — comparten esta función para no
 * duplicar la regla). Nunca sustituye al `BookingLock`: cubre "¿ya existe
 * una cita o solicitud asentada que choque?", el lock cubre "¿alguien más
 * está reclamando este mismo hueco en este mismo instante?".
 */
export async function isSlotStillAvailable(
  adapter: EspoBookingAdapter,
  input: { professionalId: string; zoneId: string; startAt: Date; endAt: Date; zoneCapacity: number },
): Promise<boolean> {
  const [activeMeetings, unresolvedRequests] = await Promise.all([
    adapter.listActiveMeetingsOverlapping({ from: input.startAt, to: input.endAt }),
    listUnresolvedOverlapping({ from: input.startAt, to: input.endAt }),
  ])

  const occupancy = [
    ...activeMeetings.map((meeting) => ({ professionalId: meeting.professionalId, zoneId: meeting.zoneId })),
    ...unresolvedRequests.map((request) => ({ professionalId: request.professionalId, zoneId: request.zoneId })),
  ]

  const professionalBusy = occupancy.some((entry) => entry.professionalId === input.professionalId)
  if (professionalBusy) {
    return false
  }

  const zoneOccupiedCount = occupancy.filter((entry) => entry.zoneId === input.zoneId).length
  return zoneOccupiedCount < input.zoneCapacity
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Política neutral de orden de profesionales — revisión 3 de Fase 4A,
 * punto 6. El bucle principal recorre, PARA CADA horario candidato, la
 * lista de profesionales activas en el mismo orden y corta en cuanto
 * `slots.length >= maxSlotsPerQuery` (más abajo) — un orden fijo por id
 * (el único criterio antes de esta revisión) es determinista pero sesgado:
 * si el tope corta a mitad de la franja horaria más temprana (el caso
 * típico cuando el número de profesionales activas es mayor o igual que
 * el tope), las profesionales con id "menor" alfabéticamente ocupan SIEMPRE
 * las primeras posiciones del resultado, sin importar la fecha consultada
 * — nunca les llega el turno a las demás.
 *
 * Política elegida: ROTACIÓN DETERMINISTA basada en la fecha consultada
 * (una de las opciones aceptadas por el encargo). Se calcula un
 * desplazamiento a partir del número ordinal de días UTC de la fecha
 * (`Date.UTC(year, month-1, day) / MS_PER_DAY`, nunca `now`: la ROTACIÓN
 * depende únicamente de qué DÍA se consulta, no de cuándo se hace la
 * consulta, así que repetir la misma consulta el mismo día es
 * reproducible) módulo el número de profesionales activas, y se rota la
 * lista ya ordenada por id ese número de posiciones. El resultado sigue
 * siendo 100% determinista para una fecha dada (nunca aleatorio: dos
 * consultas al mismo día devuelven exactamente el mismo orden), pero qué
 * profesional ocupa la primera posición — y por tanto quién tiene ventaja
 * cuando el tope corta a mitad de una franja — cambia de un día a otro,
 * así que ninguna profesional monopoliza sistemáticamente el resultado a
 * lo largo de varias fechas distintas.
 */
function rotateProfessionalsForDate<T>(professionalsSortedById: T[], year: number, month: number, day: number): T[] {
  const count = professionalsSortedById.length
  if (count === 0) {
    return professionalsSortedById
  }
  const dayOrdinal = Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY)
  const offset = ((dayOrdinal % count) + count) % count
  return [...professionalsSortedById.slice(offset), ...professionalsSortedById.slice(0, offset)]
}

export async function computeAvailability(
  adapter: EspoBookingAdapter,
  query: AvailabilityQuery,
  now: Date = new Date(),
): Promise<AvailabilityResult> {
  const treatment = await adapter.getTreatment(query.treatmentId)
  if (!treatment) {
    return { outcome: 'treatment_not_found' }
  }

  const professionalsToCheck = query.professionalId
    ? [await adapter.getProfessional(query.professionalId)]
    : await adapter.listProfessionals()
  const activeProfessionals = professionalsToCheck
    .filter((professional): professional is NonNullable<typeof professional> => Boolean(professional?.active))
    // Orden determinista por id — `adapter.listProfessionals()` no garantiza
    // ningún orden estable (fixture hoy, futura consulta a EspoCRM mañana);
    // sin esto, qué profesional "gana" al recortar por `maxSlotsPerQuery`
    // dependería del orden de llegada de esa lista, no de una regla
    // explícita.
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
  if (query.professionalId && activeProfessionals.length === 0) {
    return { outcome: 'professional_not_found' }
  }

  const match = DATE_PATTERN.exec(query.date)
  if (!match) {
    return { outcome: 'invalid_date' }
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  // new Date(Date.UTC(...)) normaliza componentes imposibles (p. ej.
  // 2026-02-31 -> marzo) — comparar contra los valores originales rechaza
  // esas fechas en vez de aceptarlas silenciosamente reinterpretadas.
  const normalizedCheck = new Date(Date.UTC(year, month - 1, day))
  if (
    normalizedCheck.getUTCFullYear() !== year ||
    normalizedCheck.getUTCMonth() !== month - 1 ||
    normalizedCheck.getUTCDate() !== day
  ) {
    return { outcome: 'invalid_date' }
  }

  const weekday = getZonedWeekday(normalizedCheck, BOOKING_TIME_ZONE)
  const zones = await adapter.listZones()
  const slots: AvailabilitySlot[] = []
  const orderedProfessionals = rotateProfessionalsForDate(activeProfessionals, year, month, day)

  if (!availabilityConfig.openDays.includes(weekday)) {
    return { outcome: 'ok', slots }
  }

  const openTime = parseHhMm(availabilityConfig.openTime)
  const closeTime = parseHhMm(availabilityConfig.closeTime)
  const dayOpenAt = zonedTimeToUtc(year, month, day, openTime.hour, openTime.minute)
  const dayCloseAt = zonedTimeToUtc(year, month, day, closeTime.hour, closeTime.minute)

  const minLeadDeadline = new Date(now.getTime() + availabilityConfig.minLeadTimeHours * 60 * 60 * 1000)
  const horizonDeadline = new Date(now.getTime() + availabilityConfig.maxLeadTimeDays * 24 * 60 * 60 * 1000)
  const durationMs = treatment.durationMinutes * 60 * 1000
  const stepMs = availabilityConfig.slotGranularityMinutes * 60 * 1000

  const searchStart = new Date(Math.max(dayOpenAt.getTime(), minLeadDeadline.getTime()))
  const lastPossibleStart = new Date(Math.min(dayCloseAt.getTime() - durationMs, horizonDeadline.getTime()))

  if (searchStart.getTime() > lastPossibleStart.getTime()) {
    return { outcome: 'ok', slots }
  }

  // Una sola consulta por fuente para todo el día (no una por hueco
  // candidato) — el volumen de este negocio (un centro, un puñado de
  // profesionales/zonas) hace que cargar toda la ocupación del día en
  // memoria sea trivial y evita N consultas repetidas.
  const [activeMeetings, unresolvedRequests] = await Promise.all([
    adapter.listActiveMeetingsOverlapping({ from: dayOpenAt, to: dayCloseAt }),
    listUnresolvedOverlapping({ from: dayOpenAt, to: dayCloseAt }),
  ])

  const occupancy = [
    ...activeMeetings.map((meeting) => ({
      professionalId: meeting.professionalId,
      zoneId: meeting.zoneId,
      startAt: meeting.startAt,
      endAt: meeting.endAt,
    })),
    ...unresolvedRequests.map((request) => ({
      professionalId: request.professionalId,
      zoneId: request.zoneId,
      startAt: request.startAt,
      endAt: request.endAt,
    })),
  ]

  for (
    let candidateStartMs = searchStart.getTime();
    candidateStartMs <= lastPossibleStart.getTime();
    candidateStartMs += stepMs
  ) {
    if (slots.length >= availabilityConfig.maxSlotsPerQuery) {
      break
    }

    const candidateStart = new Date(candidateStartMs)
    const candidateEnd = new Date(candidateStartMs + durationMs)

    for (const professional of orderedProfessionals) {
      if (slots.length >= availabilityConfig.maxSlotsPerQuery) {
        break
      }

      // `occupancy` es SOLO ocupación real (Meetings activos +
      // BookingRequestRecord realmente en curso), fijada antes de este
      // bucle y nunca mutada dentro de él. Un slot que se OFRECE como
      // alternativa no es una reserva: el cliente elegirá como mucho una de
      // las alternativas mostradas, y la capacidad/exclusividad real se
      // reconfirma al crear la solicitud (isSlotStillAvailable) y de forma
      // atómica en el script de Redis (bookingLock.ts) — nunca aquí. Mutar
      // `occupancy` con los propios slots ofrecidos convertía alternativas
      // no reservadas en ocupación ficticia: bloqueaba huecos solapados de
      // la misma profesional (09:00/09:30 para un tratamiento de 60 min con
      // granularidad 30) y evitaba que una segunda profesional apareciera
      // como alternativa a la misma hora en una zona de capacidad 1.
      const professionalBusy = occupancy.some(
        (entry) =>
          entry.professionalId === professional.id &&
          intervalsOverlap(candidateStart, candidateEnd, entry.startAt, entry.endAt),
      )
      if (professionalBusy) {
        continue
      }

      const zone = zones.find((candidateZone) => {
        const occupiedCount = occupancy.filter(
          (entry) =>
            entry.zoneId === candidateZone.id && intervalsOverlap(candidateStart, candidateEnd, entry.startAt, entry.endAt),
        ).length
        return occupiedCount < candidateZone.capacidadSimultanea
      })

      if (!zone) {
        continue
      }

      slots.push({
        startAt: candidateStart.toISOString(),
        endAt: candidateEnd.toISOString(),
        treatmentId: treatment.id,
        professionalId: professional.id,
        zoneId: zone.id,
      })
    }
  }

  return { outcome: 'ok', slots }
}
