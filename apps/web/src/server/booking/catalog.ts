import { z } from 'zod'

/**
 * Catálogo de tratamientos/zonas/profesionales — Fase 4A, adaptador
 * EspoCRM SIMULADO. En producción esto se leería de EspoCRM real
 * (`CTratamiento`, `CZonaAtencion`, profesionales vía `User`/participante
 * de `Meeting` — ver docs/espocrm-modelo-inicial.md); mientras el
 * adaptador es simulado, es UNA lista centralizada y validada en
 * arranque, nunca constantes repartidas por el código (encargo de Fase
 * 4A, punto 3). `EspoBookingAdapter.listTreatments/listZones/listProfessionals`
 * (server/booking/espoAdapter.ts) son el único punto de lectura — sustituir
 * esta lista por una llamada HTTP real a EspoCRM no cambia ningún llamante.
 *
 * IDs deliberadamente ficticios (`treatment-*`/`zone-*`/`professional-*`),
 * sin relación con ningún id real de la instancia de EspoCRM (los
 * registros `[PRUEBA]` de docs/espocrm-modelo-inicial.md son datos de
 * prueba de esa instancia, no de esta simulación) — evita cualquier
 * confusión entre "id simulado de este adaptador" e "id real de EspoCRM".
 *
 * Un único profesional en alta hoy (`PROJECT_CONTEXT.md` §2: "Una
 * profesional durante la apertura") — la lista admite más porque el
 * negocio prevé incorporaciones futuras (mismo documento, §10), pero el
 * flujo de recomendación (server/booking/availability.ts) no asume que
 * siempre haya más de uno.
 */

export interface TreatmentFixture {
  id: string
  name: string
  familia: string
  durationMinutes: number
}

export interface ZoneFixture {
  id: string
  name: string
  /** = CZonaAtencion.capacidadSimultanea (docs/espocrm-modelo-inicial.md). */
  capacidadSimultanea: number
}

export interface ProfessionalFixture {
  id: string
  name: string
  active: boolean
}

const treatmentFixtureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  familia: z.string().min(1),
  durationMinutes: z.number().int().min(5).max(480),
})

const zoneFixtureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capacidadSimultanea: z.number().int().min(1).max(20),
})

const professionalFixtureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean(),
})

const RAW_TREATMENTS: TreatmentFixture[] = [
  { id: 'treatment-masaje-relajante-60', name: 'Masaje relajante 60 min', familia: 'Masajes', durationMinutes: 60 },
  {
    id: 'treatment-facial-express-30',
    name: 'Tratamiento facial exprés 30 min',
    familia: 'Tratamientos faciales',
    durationMinutes: 30,
  },
  { id: 'treatment-manicura-45', name: 'Manicura 45 min', familia: 'Uñas', durationMinutes: 45 },
]

const RAW_ZONES: ZoneFixture[] = [
  { id: 'zone-cabina-1', name: 'Cabina 1', capacidadSimultanea: 1 },
  { id: 'zone-cabina-2', name: 'Cabina 2', capacidadSimultanea: 1 },
]

const RAW_PROFESSIONALS: ProfessionalFixture[] = [{ id: 'professional-owner', name: 'Profesional GAPSSA', active: true }]

/** Valida en el momento de importar el módulo — un fixture malformado hace fallar el arranque, nunca una respuesta silenciosamente vacía en producción. */
export const TREATMENT_FIXTURES: readonly TreatmentFixture[] = z.array(treatmentFixtureSchema).parse(RAW_TREATMENTS)
export const ZONE_FIXTURES: readonly ZoneFixture[] = z.array(zoneFixtureSchema).parse(RAW_ZONES)
export const PROFESSIONAL_FIXTURES: readonly ProfessionalFixture[] = z
  .array(professionalFixtureSchema)
  .parse(RAW_PROFESSIONALS)

export function findTreatment(id: string): TreatmentFixture | null {
  return TREATMENT_FIXTURES.find((treatment) => treatment.id === id) ?? null
}

export function findZone(id: string): ZoneFixture | null {
  return ZONE_FIXTURES.find((zone) => zone.id === id) ?? null
}

export function findProfessional(id: string): ProfessionalFixture | null {
  return PROFESSIONAL_FIXTURES.find((professional) => professional.id === id) ?? null
}

export function listActiveProfessionals(): ProfessionalFixture[] {
  return PROFESSIONAL_FIXTURES.filter((professional) => professional.active)
}
