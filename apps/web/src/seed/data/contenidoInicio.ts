import type { Locale } from '@/lib/i18n/locales'

type ContenidoInicioSeedLocale = {
  heroTitulo: string
  heroSubtitulo: string
  introQuienSoy: string
  introFamilias: string
  introContacto: string
}

export const CONTENIDO_INICIO_SEED: Record<Locale, ContenidoInicioSeedLocale> = {
  es: {
    heroTitulo: 'Cuidamos de tu belleza\ncon la delicadeza y profesionalidad\nque mereces',
    heroSubtitulo: 'Tratamientos estéticos personalizados para resaltar tu mejor versión.',
    introQuienSoy: 'Descubre quién está detrás de cada tratamiento y la forma de trabajar de Diana.',
    introFamilias: 'Cada tratamiento está diseñado para ofrecerte resultados visibles y una experiencia de bienestar excepcional.',
    introContacto: '¿Lista para tu próxima cita? Ponte en contacto con nosotras.',
  },
  ca: {
    heroTitulo: 'Cuidem la teva bellesa\namb la delicadesa i professionalitat\nque mereixes',
    heroSubtitulo: 'Tractaments estètics personalitzats per realçar la teva millor versió.',
    introQuienSoy: 'Descobreix qui hi ha darrere de cada tractament i la manera de treballar de la Diana.',
    introFamilias: 'Cada tractament està dissenyat per oferir-te resultats visibles i una experiència de benestar excepcional.',
    introContacto: 'Preparada per a la teva propera cita? Posa’t en contacte amb nosaltres.',
  },
  en: {
    heroTitulo: 'We take care of your beauty\nwith the care and professionalism\nyou deserve',
    heroSubtitulo: 'Personalised aesthetic treatments to bring out your best self.',
    introQuienSoy: 'Discover who is behind every treatment and how Diana works.',
    introFamilias: 'Every treatment is designed to deliver visible results and an exceptional wellness experience.',
    introContacto: 'Ready for your next appointment? Get in touch with us.',
  },
  it: {
    heroTitulo: 'Ci prendiamo cura della tua bellezza\ncon la delicatezza e la professionalità\nche meriti',
    heroSubtitulo: 'Trattamenti estetici personalizzati per valorizzare la tua versione migliore.',
    introQuienSoy: 'Scopri chi c’è dietro ogni trattamento e il modo di lavorare di Diana.',
    introFamilias: 'Ogni trattamento è pensato per offrirti risultati visibili e un’esperienza di benessere eccezionale.',
    introContacto: 'Pronta per il tuo prossimo appuntamento? Contattaci.',
  },
  fr: {
    heroTitulo: 'Nous prenons soin de votre beauté\navec la délicatesse et le professionnalisme\nque vous méritez',
    heroSubtitulo: 'Des soins esthétiques personnalisés pour révéler votre meilleure version.',
    introQuienSoy: 'Découvrez qui se cache derrière chaque soin et la façon de travailler de Diana.',
    introFamilias: 'Chaque soin est conçu pour vous offrir des résultats visibles et une expérience de bien-être exceptionnelle.',
    introContacto: 'Prête pour votre prochain rendez-vous ? Contactez-nous.',
  },
  pt: {
    heroTitulo: 'Cuidamos da sua beleza\ncom a delicadeza e o profissionalismo\nque merece',
    heroSubtitulo: 'Tratamentos estéticos personalizados para realçar a sua melhor versão.',
    introQuienSoy: 'Descubra quem está por trás de cada tratamento e a forma de trabalhar da Diana.',
    introFamilias: 'Cada tratamento foi pensado para lhe proporcionar resultados visíveis e uma experiência de bem-estar excecional.',
    introContacto: 'Pronta para a sua próxima consulta? Entre em contacto connosco.',
  },
}
