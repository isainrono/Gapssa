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
 */

export interface TreatmentFixture {
  id: string
  name: string
  familia: string
  durationMinutes: number
  precioOrientativo?: number | null
  estadoPrecio?: string | null
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
  precioOrientativo: z.number().nullable().optional(),
  estadoPrecio: z.string().nullable().optional(),
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
  // Fixtures heredados de pruebas contractuales
  { id: 'treatment-masaje-relajante-60', name: 'Masaje relajante 60 min', familia: 'Masajes', durationMinutes: 60, precioOrientativo: 75, estadoPrecio: 'Fijo' },
  { id: 'treatment-facial-express-30', name: 'Tratamiento facial exprés 30 min', familia: 'Tratamientos faciales', durationMinutes: 30, precioOrientativo: 40, estadoPrecio: 'Fijo' },
  { id: 'treatment-manicura-45', name: 'Manicura 45 min', familia: 'Uñas', durationMinutes: 45, precioOrientativo: 25, estadoPrecio: 'Fijo' },

  // Masajes
  { id: 'masaje-relajante-30', name: 'Masaje relajante 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 40, estadoPrecio: 'Fijo' },
  { id: 'masaje-descontracturante-30', name: 'Masaje descontracturante 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 37, estadoPrecio: 'Fijo' },
  { id: 'masaje-descontracturante-60', name: 'Masaje descontracturante 60 min', familia: 'Masajes', durationMinutes: 60, precioOrientativo: 70, estadoPrecio: 'Fijo' },
  { id: 'masaje-deportivo-30', name: 'Masaje deportivo 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 40, estadoPrecio: 'Fijo' },
  { id: 'masaje-deportivo-60', name: 'Masaje deportivo 60 min', familia: 'Masajes', durationMinutes: 60, precioOrientativo: 80, estadoPrecio: 'Fijo' },
  { id: 'masaje-prenatal-30', name: 'Masaje prenatal 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 40, estadoPrecio: 'Fijo' },
  { id: 'masaje-prenatal-60', name: 'Masaje prenatal 60 min', familia: 'Masajes', durationMinutes: 60, precioOrientativo: 70, estadoPrecio: 'Fijo' },
  { id: 'masaje-aromaterapia-30', name: 'Masaje de aromaterapia 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 37, estadoPrecio: 'Fijo' },
  { id: 'masaje-aromaterapia-60', name: 'Masaje de aromaterapia 60 min', familia: 'Masajes', durationMinutes: 60, precioOrientativo: 62, estadoPrecio: 'Fijo' },
  { id: 'masaje-craneofacial-30', name: 'Masaje craneofacial 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 30, estadoPrecio: 'Fijo' },
  { id: 'masaje-facial-30', name: 'Masaje facial 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 37, estadoPrecio: 'Fijo' },
  { id: 'masaje-piernas-cansadas-30', name: 'Masaje piernas cansadas 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 37, estadoPrecio: 'Fijo' },
  { id: 'masaje-pies-15', name: 'Masaje relajante de pies 15 min', familia: 'Masajes', durationMinutes: 15, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'reflexologia-podal-30', name: 'Reflexología podal 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 35, estadoPrecio: 'Fijo' },
  { id: 'drenaje-manual-30', name: 'Drenaje linfático manual 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 40, estadoPrecio: 'Fijo' },
  { id: 'drenaje-manual-60', name: 'Drenaje linfático manual 60 min', familia: 'Masajes', durationMinutes: 60, precioOrientativo: 69, estadoPrecio: 'Fijo' },
  { id: 'piedras-calientes-30', name: 'Masaje con piedras calientes 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 44, estadoPrecio: 'Fijo' },
  { id: 'piedras-calientes-60', name: 'Masaje con piedras calientes 60 min', familia: 'Masajes', durationMinutes: 60, precioOrientativo: 78, estadoPrecio: 'Fijo' },
  { id: 'exfoliacion-corporal-45', name: 'Exfoliación corporal 45 min', familia: 'Masajes', durationMinutes: 45, precioOrientativo: 55, estadoPrecio: 'Fijo' },

  // Masajes y aparatología corporal
  { id: 'presoterapia-45', name: 'Presoterapia 45 min', familia: 'Masajes', durationMinutes: 45, precioOrientativo: 50, estadoPrecio: 'Fijo' },
  { id: 'presoterapia-masaje-50', name: 'Presoterapia + masaje 50 min', familia: 'Masajes', durationMinutes: 50, precioOrientativo: 60, estadoPrecio: 'Fijo' },
  { id: 'lipolaser-radiofrecuencia-60', name: 'Sesión Lipoláser + Radiofrecuencia 60 min', familia: 'Masajes', durationMinutes: 60, precioOrientativo: 100, estadoPrecio: 'Fijo' },
  { id: 'vacum-30', name: 'Reafirmante glúteos (Vacum) 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 50, estadoPrecio: 'Fijo' },
  { id: 'laser-fisio-30', name: 'Láser fisio (dolor) 30 min', familia: 'Masajes', durationMinutes: 30, precioOrientativo: 30, estadoPrecio: 'Fijo' },

  // Depilación
  { id: 'pinzas-diseno-20', name: 'Pinzas diseño 20 min', familia: 'Depilación', durationMinutes: 20, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'pinzas-cejas-15', name: 'Pinzas cejas 15 min', familia: 'Depilación', durationMinutes: 15, precioOrientativo: 11, estadoPrecio: 'Fijo' },
  { id: 'hilo-cejas-15', name: 'Hilo cejas 15 min', familia: 'Depilación', durationMinutes: 15, precioOrientativo: 16, estadoPrecio: 'Fijo' },
  { id: 'diseno-hilo-cejas-25', name: 'Diseño hilo cejas 25 min', familia: 'Depilación', durationMinutes: 25, precioOrientativo: 25, estadoPrecio: 'Fijo' },
  { id: 'hilo-labio-10', name: 'Hilo labio superior 10 min', familia: 'Depilación', durationMinutes: 10, precioOrientativo: 12, estadoPrecio: 'Fijo' },
  { id: 'hilo-menton-10', name: 'Hilo mentón 10 min', familia: 'Depilación', durationMinutes: 10, precioOrientativo: 11, estadoPrecio: 'Fijo' },
  { id: 'hilo-rostro-30', name: 'Hilo rostro completo 30 min', familia: 'Depilación', durationMinutes: 30, precioOrientativo: 32, estadoPrecio: 'Fijo' },
  { id: 'cera-labio-10', name: 'Cera labio superior 10 min', familia: 'Depilación', durationMinutes: 10, precioOrientativo: 10, estadoPrecio: 'Fijo' },
  { id: 'cera-axilas-15', name: 'Cera axilas 15 min', familia: 'Depilación', durationMinutes: 15, precioOrientativo: 15, estadoPrecio: 'Fijo' },
  { id: 'cera-abdomen-20', name: 'Cera abdomen 20 min', familia: 'Depilación', durationMinutes: 20, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'cera-brazos-30', name: 'Cera brazos 30 min', familia: 'Depilación', durationMinutes: 30, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'cera-menton-10', name: 'Cera mentón 10 min', familia: 'Depilación', durationMinutes: 10, precioOrientativo: 10, estadoPrecio: 'Fijo' },
  { id: 'cera-espalda-30', name: 'Cera espalda 30 min', familia: 'Depilación', durationMinutes: 30, precioOrientativo: 30, estadoPrecio: 'Fijo' },
  { id: 'cera-glutios-20', name: 'Cera glúteos 20 min', familia: 'Depilación', durationMinutes: 20, precioOrientativo: 25, estadoPrecio: 'Fijo' },
  { id: 'cera-ingles-brasileñas-25', name: 'Cera ingles brasileñas 25 min', familia: 'Depilación', durationMinutes: 25, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'cera-ingles-normales-15', name: 'Cera ingles normales 15 min', familia: 'Depilación', durationMinutes: 15, precioOrientativo: 16, estadoPrecio: 'Fijo' },
  { id: 'cera-ingles-integrales-30', name: 'Cera ingles integrales 30 min', familia: 'Depilación', durationMinutes: 30, precioOrientativo: 30, estadoPrecio: 'Fijo' },
  { id: 'cera-pecho-25', name: 'Cera pecho 25 min', familia: 'Depilación', durationMinutes: 25, precioOrientativo: 30, estadoPrecio: 'Fijo' },
  { id: 'cera-medias-piernas-30', name: 'Cera medias piernas 30 min', familia: 'Depilación', durationMinutes: 30, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'cera-piernas-completas-45', name: 'Cera piernas completas 45 min', familia: 'Depilación', durationMinutes: 45, precioOrientativo: 28, estadoPrecio: 'Fijo' },
  { id: 'cera-medios-brazos-20', name: 'Cera medios brazos 20 min', familia: 'Depilación', durationMinutes: 20, precioOrientativo: 15, estadoPrecio: 'Fijo' },
  { id: 'cera-perianal-15', name: 'Cera perianal 15 min', familia: 'Depilación', durationMinutes: 15, precioOrientativo: 12, estadoPrecio: 'Fijo' },

  // Depilación Láser
  { id: 'laser-patillas-15', name: 'Láser patillas 15 min', familia: 'Depilación Láser', durationMinutes: 15, precioOrientativo: 11, estadoPrecio: 'Fijo' },
  { id: 'laser-menton-15', name: 'Láser mentón 15 min', familia: 'Depilación Láser', durationMinutes: 15, precioOrientativo: 15, estadoPrecio: 'Fijo' },
  { id: 'laser-axilas-15', name: 'Láser axilas 15 min', familia: 'Depilación Láser', durationMinutes: 15, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'laser-espalda-30', name: 'Láser espalda completa 30 min', familia: 'Depilación Láser', durationMinutes: 30, precioOrientativo: 48, estadoPrecio: 'Fijo' },
  { id: 'laser-ingles-integrales-30', name: 'Láser ingles integrales 30 min', familia: 'Depilación Láser', durationMinutes: 30, precioOrientativo: 40, estadoPrecio: 'Fijo' },
  { id: 'laser-labio-10', name: 'Láser labio superior 10 min', familia: 'Depilación Láser', durationMinutes: 10, precioOrientativo: 10, estadoPrecio: 'Fijo' },
  { id: 'laser-medias-piernas-30', name: 'Láser medias piernas 30 min', familia: 'Depilación Láser', durationMinutes: 30, precioOrientativo: 30, estadoPrecio: 'Fijo' },
  { id: 'laser-piernas-completas-45', name: 'Láser piernas completas 45 min', familia: 'Depilación Láser', durationMinutes: 45, precioOrientativo: 50, estadoPrecio: 'Fijo' },
  { id: 'laser-pecho-30', name: 'Láser pecho 30 min', familia: 'Depilación Láser', durationMinutes: 30, precioOrientativo: 40, estadoPrecio: 'Fijo' },
  { id: 'laser-ingles-brasileñas-25', name: 'Láser ingles brasileñas 25 min', familia: 'Depilación Láser', durationMinutes: 25, precioOrientativo: 30, estadoPrecio: 'Fijo' },

  // Tratamientos faciales
  { id: 'hidratacion-luz-led-30', name: 'Hidratación - Luz LED (Limpieza express) 30 min', familia: 'Tratamientos faciales', durationMinutes: 30, precioOrientativo: 40, estadoPrecio: 'Fijo' },
  { id: 'limpieza-radiofrecuencia-60', name: 'Limpieza + Radiofrecuencia 60 min', familia: 'Tratamientos faciales', durationMinutes: 60, precioOrientativo: 85, estadoPrecio: 'Fijo' },
  { id: 'limpieza-basica-45', name: 'Limpieza básica 45 min', familia: 'Tratamientos faciales', durationMinutes: 45, precioOrientativo: 62, estadoPrecio: 'Fijo' },
  { id: 'limpieza-profunda-60', name: 'Limpieza profunda 60 min', familia: 'Tratamientos faciales', durationMinutes: 60, precioOrientativo: 72, estadoPrecio: 'Fijo' },
  { id: 'limpieza-laser-carbono-90', name: 'Limpieza + Láser carbono activo 90 min', familia: 'Tratamientos faciales', durationMinutes: 90, precioOrientativo: 185, estadoPrecio: 'Fijo' },
  { id: 'mesoterapia-facial-45', name: 'Mesoterapia facial 45 min', familia: 'Tratamientos faciales', durationMinutes: 45, precioOrientativo: 45, estadoPrecio: 'Fijo' },
  { id: 'microneedling-facial-60', name: 'Microneedling facial 60 min', familia: 'Tratamientos faciales', durationMinutes: 60, precioOrientativo: 120, estadoPrecio: 'Fijo' },
  { id: 'dermapen-60', name: 'Dermapen 60 min', familia: 'Tratamientos faciales', durationMinutes: 60, precioOrientativo: 95, estadoPrecio: 'Fijo' },
  { id: 'radiofrecuencia-facial-45', name: 'Radiofrecuencia facial 45 min', familia: 'Tratamientos faciales', durationMinutes: 45, precioOrientativo: 55, estadoPrecio: 'Fijo' },
  { id: 'peeling-prx-45', name: 'Peeling PRX 45 min', familia: 'Tratamientos faciales', durationMinutes: 45, precioOrientativo: 100, estadoPrecio: 'Fijo' },
  { id: 'rejuvenecimiento-skin-pen-60', name: 'Rejuvenecimiento facial Skin Pen 60 min', familia: 'Tratamientos faciales', durationMinutes: 60, precioOrientativo: 350, estadoPrecio: 'Fijo' },
  { id: 'laser-carbono-60', name: 'Láser carbono activo (Hollywood Peel) 60 min', familia: 'Tratamientos faciales', durationMinutes: 60, precioOrientativo: 110, estadoPrecio: 'Fijo' },

  // Uñas
  { id: 'manicura-normal-40', name: 'Manicura normal 40 min', familia: 'Uñas', durationMinutes: 40, precioOrientativo: 25, estadoPrecio: 'Fijo' },
  { id: 'manicura-semi-50', name: 'Manicura semipermanente 50 min', familia: 'Uñas', durationMinutes: 50, precioOrientativo: 30, estadoPrecio: 'Fijo' },
  { id: 'manicura-express-25', name: 'Manicura express 25 min', familia: 'Uñas', durationMinutes: 25, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'parafina-manos-20', name: 'Parafina manos 20 min', familia: 'Uñas', durationMinutes: 20, precioOrientativo: 20, estadoPrecio: 'Fijo' },
  { id: 'pedicura-normal-45', name: 'Pedicura normal 45 min', familia: 'Uñas', durationMinutes: 45, precioOrientativo: 30, estadoPrecio: 'Fijo' },
  { id: 'pedicura-semi-60', name: 'Pedicura semipermanente 60 min', familia: 'Uñas', durationMinutes: 60, precioOrientativo: 35, estadoPrecio: 'Fijo' },
  { id: 'pedicura-express-30', name: 'Pedicura express 30 min', familia: 'Uñas', durationMinutes: 30, precioOrientativo: 25, estadoPrecio: 'Fijo' },

  // Pestañas y cejas
  { id: 'lifting-pestanas-45', name: 'Lifting de pestañas 45 min', familia: 'Pestañas y cejas', durationMinutes: 45, precioOrientativo: 50, estadoPrecio: 'Fijo' },
  { id: 'lifting-tinte-60', name: 'Lifting + tinte 60 min', familia: 'Pestañas y cejas', durationMinutes: 60, precioOrientativo: 60, estadoPrecio: 'Fijo' },
  { id: 'tinte-pestanas-20', name: 'Tinte de pestañas 20 min', familia: 'Pestañas y cejas', durationMinutes: 20, precioOrientativo: 15, estadoPrecio: 'Fijo' },
  { id: 'laminado-cejas-45', name: 'Laminado de cejas 45 min', familia: 'Pestañas y cejas', durationMinutes: 45, precioOrientativo: 50, estadoPrecio: 'Fijo' },
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
