import 'server-only'

import { MAX_LEAD_TIME_DAYS, MIN_LEAD_TIME_HOURS } from '@gapssa/contracts'

import type { ProfessionalFixture, TreatmentFixture, ZoneFixture } from './catalog'
import type { EspoBookingAdapter } from './espoAdapter'

/**
 * Validación de "¿esta combinación tratamiento+profesional+zona+horario
 * tiene sentido?" — compartida entre invitado y cliente autenticado
 * (encargo de Fase 4A, punto 7: "no duplicar lógica de negocio"). No
 * comprueba disponibilidad real (eso es `isSlotStillAvailable`,
 * availability.ts) — solo que las entidades existan y que el horario
 * cumpla antelación mínima/horizonte máximo.
 */

export type SlotValidationOutcome =
  | {
      outcome: 'ok'
      treatment: TreatmentFixture
      zone: ZoneFixture
      professional: ProfessionalFixture
      startAt: Date
      endAt: Date
    }
  | { outcome: 'treatment_not_found' }
  | { outcome: 'zone_not_found' }
  | { outcome: 'professional_not_found' }
  | { outcome: 'invalid_start_time' }
  | { outcome: 'lead_time_violation' }
  | { outcome: 'horizon_violation' }

export async function validateSlotRequest(
  adapter: EspoBookingAdapter,
  input: { treatmentId: string; professionalId: string; zoneId: string; startAt: string },
  now: Date,
): Promise<SlotValidationOutcome> {
  const treatment = await adapter.getTreatment(input.treatmentId)
  if (!treatment) {
    return { outcome: 'treatment_not_found' }
  }
  const zone = await adapter.getZone(input.zoneId)
  if (!zone) {
    return { outcome: 'zone_not_found' }
  }
  const professional = await adapter.getProfessional(input.professionalId)
  if (!professional || !professional.active) {
    return { outcome: 'professional_not_found' }
  }

  const startAt = new Date(input.startAt)
  if (Number.isNaN(startAt.getTime())) {
    return { outcome: 'invalid_start_time' }
  }
  const endAt = new Date(startAt.getTime() + treatment.durationMinutes * 60 * 1000)

  const minLeadDeadline = new Date(now.getTime() + MIN_LEAD_TIME_HOURS * 60 * 60 * 1000)
  if (startAt.getTime() < minLeadDeadline.getTime()) {
    return { outcome: 'lead_time_violation' }
  }
  const horizonDeadline = new Date(now.getTime() + MAX_LEAD_TIME_DAYS * 24 * 60 * 60 * 1000)
  if (startAt.getTime() > horizonDeadline.getTime()) {
    return { outcome: 'horizon_violation' }
  }

  return { outcome: 'ok', treatment, zone, professional, startAt, endAt }
}
