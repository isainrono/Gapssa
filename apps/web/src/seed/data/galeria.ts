import type { Locale } from '@/lib/i18n/locales'

export type GaleriaSeed = {
  mediaKey: string
  orden: number
  categoriaPorLocale: Record<Locale, string>
  altPorLocale: Record<Locale, string>
}

/** `mediaKey` referencia las claves subidas por `src/seed/media.ts` (mismo nombre que el archivo en `public/images/stock/`, sin extensión). */
export const GALERIA_SEED: GaleriaSeed[] = [
  {
    mediaKey: 'hero-centro',
    orden: 1,
    categoriaPorLocale: {
      es: 'Instalaciones',
      ca: 'Instal·lacions',
      en: 'Facilities',
      it: 'Struttura',
      fr: 'Établissement',
      pt: 'Instalações',
    },
    altPorLocale: {
      es: 'Sala de tratamientos de GAPSSA by Nana',
      ca: 'Sala de tractaments de GAPSSA by Nana',
      en: 'GAPSSA by Nana treatment room',
      it: 'Sala trattamenti di GAPSSA by Nana',
      fr: 'Salle de soins de GAPSSA by Nana',
      pt: 'Sala de tratamentos da GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'tratamiento-facial',
    orden: 2,
    categoriaPorLocale: {
      es: 'Tratamiento facial',
      ca: 'Tractament facial',
      en: 'Facial treatment',
      it: 'Trattamento viso',
      fr: 'Soin du visage',
      pt: 'Tratamento facial',
    },
    altPorLocale: {
      es: 'Tratamiento facial en GAPSSA by Nana',
      ca: 'Tractament facial a GAPSSA by Nana',
      en: 'Facial treatment at GAPSSA by Nana',
      it: 'Trattamento viso da GAPSSA by Nana',
      fr: 'Soin du visage chez GAPSSA by Nana',
      pt: 'Tratamento facial na GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'unas-parafina-manos',
    orden: 3,
    categoriaPorLocale: { es: 'Manicura', ca: 'Manicura', en: 'Manicure', it: 'Manicure', fr: 'Manucure', pt: 'Manicure' },
    altPorLocale: {
      es: 'Tratamiento de manicura en GAPSSA by Nana',
      ca: 'Tractament de manicura a GAPSSA by Nana',
      en: 'Manicure treatment at GAPSSA by Nana',
      it: 'Trattamento manicure da GAPSSA by Nana',
      fr: 'Soin manucure chez GAPSSA by Nana',
      pt: 'Tratamento de manicure na GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'masajes-masaje-deportivo',
    orden: 4,
    categoriaPorLocale: { es: 'Masajes', ca: 'Massatges', en: 'Massages', it: 'Massaggi', fr: 'Massages', pt: 'Massagens' },
    altPorLocale: {
      es: 'Sesión de masaje en GAPSSA by Nana',
      ca: 'Sessió de massatge a GAPSSA by Nana',
      en: 'Massage session at GAPSSA by Nana',
      it: 'Seduta di massaggio da GAPSSA by Nana',
      fr: 'Séance de massage chez GAPSSA by Nana',
      pt: 'Sessão de massagem na GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'masajes-presoterapia',
    orden: 5,
    categoriaPorLocale: {
      es: 'Corporal',
      ca: 'Corporal',
      en: 'Body treatments',
      it: 'Trattamenti corpo',
      fr: 'Soins du corps',
      pt: 'Tratamentos corporais',
    },
    altPorLocale: {
      es: 'Tratamiento corporal y presoterapia en GAPSSA by Nana',
      ca: 'Tractament corporal i pressoteràpia a GAPSSA by Nana',
      en: 'Body treatment and pressotherapy at GAPSSA by Nana',
      it: 'Trattamento corpo e pressoterapia da GAPSSA by Nana',
      fr: 'Soin du corps et pressothérapie chez GAPSSA by Nana',
      pt: 'Tratamento corporal e pressoterapia na GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'fondo',
    orden: 6,
    categoriaPorLocale: {
      es: 'GAPSSA by Nana',
      ca: 'GAPSSA by Nana',
      en: 'GAPSSA by Nana',
      it: 'GAPSSA by Nana',
      fr: 'GAPSSA by Nana',
      pt: 'GAPSSA by Nana',
    },
    altPorLocale: {
      es: 'GAPSSA by Nana — Belleza y estética integral en Barcelona',
      ca: 'GAPSSA by Nana — Bellesa i estètica integral a Barcelona',
      en: 'GAPSSA by Nana — Integral beauty and aesthetics in Barcelona',
      it: 'GAPSSA by Nana — Bellezza ed estetica integrale a Barcellona',
      fr: 'GAPSSA by Nana — Beauté et esthétique intégrale à Barcelone',
      pt: 'GAPSSA by Nana — Beleza e estética integral em Barcelona',
    },
  },
  {
    mediaKey: 'hidratacion-facial',
    orden: 7,
    categoriaPorLocale: {
      es: 'Hidratación facial',
      ca: 'Hidratació facial',
      en: 'Facial hydration',
      it: 'Idratazione viso',
      fr: 'Hydratation du visage',
      pt: 'Hidratação facial',
    },
    altPorLocale: {
      es: 'Tratamiento de hidratación facial',
      ca: 'Tractament d’hidratació facial',
      en: 'Facial hydration treatment',
      it: 'Trattamento di idratazione viso',
      fr: 'Soin d’hydratation du visage',
      pt: 'Tratamento de hidratação facial',
    },
  },
  {
    mediaKey: 'tratamiento-reafirmante',
    orden: 8,
    categoriaPorLocale: {
      es: 'Tratamiento corporal',
      ca: 'Tractament corporal',
      en: 'Body treatment',
      it: 'Trattamento corpo',
      fr: 'Soin du corps',
      pt: 'Tratamento corporal',
    },
    altPorLocale: {
      es: 'Tratamiento corporal reafirmante',
      ca: 'Tractament corporal reafirmant',
      en: 'Firming body treatment',
      it: 'Trattamento corpo rassodante',
      fr: 'Soin du corps raffermissant',
      pt: 'Tratamento corporal reafirmante',
    },
  },
  {
    mediaKey: 'pedicura',
    orden: 9,
    categoriaPorLocale: { es: 'Pedicura', ca: 'Pedicura', en: 'Pedicure', it: 'Pedicure', fr: 'Pédicure', pt: 'Pedicure' },
    altPorLocale: {
      es: 'Pedicura realizada en GAPSSA by Nana',
      ca: 'Pedicura realitzada a GAPSSA by Nana',
      en: 'Pedicure performed at GAPSSA by Nana',
      it: 'Pedicure eseguita da GAPSSA by Nana',
      fr: 'Pédicure réalisée chez GAPSSA by Nana',
      pt: 'Pedicure realizada na GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'microdermoabrasion',
    orden: 10,
    categoriaPorLocale: {
      es: 'Cuidado avanzado',
      ca: 'Cura avançada',
      en: 'Advanced care',
      it: 'Cura avanzata',
      fr: 'Soin avancé',
      pt: 'Cuidado avançado',
    },
    altPorLocale: {
      es: 'Tratamiento facial de cuidado avanzado',
      ca: 'Tractament facial de cura avançada',
      en: 'Advanced facial care treatment',
      it: 'Trattamento viso di cura avanzata',
      fr: 'Soin du visage avancé',
      pt: 'Tratamento facial de cuidado avançado',
    },
  },
]
