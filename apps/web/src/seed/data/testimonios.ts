import type { Locale } from '@/lib/i18n/locales'

export type TestimonioSeed = {
  orden: number
  autorPorLocale: Record<Locale, string>
  textoPorLocale: Record<Locale, string>
}

/**
 * NO SON TESTIMONIOS REALES. Contenido editorial de referencia adaptado
 * libremente de `gapssa1/GAPSSA by Nana.dc (1).html` (no copiado
 * literalmente), anonimizado a nombre + inicial del apellido — nunca el
 * apellido completo (`Testimonios.ts`). Sirven solo para probar en
 * desarrollo que la sección de testimonios de la portada, el carrusel y el
 * filtrado por idioma funcionan — nunca para publicarse como experiencias
 * reales de clientas.
 *
 * Por eso `seedTestimonios` (`../index.ts`) los crea con `_status:
 * 'draft'`, `visible: false` y `autorizacionRegistrada: false`: nunca
 * llegan a la web pública (`publicContentAccess` exige `_status:
 * 'published'`; `getTestimonios`, `lib/content/testimonios.ts`, exige
 * además `visible` y `autorizacionRegistrada`). Sustituir por reseñas
 * reales, con autorización registrada, antes de publicar ninguna.
 */
export const TESTIMONIOS_SEED: TestimonioSeed[] = [
  {
    orden: 1,
    autorPorLocale: { es: 'María G.', ca: 'Maria G.', en: 'Maria G.', it: 'Maria G.', fr: 'Maria G.', pt: 'Maria G.' },
    textoPorLocale: {
      es: 'Una experiencia muy cuidada de principio a fin. Salí sintiéndome completamente renovada y con ganas de volver.',
      ca: 'Una experiència molt cuidada de principi a fi. Vaig sortir sentint-me completament renovada i amb ganes de tornar.',
      en: 'A carefully attended experience from start to finish. I left feeling completely renewed and looking forward to coming back.',
      it: 'Un’esperienza curata dall’inizio alla fine. Sono uscita sentendomi completamente rinnovata e con voglia di tornare.',
      fr: 'Une expérience très soignée du début à la fin. Je suis repartie complètement ressourcée, avec l’envie d’y retourner.',
      pt: 'Uma experiência muito cuidada do início ao fim. Saí a sentir-me completamente renovada e com vontade de voltar.',
    },
  },
  {
    orden: 2,
    autorPorLocale: { es: 'Laura M.', ca: 'Laura M.', en: 'Laura M.', it: 'Laura M.', fr: 'Laura M.', pt: 'Laura M.' },
    textoPorLocale: {
      es: 'El ambiente es precioso y la atención muy profesional. Se nota el cuidado en cada detalle.',
      ca: 'L’ambient és preciós i l’atenció molt professional. Es nota la cura en cada detall.',
      en: 'The atmosphere is lovely and the service very professional. You can tell every detail is taken care of.',
      it: 'L’ambiente è bellissimo e l’attenzione molto professionale. Si nota la cura in ogni dettaglio.',
      fr: 'Le cadre est magnifique et le service très professionnel. On sent le soin apporté à chaque détail.',
      pt: 'O ambiente é lindo e o atendimento muito profissional. Nota-se o cuidado em cada detalhe.',
    },
  },
  {
    orden: 3,
    autorPorLocale: { es: 'Carmen V.', ca: 'Carmen V.', en: 'Carmen V.', it: 'Carmen V.', fr: 'Carmen V.', pt: 'Carmen V.' },
    textoPorLocale: {
      es: 'Llevo tiempo viniendo y siempre encuentro un trato cercano y personalizado. Cada visita es diferente.',
      ca: 'Fa temps que hi vinc i sempre trobo un tracte proper i personalitzat. Cada visita és diferent.',
      en: 'I have been coming for a while and always find a warm, personal approach. Every visit feels different.',
      it: 'Vengo da tempo e trovo sempre un’accoglienza vicina e personalizzata. Ogni visita è diversa.',
      fr: 'Je viens depuis un moment et je retrouve toujours un accueil chaleureux et personnalisé. Chaque visite est différente.',
      pt: 'Venho há algum tempo e encontro sempre um atendimento próximo e personalizado. Cada visita é diferente.',
    },
  },
  {
    orden: 4,
    autorPorLocale: { es: 'Ana P.', ca: 'Ana P.', en: 'Ana P.', it: 'Ana P.', fr: 'Ana P.', pt: 'Ana P.' },
    textoPorLocale: {
      es: 'Me gusta que me asesoran sin presionar. Se toman el tiempo de entender lo que busco.',
      ca: 'M’agrada que m’assessoren sense pressionar. Es prenen el temps d’entendre el que busco.',
      en: 'I appreciate the guidance without any pressure. They take the time to understand what I am looking for.',
      it: 'Mi piace che mi consigliano senza fare pressione. Si prendono il tempo di capire cosa cerco.',
      fr: 'J’apprécie d’être conseillée sans pression. On prend le temps de comprendre ce que je recherche.',
      pt: 'Gosto que me aconselham sem pressionar. Dedicam tempo a perceber o que procuro.',
    },
  },
]
