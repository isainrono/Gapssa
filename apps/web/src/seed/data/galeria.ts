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
    mediaKey: 'manicura',
    orden: 3,
    categoriaPorLocale: { es: 'Manicura', ca: 'Manicura', en: 'Manicure', it: 'Manicure', fr: 'Manucure', pt: 'Manicure' },
    altPorLocale: {
      es: 'Manicura realizada en GAPSSA by Nana',
      ca: 'Manicura realitzada a GAPSSA by Nana',
      en: 'Manicure performed at GAPSSA by Nana',
      it: 'Manicure eseguita da GAPSSA by Nana',
      fr: 'Manucure réalisée chez GAPSSA by Nana',
      pt: 'Manicure realizada na GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'masaje',
    orden: 4,
    categoriaPorLocale: { es: 'Masaje', ca: 'Massatge', en: 'Massage', it: 'Massaggio', fr: 'Massage', pt: 'Massagem' },
    altPorLocale: {
      es: 'Masaje relajante en GAPSSA by Nana',
      ca: 'Massatge relaxant a GAPSSA by Nana',
      en: 'Relaxing massage at GAPSSA by Nana',
      it: 'Massaggio rilassante da GAPSSA by Nana',
      fr: 'Massage relaxant chez GAPSSA by Nana',
      pt: 'Massagem relaxante na GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'depilacion-facial',
    orden: 5,
    categoriaPorLocale: {
      es: 'Depilación facial',
      ca: 'Depilació facial',
      en: 'Facial hair removal',
      it: 'Depilazione del viso',
      fr: 'Épilation du visage',
      pt: 'Depilação facial',
    },
    altPorLocale: {
      es: 'Depilación facial en GAPSSA by Nana',
      ca: 'Depilació facial a GAPSSA by Nana',
      en: 'Facial hair removal at GAPSSA by Nana',
      it: 'Depilazione del viso da GAPSSA by Nana',
      fr: 'Épilation du visage chez GAPSSA by Nana',
      pt: 'Depilação facial na GAPSSA by Nana',
    },
  },
  {
    mediaKey: 'radiofrecuencia-facial',
    orden: 6,
    categoriaPorLocale: {
      es: 'Radiofrecuencia facial',
      ca: 'Radiofreqüència facial',
      en: 'Facial radiofrequency',
      it: 'Radiofrequenza viso',
      fr: 'Radiofréquence visage',
      pt: 'Radiofrequência facial',
    },
    altPorLocale: {
      es: 'Tratamiento de radiofrecuencia facial',
      ca: 'Tractament de radiofreqüència facial',
      en: 'Facial radiofrequency treatment',
      it: 'Trattamento di radiofrequenza viso',
      fr: 'Soin de radiofréquence du visage',
      pt: 'Tratamento de radiofrequência facial',
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
