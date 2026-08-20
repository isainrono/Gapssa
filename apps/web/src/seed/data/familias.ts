import type { Locale } from '@/lib/i18n/locales'

export type FamiliaSeed = {
  slug: string
  orden: number
  porLocale: Record<Locale, { titulo: string; descripcion: string }>
}

/** Las 6 familias validadas en `docs/espocrm-modelo-inicial.md` (mismos nombres que `CTratamiento.familia` en EspoCRM). */
export const FAMILIAS_SEED: FamiliaSeed[] = [
  {
    slug: 'masajes',
    orden: 1,
    porLocale: {
      es: { titulo: 'Masajes', descripcion: 'Técnicas de masaje para liberar tensión y recuperar el equilibrio del cuerpo.' },
      ca: { titulo: 'Massatges', descripcion: 'Tècniques de massatge per alliberar tensió i recuperar l’equilibri del cos.' },
      en: { titulo: 'Massages', descripcion: 'Massage techniques to release tension and restore balance to the body.' },
      it: { titulo: 'Massaggi', descripcion: 'Tecniche di massaggio per liberare la tensione e ritrovare l’equilibrio del corpo.' },
      fr: { titulo: 'Massages', descripcion: 'Des techniques de massage pour relâcher les tensions et retrouver l’équilibre du corps.' },
      pt: { titulo: 'Massagens', descripcion: 'Técnicas de massagem para libertar tensão e recuperar o equilíbrio do corpo.' },
    },
  },
  {
    slug: 'aparatologia',
    orden: 2,
    porLocale: {
      es: { titulo: 'Aparatología', descripcion: 'Tratamientos con tecnología especializada para el cuidado corporal.' },
      ca: { titulo: 'Aparatologia', descripcion: 'Tractaments amb tecnologia especialitzada per a la cura corporal.' },
      en: { titulo: 'Body technology', descripcion: 'Treatments using specialised technology for body care.' },
      it: { titulo: 'Apparecchiature', descripcion: 'Trattamenti con tecnologia specializzata per la cura del corpo.' },
      fr: { titulo: 'Appareillage', descripcion: 'Des soins utilisant une technologie spécialisée pour le corps.' },
      pt: { titulo: 'Aparelhologia', descripcion: 'Tratamentos com tecnologia especializada para o cuidado corporal.' },
    },
  },
  {
    slug: 'depilacion',
    orden: 3,
    porLocale: {
      es: { titulo: 'Depilación', descripcion: 'Servicios de depilación adaptados a cada zona y a tu piel.' },
      ca: { titulo: 'Depilació', descripcion: 'Serveis de depilació adaptats a cada zona i a la teva pell.' },
      en: { titulo: 'Hair removal', descripcion: 'Hair removal services adapted to each area and your skin.' },
      it: { titulo: 'Depilazione', descripcion: 'Servizi di depilazione adattati a ogni zona e alla tua pelle.' },
      fr: { titulo: 'Épilation', descripcion: 'Des services d’épilation adaptés à chaque zone et à votre peau.' },
      pt: { titulo: 'Depilação', descripcion: 'Serviços de depilação adaptados a cada zona e à sua pele.' },
    },
  },
  {
    slug: 'faciales',
    orden: 4,
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
    slug: 'pestanas-cejas',
    orden: 6,
    porLocale: {
      es: { titulo: 'Pestañas y cejas', descripcion: 'Realza tu mirada con tratamientos de pestañas y cejas.' },
      ca: { titulo: 'Pestanyes i celles', descripcion: 'Realça la teva mirada amb tractaments de pestanyes i celles.' },
      en: { titulo: 'Lashes and brows', descripcion: 'Enhance your eyes with lash and brow treatments.' },
      it: { titulo: 'Ciglia e sopracciglia', descripcion: 'Valorizza il tuo sguardo con trattamenti per ciglia e sopracciglia.' },
      fr: { titulo: 'Cils et sourcils', descripcion: 'Sublimez votre regard avec des soins cils et sourcils.' },
      pt: { titulo: 'Pestanas e sobrancelhas', descripcion: 'Realce o seu olhar com tratamentos de pestanas e sobrancelhas.' },
    },
  },
]
