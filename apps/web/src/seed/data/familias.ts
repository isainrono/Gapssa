import type { Locale } from '@/lib/i18n/locales'

export type FamiliaSeed = {
  slug: string
  orden: number
  porLocale: Record<Locale, { titulo: string; descripcion: string }>
}

/** Las 6 familias oficiales de GAPSSA por orden del cliente. */
export const FAMILIAS_SEED: FamiliaSeed[] = [
  {
    slug: 'faciales',
    orden: 1,
    porLocale: {
      es: { titulo: 'Tratamientos faciales', descripcion: 'Cuidado facial personalizado para una piel más luminosa y saludable.' },
      ca: { titulo: 'Tractaments facials', descripcion: 'Cura facial personalitzada per a una pell més lluminosa i saludable.' },
      en: { titulo: 'Facial treatments', descripcion: 'Personalised facial care for brighter, healthier-looking skin.' },
      it: { titulo: 'Trattamenti viso', descripcion: 'Cura del viso personalizzata per una pelle più luminosa e sana.' },
      fr: { titulo: 'Soins du visage', descripcion: 'Des soins du visage personnalisés pour une peau plus lumineuse et saine.' },
      pt: { titulo: 'Tratamentos faciais', descripcion: 'Cuidado facial personalizado para uma pele mais luminosa e saudável.' },
    },
  },
  {
    slug: 'pestanas-cejas',
    orden: 2,
    porLocale: {
      es: { titulo: 'Pestañas y cejas', descripcion: 'Realza tu mirada con tratamientos de pestañas y cejas.' },
      ca: { titulo: 'Pestanyes i celles', descripcion: 'Realça la teva mirada amb tractaments de pestanyes i celles.' },
      en: { titulo: 'Lashes and brows', descripcion: 'Enhance your eyes with lash and brow treatments.' },
      it: { titulo: 'Ciglia e sopracciglia', descripcion: 'Valorizza il tuo sguardo con trattamenti per ciglia e sopracciglia.' },
      fr: { titulo: 'Cils et sourcils', descripcion: 'Sublimez votre regard avec des soins cils et sourcils.' },
      pt: { titulo: 'Pestanas e sobrancelhas', descripcion: 'Realce o seu olhar com tratamentos de pestanas e sobrancelhas.' },
    },
  },
  {
    slug: 'depilacion',
    orden: 3,
    porLocale: {
      es: { titulo: 'Depilación', descripcion: 'Servicios de depilación manual con cera, hilo y pinzas.' },
      ca: { titulo: 'Depilació', descripcion: 'Serveis de depilació manual amb cera, fil i pinces.' },
      en: { titulo: 'Hair removal', descripcion: 'Manual hair removal services with wax, thread and tweezers.' },
      it: { titulo: 'Depilazione', descripcion: 'Servizi di depilazione manuale con cera, filo e pinzette.' },
      fr: { titulo: 'Épilation', descripcion: 'Services d’épilation manuelle à la cire, au fil et à la pince.' },
      pt: { titulo: 'Depilação', descripcion: 'Serviços de depilação manual com cera, linha e pinça.' },
    },
  },
  {
    slug: 'depilacion-laser',
    orden: 4,
    porLocale: {
      es: { titulo: 'Depilación Láser', descripcion: 'Depilación láser de alta precisión y resultados duraderos.' },
      ca: { titulo: 'Depilació Làser', descripcion: 'Depilació làser d’alta precisió i resultats duradors.' },
      en: { titulo: 'Laser hair removal', descripcion: 'Laser hair removal with high precision and long-lasting results.' },
      it: { titulo: 'Depilazione Laser', descripcion: 'Depilazione laser ad alta precisione e risultati duraturi.' },
      fr: { titulo: 'Épilation Laser', descripcion: 'Épilation laser haute précision aux résultats durables.' },
      pt: { titulo: 'Depilação Laser', descripcion: 'Depilação laser de alta precisão e resultados duradouros.' },
    },
  },
  {
    slug: 'unas',
    orden: 5,
    porLocale: {
      es: { titulo: 'Uñas', descripcion: 'Manicura y pedicura con acabados impecables.' },
      ca: { titulo: 'Ungles', descripcion: 'Manicura i pedicura amb acabats impecables.' },
      en: { titulo: 'Nails', descripcion: 'Manicure and pedicure with an impeccable finish.' },
      it: { titulo: 'Unghie', descripcion: 'Manicure e pedicure con una finitura impeccabile.' },
      fr: { titulo: 'Ongles', descripcion: 'Manucure et pédicure avec une finition impeccable.' },
      pt: { titulo: 'Unhas', descripcion: 'Manicure e pedicure com um acabamento impecável.' },
    },
  },
  {
    slug: 'masajes',
    orden: 6,
    porLocale: {
      es: { titulo: 'Masajes', descripcion: 'Técnicas de masaje y tratamientos corporales para liberar tensión y recuperar el equilibrio.' },
      ca: { titulo: 'Massatges', descripcion: 'Tècniques de massatge i tractaments corporals per alliberar tensió.' },
      en: { titulo: 'Massages', descripcion: 'Massage techniques and body treatments to release tension.' },
      it: { titulo: 'Massaggi', descripcion: 'Tecniche di massaggio e trattamenti corpo per liberare la tensione.' },
      fr: { titulo: 'Massages', descripcion: 'Techniques de massage et soins du corps pour relâcher les tensions.' },
      pt: { titulo: 'Massagens', descripcion: 'Técnicas de massagem e tratamentos corporais para libertar tensão.' },
    },
  },
]
