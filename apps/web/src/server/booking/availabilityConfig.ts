import 'server-only'

import { MAX_LEAD_TIME_DAYS, MIN_LEAD_TIME_HOURS } from '@gapssa/contracts'

import { serverEnv } from '../env'

/**
 * Reglas de disponibilidad centralizadas — encargo de Fase 4A, punto 3:
 * "No codificar estas reglas como constantes repartidas; centralizarlas
 * en configuración validada." Dos procedencias distintas, nunca mezcladas:
 *
 * - Antelación mínima (`MIN_LEAD_TIME_HOURS`) y horizonte máximo
 *   (`MAX_LEAD_TIME_DAYS`): valores de negocio YA FIJADOS por
 *   `packages/contracts/src/booking.ts` — se importan de ahí, nunca se
 *   redefinen aquí (mismo razonamiento que ese archivo documenta en su
 *   cabecera).
 * - Horario de apertura, granularidad de huecos y tope de resultados: no
 *   están en `@gapssa/contracts` (son específicos de la disponibilidad del
 *   portal, no del ciclo de vida de la reserva) — configurables por
 *   variable de entorno (`server/env.ts`), validados una sola vez al
 *   arrancar, nunca hardcodeados en el algoritmo de búsqueda de huecos
 *   (`server/booking/availability.ts`).
 */

export const availabilityConfig = {
  minLeadTimeHours: MIN_LEAD_TIME_HOURS,
  maxLeadTimeDays: MAX_LEAD_TIME_DAYS,
  /** Días de apertura, 0=domingo..6=sábado (por defecto lunes a sábado). */
  openDays: serverEnv.BOOKING_BUSINESS_DAYS,
  openTime: serverEnv.BOOKING_OPEN_TIME,
  closeTime: serverEnv.BOOKING_CLOSE_TIME,
  slotGranularityMinutes: serverEnv.BOOKING_SLOT_GRANULARITY_MINUTES,
  maxSlotsPerQuery: serverEnv.BOOKING_MAX_SLOTS_PER_QUERY,
} as const

export type AvailabilityConfig = typeof availabilityConfig
