import type { Locale } from '@/lib/i18n/locales'
import type { DiaSemana } from '@/globals/AjustesGlobales'

export type HorarioSeed = { dia: DiaSemana; cerrado: boolean; franja?: string }

/** Horario inicial confirmado: lunes a viernes 10:00–20:00, sábado 10:00–17:00, domingo cerrado. */
export const HORARIO_SEED: HorarioSeed[] = [
  { dia: 'lunes', cerrado: false, franja: '10:00–20:00' },
  { dia: 'martes', cerrado: false, franja: '10:00–20:00' },
  { dia: 'miercoles', cerrado: false, franja: '10:00–20:00' },
  { dia: 'jueves', cerrado: false, franja: '10:00–20:00' },
  { dia: 'viernes', cerrado: false, franja: '10:00–20:00' },
  { dia: 'sabado', cerrado: false, franja: '10:00–17:00' },
  { dia: 'domingo', cerrado: true },
]

/** Dirección confirmada en `PROJECT_CONTEXT.md` §7.2. */
export const DIRECCION_SEED = {
  calle: 'Carrer de Gayarre 24',
  ciudad: 'Barcelona',
  codigoPostal: '08014',
  pais: 'España',
}

export const SEO_POR_DEFECTO_SEED: Record<Locale, { titulo: string; descripcion: string }> = {
  es: { titulo: 'GAPSSA by Nana — Centro de estética en Barcelona', descripcion: 'Centro de estética y belleza integral en Barcelona. Tratamientos personalizados con dedicación y profesionalidad.' },
  ca: { titulo: 'GAPSSA by Nana — Centre d’estètica a Barcelona', descripcion: 'Centre d’estètica i bellesa integral a Barcelona. Tractaments personalitzats amb dedicació i professionalitat.' },
  en: { titulo: 'GAPSSA by Nana — Beauty centre in Barcelona', descripcion: 'Integral beauty and aesthetic centre in Barcelona. Personalised treatments with dedication and professionalism.' },
  it: { titulo: 'GAPSSA by Nana — Centro estetico a Barcellona', descripcion: 'Centro di estetica e bellezza integrale a Barcellona. Trattamenti personalizzati con dedizione e professionalità.' },
  fr: { titulo: 'GAPSSA by Nana — Institut de beauté à Barcelone', descripcion: 'Institut de beauté et d’esthétique intégrale à Barcelone. Des soins personnalisés, réalisés avec soin et professionnalisme.' },
  pt: { titulo: 'GAPSSA by Nana — Centro de estética em Barcelona', descripcion: 'Centro de estética e beleza integral em Barcelona. Tratamentos personalizados com dedicação e profissionalismo.' },
}
