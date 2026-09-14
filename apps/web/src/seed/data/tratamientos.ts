import type { Locale } from '@/lib/i18n/locales'

export type FaqSeed = { pregunta: string; respuesta: string }
export type SeoSeed = { titulo?: string; descripcion?: string }

export type TraduccionTratamiento = {
  titulo: string
  descripcion: string
  beneficios: string[]
  /** Solo cuando existe contenido real que traducir — nunca afirmaciones clínicas ni contraindicaciones médicas específicas. */
  requisitosContraindicaciones?: string
  preguntasFrecuentes?: FaqSeed[]
  seo?: SeoSeed
}

export type TratamientoSeed = {
  slug: string
  familiaSlug: string
  orden: number
  destacado?: boolean
  /**
   * `Record<Locale, ...>` en vez del antiguo `otros?: Partial<...>`: obliga
   * en tiempo de compilación a tener los 6 idiomas para cada tratamiento
   * (revisión 2 de Fase 2 — el fallback a español ya no cuenta como
   * traducción). Si falta una clave de idioma, TypeScript no compila.
   */
  porLocale: Record<Locale, TraduccionTratamiento>
}

/**
 * Los 57 conceptos enumerados en `PROJECT_CONTEXT.md` §4. Sin precio ni
 * duración (pertenecen a EspoCRM/FacturaScripts, no a Payload — ver
 * `Tratamientos.ts`). Los tratamientos de depilación no fijan técnica
 * (láser/cera/hilo): la matriz método×zona es una decisión pendiente
 * (`PROJECT_CONTEXT.md` §19), así que el texto queda neutro a propósito en
 * los 6 idiomas.
 *
 * Traducción inicial asistida y coherente, sin flujo de revisión editorial
 * obligatorio (`PLAN_DESARROLLO_WEB_PORTAL.md` §3.1) — no se afirman
 * resultados garantizados ni contraindicaciones clínicas en ningún idioma.
 */
export const TRATAMIENTOS_SEED: TratamientoSeed[] = [
  // ── Masajes ──────────────────────────────────────────────────────────
  {
    slug: 'masaje-relajante',
    familiaSlug: 'masajes',
    orden: 1,
    destacado: true,
    porLocale: {
      es: {
        titulo: 'Masaje relajante',
        descripcion: 'Técnicas suaves y envolventes para liberar tensión y recuperar la calma.',
        beneficios: ['Libera tensión acumulada', 'Favorece un descanso profundo', 'Experiencia pensada para desconectar'],
      },
      ca: {
        titulo: 'Massatge relaxant',
        descripcion: 'Tècniques suaus i envolupants per alliberar tensió i recuperar la calma.',
        beneficios: ['Allibera la tensió acumulada', 'Afavoreix un descans profund', 'Experiència pensada per desconnectar'],
      },
      en: {
        titulo: 'Relaxing massage',
        descripcion: 'Gentle, enveloping techniques to release tension and restore calm.',
        beneficios: ['Releases built-up tension', 'Promotes deep rest', 'An experience designed to help you unwind'],
      },
      it: {
        titulo: 'Massaggio rilassante',
        descripcion: 'Tecniche morbide e avvolgenti per liberare la tensione e ritrovare la calma.',
        beneficios: ['Libera la tensione accumulata', 'Favorisce un riposo profondo', 'Un’esperienza pensata per staccare la spina'],
      },
      fr: {
        titulo: 'Massage relaxant',
        descripcion: 'Des techniques douces et enveloppantes pour relâcher les tensions et retrouver le calme.',
        beneficios: ['Libère les tensions accumulées', 'Favorise un repos profond', 'Une expérience pensée pour déconnecter'],
      },
      pt: {
        titulo: 'Massagem relaxante',
        descripcion: 'Técnicas suaves e envolventes para libertar tensão e recuperar a calma.',
        beneficios: ['Liberta a tensão acumulada', 'Favorece um descanso profundo', 'Uma experiência pensada para desligar'],
      },
    },
  },
  {
    slug: 'masaje-descontracturante',
    familiaSlug: 'masajes',
    orden: 2,
    porLocale: {
      es: {
        titulo: 'Masaje descontracturante',
        descripcion: 'Presión localizada para aliviar la tensión muscular acumulada.',
        beneficios: ['Trabaja las zonas de mayor tensión', 'Mejora la sensación de movilidad'],
      },
      ca: {
        titulo: 'Massatge descontracturant',
        descripcion: 'Pressió localitzada per alleujar la tensió muscular acumulada.',
        beneficios: ['Treballa les zones de més tensió', 'Millora la sensació de mobilitat'],
      },
      en: {
        titulo: 'Deep tissue massage',
        descripcion: 'Targeted pressure to relieve built-up muscle tension.',
        beneficios: ['Focuses on the areas of greatest tension', 'Improves the feeling of mobility'],
      },
      it: {
        titulo: 'Massaggio decontratturante',
        descripcion: 'Pressione localizzata per alleviare la tensione muscolare accumulata.',
        beneficios: ['Agisce sulle zone di maggiore tensione', 'Migliora la sensazione di mobilità'],
      },
      fr: {
        titulo: 'Massage décontracturant',
        descripcion: 'Une pression ciblée pour soulager les tensions musculaires accumulées.',
        beneficios: ['Cible les zones les plus tendues', 'Améliore la sensation de mobilité'],
      },
      pt: {
        titulo: 'Massagem descontraturante',
        descripcion: 'Pressão localizada para aliviar a tensão muscular acumulada.',
        beneficios: ['Atua nas zonas de maior tensão', 'Melhora a sensação de mobilidade'],
      },
    },
  },
  {
    slug: 'masaje-deportivo',
    familiaSlug: 'masajes',
    orden: 3,
    porLocale: {
      es: {
        titulo: 'Masaje deportivo',
        descripcion: 'Pensado para acompañar la actividad física y la recuperación muscular.',
        beneficios: ['Ayuda a preparar o recuperar el músculo', 'Técnica adaptada a tu nivel de actividad'],
      },
      ca: {
        titulo: 'Massatge esportiu',
        descripcion: 'Pensat per acompanyar l’activitat física i la recuperació muscular.',
        beneficios: ['Ajuda a preparar o recuperar el múscul', 'Tècnica adaptada al teu nivell d’activitat'],
      },
      en: {
        titulo: 'Sports massage',
        descripcion: 'Designed to support physical activity and muscle recovery.',
        beneficios: ['Helps prepare or recover the muscle', 'Technique adapted to your activity level'],
      },
      it: {
        titulo: 'Massaggio sportivo',
        descripcion: 'Pensato per accompagnare l’attività fisica e il recupero muscolare.',
        beneficios: ['Aiuta a preparare o recuperare il muscolo', 'Tecnica adattata al tuo livello di attività'],
      },
      fr: {
        titulo: 'Massage sportif',
        descripcion: 'Conçu pour accompagner l’activité physique et la récupération musculaire.',
        beneficios: ['Aide à préparer ou récupérer le muscle', 'Technique adaptée à votre niveau d’activité'],
      },
      pt: {
        titulo: 'Massagem desportiva',
        descripcion: 'Pensada para acompanhar a atividade física e a recuperação muscular.',
        beneficios: ['Ajuda a preparar ou recuperar o músculo', 'Técnica adaptada ao seu nível de atividade'],
      },
    },
  },
  {
    slug: 'masaje-prenatal',
    familiaSlug: 'masajes',
    orden: 4,
    porLocale: {
      es: {
        titulo: 'Masaje prenatal',
        descripcion: 'Masaje suave adaptado a las necesidades del embarazo.',
        beneficios: ['Postura y presión adaptadas al embarazo', 'Momento de bienestar y calma'],
      },
      ca: {
        titulo: 'Massatge prenatal',
        descripcion: 'Massatge suau adaptat a les necessitats de l’embaràs.',
        beneficios: ['Postura i pressió adaptades a l’embaràs', 'Un moment de benestar i calma'],
      },
      en: {
        titulo: 'Prenatal massage',
        descripcion: 'Gentle massage adapted to the needs of pregnancy.',
        beneficios: ['Position and pressure adapted to pregnancy', 'A moment of wellbeing and calm'],
      },
      it: {
        titulo: 'Massaggio prenatale',
        descripcion: 'Massaggio delicato adattato alle esigenze della gravidanza.',
        beneficios: ['Postura e pressione adattate alla gravidanza', 'Un momento di benessere e calma'],
      },
      fr: {
        titulo: 'Massage prénatal',
        descripcion: 'Massage doux adapté aux besoins de la grossesse.',
        beneficios: ['Position et pression adaptées à la grossesse', 'Un moment de bien-être et de calme'],
      },
      pt: {
        titulo: 'Massagem pré-natal',
        descripcion: 'Massagem suave adaptada às necessidades da gravidez.',
        beneficios: ['Postura e pressão adaptadas à gravidez', 'Um momento de bem-estar e calma'],
      },
    },
  },
  {
    slug: 'masaje-aromaterapia',
    familiaSlug: 'masajes',
    orden: 5,
    porLocale: {
      es: {
        titulo: 'Masaje de aromaterapia',
        descripcion: 'Aceites esenciales seleccionados que acompañan la relajación durante el masaje.',
        beneficios: ['Estimula los sentidos además del tacto', 'Experiencia sensorial completa'],
      },
      ca: {
        titulo: 'Massatge d’aromateràpia',
        descripcion: 'Olis essencials seleccionats que acompanyen la relaxació durant el massatge.',
        beneficios: ['Estimula els sentits a més del tacte', 'Experiència sensorial completa'],
      },
      en: {
        titulo: 'Aromatherapy massage',
        descripcion: 'Selected essential oils that enhance relaxation throughout the massage.',
        beneficios: ['Stimulates the senses beyond touch', 'A complete sensory experience'],
      },
      it: {
        titulo: 'Massaggio aromaterapico',
        descripcion: 'Oli essenziali selezionati che accompagnano il rilassamento durante il massaggio.',
        beneficios: ['Stimola i sensi oltre al tatto', 'Un’esperienza sensoriale completa'],
      },
      fr: {
        titulo: 'Massage aromathérapie',
        descripcion: 'Des huiles essentielles sélectionnées qui accompagnent la relaxation pendant le massage.',
        beneficios: ['Stimule les sens au-delà du toucher', 'Une expérience sensorielle complète'],
      },
      pt: {
        titulo: 'Massagem de aromaterapia',
        descripcion: 'Óleos essenciais selecionados que acompanham o relaxamento durante a massagem.',
        beneficios: ['Estimula os sentidos para além do tato', 'Uma experiência sensorial completa'],
      },
    },
  },
  {
    slug: 'masaje-craneofacial',
    familiaSlug: 'masajes',
    orden: 6,
    porLocale: {
      es: {
        titulo: 'Masaje craneofacial',
        descripcion: 'Masaje centrado en cuero cabelludo, cuello y rostro para liberar tensión.',
        beneficios: ['Alivia la tensión de cuello y cabeza', 'Sensación de ligereza inmediata'],
      },
      ca: {
        titulo: 'Massatge craniofacial',
        descripcion: 'Massatge centrat en el cuir cabellut, el coll i el rostre per alliberar tensió.',
        beneficios: ['Alleuja la tensió de coll i cap', 'Sensació de lleugeresa immediata'],
      },
      en: {
        titulo: 'Head and face massage',
        descripcion: 'A massage focused on the scalp, neck and face to release tension.',
        beneficios: ['Eases neck and head tension', 'An immediate feeling of lightness'],
      },
      it: {
        titulo: 'Massaggio craniofacciale',
        descripcion: 'Massaggio incentrato su cuoio capelluto, collo e viso per liberare la tensione.',
        beneficios: ['Allevia la tensione di collo e testa', 'Sensazione di leggerezza immediata'],
      },
      fr: {
        titulo: 'Massage crânio-facial',
        descripcion: 'Un massage centré sur le cuir chevelu, la nuque et le visage pour relâcher les tensions.',
        beneficios: ['Soulage les tensions du cou et de la tête', 'Une sensation de légèreté immédiate'],
      },
      pt: {
        titulo: 'Massagem craniofacial',
        descripcion: 'Massagem centrada no couro cabeludo, pescoço e rosto para libertar tensão.',
        beneficios: ['Alivia a tensão do pescoço e da cabeça', 'Sensação imediata de leveza'],
      },
    },
  },
  {
    slug: 'masaje-facial',
    familiaSlug: 'masajes',
    orden: 7,
    porLocale: {
      es: {
        titulo: 'Masaje facial',
        descripcion: 'Maniobras específicas para relajar la musculatura del rostro.',
        beneficios: ['Relaja la musculatura facial', 'Complementa tu rutina de cuidado facial'],
      },
      ca: {
        titulo: 'Massatge facial',
        descripcion: 'Maniobres específiques per relaxar la musculatura del rostre.',
        beneficios: ['Relaxa la musculatura facial', 'Complementa la teva rutina de cura facial'],
      },
      en: {
        titulo: 'Facial massage',
        descripcion: 'Specific movements to relax the facial muscles.',
        beneficios: ['Relaxes the facial muscles', 'Complements your facial care routine'],
      },
      it: {
        titulo: 'Massaggio facciale',
        descripcion: 'Manovre specifiche per rilassare la muscolatura del viso.',
        beneficios: ['Rilassa la muscolatura del viso', 'Completa la tua routine di cura del viso'],
      },
      fr: {
        titulo: 'Massage du visage',
        descripcion: 'Des manœuvres spécifiques pour détendre les muscles du visage.',
        beneficios: ['Détend les muscles du visage', 'Complète votre routine de soin du visage'],
      },
      pt: {
        titulo: 'Massagem facial',
        descripcion: 'Manobras específicas para relaxar a musculatura do rosto.',
        beneficios: ['Relaxa a musculatura facial', 'Complementa a sua rotina de cuidado facial'],
      },
    },
  },
  {
    slug: 'masaje-piernas-cansadas',
    familiaSlug: 'masajes',
    orden: 8,
    porLocale: {
      es: {
        titulo: 'Masaje piernas cansadas',
        descripcion: 'Maniobras ascendentes pensadas para aliviar la sensación de piernas pesadas.',
        beneficios: ['Sensación de ligereza en las piernas', 'Ideal tras largas jornadas de pie'],
      },
      ca: {
        titulo: 'Massatge de cames cansades',
        descripcion: 'Maniobres ascendents pensades per alleujar la sensació de cames pesades.',
        beneficios: ['Sensació de lleugeresa a les cames', 'Ideal després de llargues jornades dretes'],
      },
      en: {
        titulo: 'Tired legs massage',
        descripcion: 'Upward strokes designed to relieve the feeling of heavy legs.',
        beneficios: ['A feeling of lightness in the legs', 'Ideal after long days on your feet'],
      },
      it: {
        titulo: 'Massaggio gambe stanche',
        descripcion: 'Manovre ascendenti pensate per alleviare la sensazione di gambe pesanti.',
        beneficios: ['Sensazione di leggerezza nelle gambe', 'Ideale dopo lunghe giornate in piedi'],
      },
      fr: {
        titulo: 'Massage jambes lourdes',
        descripcion: 'Des manœuvres ascendantes pensées pour soulager la sensation de jambes lourdes.',
        beneficios: ['Une sensation de légèreté dans les jambes', 'Idéal après de longues journées debout'],
      },
      pt: {
        titulo: 'Massagem pernas cansadas',
        descripcion: 'Manobras ascendentes pensadas para aliviar a sensação de pernas pesadas.',
        beneficios: ['Sensação de leveza nas pernas', 'Ideal após longos dias em pé'],
      },
    },
  },
  {
    slug: 'masaje-relajante-pies',
    familiaSlug: 'masajes',
    orden: 9,
    porLocale: {
      es: {
        titulo: 'Masaje relajante de pies',
        descripcion: 'Un momento de cuidado dedicado por completo a tus pies.',
        beneficios: ['Alivia la fatiga del día a día', 'Ideal para combinar con otros tratamientos'],
      },
      ca: {
        titulo: 'Massatge relaxant de peus',
        descripcion: 'Un moment de cura dedicat completament als teus peus.',
        beneficios: ['Alleuja la fatiga del dia a dia', 'Ideal per combinar amb altres tractaments'],
      },
      en: {
        titulo: 'Relaxing foot massage',
        descripcion: 'A moment of care dedicated entirely to your feet.',
        beneficios: ['Eases everyday fatigue', 'Ideal to combine with other treatments'],
      },
      it: {
        titulo: 'Massaggio rilassante ai piedi',
        descripcion: 'Un momento di cura dedicato interamente ai tuoi piedi.',
        beneficios: ['Allevia la stanchezza quotidiana', 'Ideale da abbinare ad altri trattamenti'],
      },
      fr: {
        titulo: 'Massage relaxant des pieds',
        descripcion: 'Un moment de soin entièrement dédié à vos pieds.',
        beneficios: ['Soulage la fatigue du quotidien', 'Idéal à combiner avec d’autres soins'],
      },
      pt: {
        titulo: 'Massagem relaxante de pés',
        descripcion: 'Um momento de cuidado dedicado inteiramente aos seus pés.',
        beneficios: ['Alivia o cansaço do dia a dia', 'Ideal para combinar com outros tratamentos'],
      },
    },
  },
  {
    slug: 'reflexologia-podal',
    familiaSlug: 'masajes',
    orden: 10,
    porLocale: {
      es: {
        titulo: 'Reflexología podal',
        descripcion: 'Presión específica en puntos concretos de la planta del pie.',
        beneficios: ['Técnica precisa y localizada', 'Un ritual de bienestar diferente'],
      },
      ca: {
        titulo: 'Reflexologia podal',
        descripcion: 'Pressió específica en punts concrets de la planta del peu.',
        beneficios: ['Tècnica precisa i localitzada', 'Un ritual de benestar diferent'],
      },
      en: {
        titulo: 'Foot reflexology',
        descripcion: 'Specific pressure on particular points of the sole of the foot.',
        beneficios: ['A precise, targeted technique', 'A different kind of wellbeing ritual'],
      },
      it: {
        titulo: 'Riflessologia plantare',
        descripcion: 'Pressione specifica su punti precisi della pianta del piede.',
        beneficios: ['Tecnica precisa e localizzata', 'Un rituale di benessere diverso'],
      },
      fr: {
        titulo: 'Réflexologie plantaire',
        descripcion: 'Une pression spécifique sur des points précis de la plante du pied.',
        beneficios: ['Une technique précise et ciblée', 'Un rituel bien-être différent'],
      },
      pt: {
        titulo: 'Reflexologia podal',
        descripcion: 'Pressão específica em pontos concretos da planta do pé.',
        beneficios: ['Técnica precisa e localizada', 'Um ritual de bem-estar diferente'],
      },
    },
  },
  {
    slug: 'drenaje-manual',
    familiaSlug: 'masajes',
    orden: 11,
    porLocale: {
      es: {
        titulo: 'Drenaje manual',
        descripcion: 'Maniobras suaves y rítmicas pensadas para activar la circulación.',
        beneficios: ['Sensación de ligereza corporal', 'Técnica suave y progresiva'],
      },
      ca: {
        titulo: 'Drenatge manual',
        descripcion: 'Maniobres suaus i rítmiques pensades per activar la circulació.',
        beneficios: ['Sensació de lleugeresa corporal', 'Tècnica suau i progressiva'],
      },
      en: {
        titulo: 'Manual drainage',
        descripcion: 'Gentle, rhythmic movements designed to boost circulation.',
        beneficios: ['A feeling of bodily lightness', 'A gentle, progressive technique'],
      },
      it: {
        titulo: 'Drenaggio manuale',
        descripcion: 'Manovre delicate e ritmiche pensate per attivare la circolazione.',
        beneficios: ['Sensazione di leggerezza corporea', 'Tecnica delicata e progressiva'],
      },
      fr: {
        titulo: 'Drainage manuel',
        descripcion: 'Des manœuvres douces et rythmées pensées pour stimuler la circulation.',
        beneficios: ['Une sensation de légèreté corporelle', 'Une technique douce et progressive'],
      },
      pt: {
        titulo: 'Drenagem manual',
        descripcion: 'Manobras suaves e rítmicas pensadas para ativar a circulação.',
        beneficios: ['Sensação de leveza corporal', 'Técnica suave e progressiva'],
      },
    },
  },
  {
    slug: 'piedras-calientes',
    familiaSlug: 'masajes',
    orden: 12,
    porLocale: {
      es: {
        titulo: 'Masaje con piedras calientes',
        descripcion: 'El calor de las piedras volcánicas acompaña el masaje corporal.',
        beneficios: ['Calor envolvente que intensifica la relajación', 'Experiencia sensorial distinta'],
      },
      ca: {
        titulo: 'Massatge amb pedres calentes',
        descripcion: 'La calor de les pedres volcàniques acompanya el massatge corporal.',
        beneficios: ['Calor envolupant que intensifica la relaxació', 'Experiència sensorial diferent'],
      },
      en: {
        titulo: 'Hot stone massage',
        descripcion: 'The warmth of volcanic stones enhances the body massage.',
        beneficios: ['Enveloping heat that deepens relaxation', 'A distinctive sensory experience'],
      },
      it: {
        titulo: 'Massaggio con pietre calde',
        descripcion: 'Il calore delle pietre vulcaniche accompagna il massaggio corporeo.',
        beneficios: ['Un calore avvolgente che intensifica il rilassamento', 'Un’esperienza sensoriale diversa'],
      },
      fr: {
        titulo: 'Massage aux pierres chaudes',
        descripcion: 'La chaleur des pierres volcaniques accompagne le massage corporel.',
        beneficios: ['Une chaleur enveloppante qui intensifie la détente', 'Une expérience sensorielle différente'],
      },
      pt: {
        titulo: 'Massagem com pedras quentes',
        descripcion: 'O calor das pedras vulcânicas acompanha a massagem corporal.',
        beneficios: ['Calor envolvente que intensifica o relaxamento', 'Uma experiência sensorial diferente'],
      },
    },
  },
  {
    slug: 'exfoliacion-corporal',
    familiaSlug: 'masajes',
    orden: 13,
    porLocale: {
      es: {
        titulo: 'Exfoliación corporal',
        descripcion: 'Ritual de exfoliación para dejar la piel del cuerpo suave y renovada.',
        beneficios: ['Piel visiblemente más suave', 'Buen paso previo a otros tratamientos corporales'],
      },
      ca: {
        titulo: 'Exfoliació corporal',
        descripcion: 'Ritual d’exfoliació per deixar la pell del cos suau i renovada.',
        beneficios: ['Pell visiblement més suau', 'Un bon pas previ a altres tractaments corporals'],
      },
      en: {
        titulo: 'Body exfoliation',
        descripcion: 'An exfoliation ritual that leaves the skin smooth and renewed.',
        beneficios: ['Visibly smoother skin', 'A good first step before other body treatments'],
      },
      it: {
        titulo: 'Scrub corpo',
        descripcion: 'Un rituale di scrub per lasciare la pelle del corpo morbida e rinnovata.',
        beneficios: ['Pelle visibilmente più morbida', 'Un buon punto di partenza per altri trattamenti corpo'],
      },
      fr: {
        titulo: 'Gommage corporel',
        descripcion: 'Un rituel d’exfoliation pour laisser la peau du corps douce et renouvelée.',
        beneficios: ['Une peau visiblement plus douce', 'Une bonne étape avant d’autres soins du corps'],
      },
      pt: {
        titulo: 'Esfoliação corporal',
        descripcion: 'Ritual de esfoliação para deixar a pele do corpo suave e renovada.',
        beneficios: ['Pele visivelmente mais suave', 'Um bom passo prévio para outros tratamentos corporais'],
      },
    },
  },

  // ── Aparatología Corporal (masajes) ──────────────────────────────────
  {
    slug: 'presoterapia',
    familiaSlug: 'masajes',
    orden: 14,
    porLocale: {
      es: {
        titulo: 'Presoterapia',
        descripcion: 'Compresión progresiva mediante aparatología especializada.',
        beneficios: ['Sensación de piernas más ligeras', 'Sesión cómoda y guiada'],
      },
      ca: {
        titulo: 'Pressoteràpia',
        descripcion: 'Compressió progressiva mitjançant aparatologia especialitzada.',
        beneficios: ['Sensació de cames més lleugeres', 'Sessió còmoda i guiada'],
      },
      en: {
        titulo: 'Pressotherapy',
        descripcion: 'Progressive compression using specialised equipment.',
        beneficios: ['A feeling of lighter legs', 'A comfortable, guided session'],
      },
      it: {
        titulo: 'Pressoterapia',
        descripcion: 'Compressione progressiva mediante apparecchiature specializzate.',
        beneficios: ['Sensazione di gambe più leggere', 'Seduta comoda e guidata'],
      },
      fr: {
        titulo: 'Pressothérapie',
        descripcion: 'Une compression progressive à l’aide d’un appareil spécialisé.',
        beneficios: ['Une sensation de jambes plus légères', 'Une séance confortable et guidée'],
      },
      pt: {
        titulo: 'Pressoterapia',
        descripcion: 'Compressão progressiva através de aparelhologia especializada.',
        beneficios: ['Sensação de pernas mais leves', 'Sessão confortável e guiada'],
      },
    },
  },
  {
    slug: 'presoterapia-masaje',
    familiaSlug: 'masajes',
    orden: 15,
    porLocale: {
      es: {
        titulo: 'Presoterapia + masaje',
        descripcion: 'Combina la presoterapia con un masaje complementario.',
        beneficios: ['Combina tecnología y trabajo manual', 'Experiencia más completa en una sola sesión'],
      },
      ca: {
        titulo: 'Pressoteràpia + massatge',
        descripcion: 'Combina la pressoteràpia amb un massatge complementari.',
        beneficios: ['Combina tecnologia i treball manual', 'Experiència més completa en una sola sessió'],
      },
      en: {
        titulo: 'Pressotherapy + massage',
        descripcion: 'Combines pressotherapy with a complementary massage.',
        beneficios: ['Combines technology and hands-on work', 'A more complete experience in a single session'],
      },
      it: {
        titulo: 'Pressoterapia + massaggio',
        descripcion: 'Combina la pressoterapia con un massaggio complementare.',
        beneficios: ['Unisce tecnologia e lavoro manuale', 'Un’esperienza più completa in un’unica seduta'],
      },
      fr: {
        titulo: 'Pressothérapie + massage',
        descripcion: 'Associe la pressothérapie à un massage complémentaire.',
        beneficios: ['Combine technologie et travail manuel', 'Une expérience plus complète en une seule séance'],
      },
      pt: {
        titulo: 'Pressoterapia + massagem',
        descripcion: 'Combina a pressoterapia com uma massagem complementar.',
        beneficios: ['Combina tecnologia e trabalho manual', 'Uma experiência mais completa numa única sessão'],
      },
    },
  },
  {
    slug: 'lipolaser-radiofrecuencia',
    familiaSlug: 'masajes',
    orden: 16,
    destacado: true,
    porLocale: {
      es: {
        titulo: 'Lipoláser + radiofrecuencia',
        descripcion: 'Tecnología combinada orientada al cuidado corporal y la firmeza de la piel.',
        beneficios: ['Protocolo con tecnología especializada', 'Sesión personalizada según tu piel', 'Seguimiento de tu progreso'],
      },
      ca: {
        titulo: 'Lipoläser + radiofreqüència',
        descripcion: 'Tecnologia combinada orientada a la cura corporal i la fermesa de la pell.',
        beneficios: ['Protocol amb tecnologia especialitzada', 'Sessió personalitzada segons la teva pell', 'Seguiment del teu progrés'],
      },
      en: {
        titulo: 'Lipolaser + radiofrequency',
        descripcion: 'Combined technology focused on body care and skin firmness.',
        beneficios: ['A protocol using specialised technology', 'A session personalised to your skin', 'Progress follow-up'],
      },
      it: {
        titulo: 'Lipolaser + radiofrequenza',
        descripcion: 'Tecnologia combinata orientata alla cura del corpo e alla compattezza della pelle.',
        beneficios: ['Protocollo con tecnologia specializzata', 'Seduta personalizzata in base alla tua pelle', 'Monitoraggio dei tuoi progressi'],
      },
      fr: {
        titulo: 'Lipolaser + radiofréquence',
        descripcion: 'Une technologie combinée dédiée au soin du corps et à la fermeté de la peau.',
        beneficios: ['Un protocole avec une technologie spécialisée', 'Une séance personnalisée selon votre peau', 'Un suivi de vos progrès'],
      },
      pt: {
        titulo: 'Lipolaser + radiofrequência',
        descripcion: 'Tecnologia combinada orientada ao cuidado corporal e à firmeza da pele.',
        beneficios: ['Protocolo com tecnologia especializada', 'Sessão personalizada de acordo com a sua pele', 'Acompanhamento do seu progresso'],
      },
    },
  },
  {
    slug: 'vacum',
    familiaSlug: 'masajes',
    orden: 17,
    porLocale: {
      es: {
        titulo: 'Vacum',
        descripcion: 'Tratamiento corporal mediante succión controlada.',
        beneficios: ['Técnica específica de aparatología', 'Sesión adaptada a la zona a tratar'],
      },
      ca: {
        titulo: 'Vacum',
        descripcion: 'Tractament corporal mitjançant succió controlada.',
        beneficios: ['Tècnica específica d’aparatologia', 'Sessió adaptada a la zona a tractar'],
      },
      en: {
        titulo: 'Vacuum therapy',
        descripcion: 'A body treatment using controlled suction.',
        beneficios: ['A specific equipment-based technique', 'A session adapted to the area being treated'],
      },
      it: {
        titulo: 'Vacum',
        descripcion: 'Trattamento corporeo mediante suzione controllata.',
        beneficios: ['Tecnica specifica di apparecchiature', 'Seduta adattata alla zona da trattare'],
      },
      fr: {
        titulo: 'Vacuothérapie',
        descripcion: 'Un soin corporel par aspiration contrôlée.',
        beneficios: ['Une technique spécifique d’appareillage', 'Une séance adaptée à la zone à traiter'],
      },
      pt: {
        titulo: 'Vacuoterapia',
        descripcion: 'Tratamento corporal através de sucção controlada.',
        beneficios: ['Técnica específica de aparelhologia', 'Sessão adaptada à zona a tratar'],
      },
    },
  },
  {
    slug: 'laser-fisio-dolor',
    familiaSlug: 'masajes',
    orden: 18,
    porLocale: {
      es: {
        titulo: 'Láser fisio dolor',
        descripcion: 'Aparatología orientada al bienestar muscular y articular.',
        beneficios: ['Sesión guiada por profesional', 'Tecnología específica de fisioterapia'],
      },
      ca: {
        titulo: 'Làser fisio dolor',
        descripcion: 'Aparatologia orientada al benestar muscular i articular.',
        beneficios: ['Sessió guiada per professional', 'Tecnologia específica de fisioteràpia'],
      },
      en: {
        titulo: 'Pain-relief laser therapy',
        descripcion: 'Equipment-based treatment focused on muscle and joint wellbeing.',
        beneficios: ['A session guided by a professional', 'Specific physiotherapy technology'],
      },
      it: {
        titulo: 'Laser fisioterapico antidolore',
        descripcion: 'Apparecchiatura orientata al benessere muscolare e articolare.',
        beneficios: ['Seduta guidata da un professionista', 'Tecnologia specifica di fisioterapia'],
      },
      fr: {
        titulo: 'Laser physio anti-douleur',
        descripcion: 'Un appareil dédié au bien-être musculaire et articulaire.',
        beneficios: ['Une séance guidée par une professionnelle', 'Une technologie spécifique de physiothérapie'],
      },
      pt: {
        titulo: 'Laser fisio dor',
        descripcion: 'Aparelhologia orientada para o bem-estar muscular e articular.',
        beneficios: ['Sessão guiada por profissional', 'Tecnologia específica de fisioterapia'],
      },
    },
  },

  // ── Depilación ───────────────────────────────────────────────────────
  {
    slug: 'depilacion-diseno-cejas',
    familiaSlug: 'depilacion',
    orden: 1,
    porLocale: {
      es: {
        titulo: 'Diseño de cejas',
        descripcion: 'Definición y forma de cejas adaptada a tus facciones.',
        beneficios: ['Resultado a medida de tu rostro', 'Técnica precisa'],
      },
      ca: {
        titulo: 'Disseny de celles',
        descripcion: 'Definició i forma de celles adaptada als teus trets.',
        beneficios: ['Resultat fet a mida del teu rostre', 'Tècnica precisa'],
      },
      en: {
        titulo: 'Eyebrow shaping',
        descripcion: 'Eyebrow definition and shape adapted to your features.',
        beneficios: ['A result tailored to your face', 'A precise technique'],
      },
      it: {
        titulo: 'Disegno delle sopracciglia',
        descripcion: 'Definizione e forma delle sopracciglia adattate ai tuoi lineamenti.',
        beneficios: ['Un risultato su misura per il tuo viso', 'Tecnica precisa'],
      },
      fr: {
        titulo: 'Dessin des sourcils',
        descripcion: 'Une définition et une forme des sourcils adaptées à vos traits.',
        beneficios: ['Un résultat sur mesure pour votre visage', 'Une technique précise'],
      },
      pt: {
        titulo: 'Design de sobrancelhas',
        descripcion: 'Definição e forma de sobrancelhas adaptada aos seus traços.',
        beneficios: ['Um resultado à medida do seu rosto', 'Técnica precisa'],
      },
    },
  },
  {
    slug: 'depilacion-cejas',
    familiaSlug: 'depilacion',
    orden: 2,
    porLocale: {
      es: {
        titulo: 'Depilación de cejas',
        descripcion: 'Mantenimiento de la forma de las cejas.',
        beneficios: ['Mirada siempre cuidada', 'Servicio rápido de mantenimiento'],
      },
      ca: {
        titulo: 'Depilació de celles',
        descripcion: 'Manteniment de la forma de les celles.',
        beneficios: ['Mirada sempre cuidada', 'Servei ràpid de manteniment'],
      },
      en: {
        titulo: 'Eyebrow hair removal',
        descripcion: 'Maintaining the shape of your eyebrows.',
        beneficios: ['A consistently well-groomed look', 'A quick maintenance service'],
      },
      it: {
        titulo: 'Depilazione sopracciglia',
        descripcion: 'Mantenimento della forma delle sopracciglia.',
        beneficios: ['Uno sguardo sempre curato', 'Servizio rapido di mantenimento'],
      },
      fr: {
        titulo: 'Épilation des sourcils',
        descripcion: 'Entretien de la forme des sourcils.',
        beneficios: ['Un regard toujours soigné', 'Un service d’entretien rapide'],
      },
      pt: {
        titulo: 'Depilação de sobrancelhas',
        descripcion: 'Manutenção da forma das sobrancelhas.',
        beneficios: ['Olhar sempre cuidado', 'Serviço rápido de manutenção'],
      },
    },
  },
  {
    slug: 'depilacion-labio-superior',
    familiaSlug: 'depilacion',
    orden: 3,
    porLocale: {
      es: {
        titulo: 'Depilación labio superior',
        descripcion: 'Depilación precisa de la zona del labio superior.',
        beneficios: ['Técnica delicada', 'Resultado natural'],
      },
      ca: {
        titulo: 'Depilació del llavi superior',
        descripcion: 'Depilació precisa de la zona del llavi superior.',
        beneficios: ['Tècnica delicada', 'Resultat natural'],
      },
      en: {
        titulo: 'Upper lip hair removal',
        descripcion: 'Precise hair removal of the upper lip area.',
        beneficios: ['A delicate technique', 'A natural-looking result'],
      },
      it: {
        titulo: 'Depilazione labbro superiore',
        descripcion: 'Depilazione precisa della zona del labbro superiore.',
        beneficios: ['Tecnica delicata', 'Risultato naturale'],
      },
      fr: {
        titulo: 'Épilation lèvre supérieure',
        descripcion: 'Une épilation précise de la zone de la lèvre supérieure.',
        beneficios: ['Une technique délicate', 'Un résultat naturel'],
      },
      pt: {
        titulo: 'Depilação do lábio superior',
        descripcion: 'Depilação precisa da zona do lábio superior.',
        beneficios: ['Técnica delicada', 'Resultado natural'],
      },
    },
  },
  {
    slug: 'depilacion-menton',
    familiaSlug: 'depilacion',
    orden: 4,
    porLocale: {
      es: {
        titulo: 'Depilación mentón',
        descripcion: 'Depilación específica de la zona del mentón.',
        beneficios: ['Técnica precisa y delicada', 'Servicio breve'],
      },
      ca: {
        titulo: 'Depilació de la barbeta',
        descripcion: 'Depilació específica de la zona de la barbeta.',
        beneficios: ['Tècnica precisa i delicada', 'Servei breu'],
      },
      en: {
        titulo: 'Chin hair removal',
        descripcion: 'Specific hair removal of the chin area.',
        beneficios: ['A precise, gentle technique', 'A brief service'],
      },
      it: {
        titulo: 'Depilazione mento',
        descripcion: 'Depilazione specifica della zona del mento.',
        beneficios: ['Tecnica precisa e delicata', 'Servizio breve'],
      },
      fr: {
        titulo: 'Épilation du menton',
        descripcion: 'Une épilation spécifique de la zone du menton.',
        beneficios: ['Une technique précise et délicate', 'Un service bref'],
      },
      pt: {
        titulo: 'Depilação do queixo',
        descripcion: 'Depilação específica da zona do queixo.',
        beneficios: ['Técnica precisa e delicada', 'Serviço breve'],
      },
    },
  },
  {
    slug: 'depilacion-patillas',
    familiaSlug: 'depilacion',
    orden: 5,
    porLocale: {
      es: {
        titulo: 'Depilación de patillas',
        descripcion: 'Depilación de la zona de las patillas.',
        beneficios: ['Definición del contorno facial', 'Servicio rápido'],
      },
      ca: {
        titulo: 'Depilació de patilles',
        descripcion: 'Depilació de la zona de les patilles.',
        beneficios: ['Definició del contorn facial', 'Servei ràpid'],
      },
      en: {
        titulo: 'Sideburns hair removal',
        descripcion: 'Hair removal of the sideburns area.',
        beneficios: ['Defines the facial contour', 'A quick service'],
      },
      it: {
        titulo: 'Depilazione basette',
        descripcion: 'Depilazione della zona delle basette.',
        beneficios: ['Definizione del contorno del viso', 'Servizio rapido'],
      },
      fr: {
        titulo: 'Épilation des favoris',
        descripcion: 'Une épilation de la zone des favoris.',
        beneficios: ['Définit le contour du visage', 'Un service rapide'],
      },
      pt: {
        titulo: 'Depilação de suíças',
        descripcion: 'Depilação da zona das suíças.',
        beneficios: ['Definição do contorno facial', 'Serviço rápido'],
      },
    },
  },
  {
    slug: 'depilacion-facial-completa',
    familiaSlug: 'depilacion',
    orden: 6,
    porLocale: {
      es: {
        titulo: 'Depilación facial completa',
        descripcion: 'Depilación del conjunto del rostro en una misma sesión.',
        beneficios: ['Ahorra tiempo frente a zonas por separado', 'Resultado homogéneo'],
      },
      ca: {
        titulo: 'Depilació facial completa',
        descripcion: 'Depilació de tot el rostre en una mateixa sessió.',
        beneficios: ['Estalvia temps respecte a fer les zones per separat', 'Resultat homogeni'],
      },
      en: {
        titulo: 'Full face hair removal',
        descripcion: 'Hair removal of the whole face in a single session.',
        beneficios: ['Saves time compared to separate areas', 'A uniform result'],
      },
      it: {
        titulo: 'Depilazione viso completa',
        descripcion: 'Depilazione dell’intero viso in un’unica seduta.',
        beneficios: ['Fa risparmiare tempo rispetto alle zone separate', 'Risultato omogeneo'],
      },
      fr: {
        titulo: 'Épilation complète du visage',
        descripcion: 'Une épilation de l’ensemble du visage en une seule séance.',
        beneficios: ['Un gain de temps par rapport aux zones séparées', 'Un résultat homogène'],
      },
      pt: {
        titulo: 'Depilação facial completa',
        descripcion: 'Depilação de todo o rosto numa única sessão.',
        beneficios: ['Poupa tempo em comparação com zonas separadas', 'Resultado homogéneo'],
      },
    },
  },
  {
    slug: 'depilacion-axilas',
    familiaSlug: 'depilacion',
    orden: 7,
    porLocale: {
      es: {
        titulo: 'Depilación de axilas',
        descripcion: 'Depilación de la zona de las axilas.',
        beneficios: ['Servicio ágil', 'Piel cuidada al finalizar'],
      },
      ca: {
        titulo: 'Depilació d’aixelles',
        descripcion: 'Depilació de la zona de les aixelles.',
        beneficios: ['Servei àgil', 'Pell cuidada en acabar'],
      },
      en: {
        titulo: 'Underarm hair removal',
        descripcion: 'Hair removal of the underarm area.',
        beneficios: ['A quick service', 'Cared-for skin afterwards'],
      },
      it: {
        titulo: 'Depilazione ascelle',
        descripcion: 'Depilazione della zona delle ascelle.',
        beneficios: ['Servizio rapido', 'Pelle curata al termine'],
      },
      fr: {
        titulo: 'Épilation des aisselles',
        descripcion: 'Une épilation de la zone des aisselles.',
        beneficios: ['Un service rapide', 'Une peau soignée à la fin'],
      },
      pt: {
        titulo: 'Depilação de axilas',
        descripcion: 'Depilação da zona das axilas.',
        beneficios: ['Serviço ágil', 'Pele cuidada no final'],
      },
    },
  },
  {
    slug: 'depilacion-espalda',
    familiaSlug: 'depilacion',
    orden: 8,
    porLocale: {
      es: {
        titulo: 'Depilación de espalda',
        descripcion: 'Depilación de la zona completa de la espalda.',
        beneficios: ['Cubre toda la superficie de la espalda', 'Sesión cómoda'],
      },
      ca: {
        titulo: 'Depilació d’esquena',
        descripcion: 'Depilació de tota la zona de l’esquena.',
        beneficios: ['Cobreix tota la superfície de l’esquena', 'Sessió còmoda'],
      },
      en: {
        titulo: 'Back hair removal',
        descripcion: 'Hair removal of the entire back area.',
        beneficios: ['Covers the whole surface of the back', 'A comfortable session'],
      },
      it: {
        titulo: 'Depilazione schiena',
        descripcion: 'Depilazione dell’intera zona della schiena.',
        beneficios: ['Copre tutta la superficie della schiena', 'Seduta confortevole'],
      },
      fr: {
        titulo: 'Épilation du dos',
        descripcion: 'Une épilation de toute la zone du dos.',
        beneficios: ['Couvre toute la surface du dos', 'Une séance confortable'],
      },
      pt: {
        titulo: 'Depilação das costas',
        descripcion: 'Depilação de toda a zona das costas.',
        beneficios: ['Cobre toda a superfície das costas', 'Sessão confortável'],
      },
    },
  },
  {
    slug: 'depilacion-brazos',
    familiaSlug: 'depilacion',
    orden: 9,
    porLocale: {
      es: {
        titulo: 'Depilación de brazos',
        descripcion: 'Depilación del brazo completo.',
        beneficios: ['Resultado uniforme', 'Piel suave al tacto'],
      },
      ca: {
        titulo: 'Depilació de braços',
        descripcion: 'Depilació del braç complet.',
        beneficios: ['Resultat uniforme', 'Pell suau al tacte'],
      },
      en: {
        titulo: 'Arm hair removal',
        descripcion: 'Hair removal of the full arm.',
        beneficios: ['A uniform result', 'Skin that feels smooth to the touch'],
      },
      it: {
        titulo: 'Depilazione braccia',
        descripcion: 'Depilazione del braccio completo.',
        beneficios: ['Risultato uniforme', 'Pelle morbida al tatto'],
      },
      fr: {
        titulo: 'Épilation des bras',
        descripcion: 'Une épilation du bras entier.',
        beneficios: ['Un résultat uniforme', 'Une peau douce au toucher'],
      },
      pt: {
        titulo: 'Depilação de braços',
        descripcion: 'Depilação do braço completo.',
        beneficios: ['Resultado uniforme', 'Pele suave ao toque'],
      },
    },
  },
  {
    slug: 'depilacion-medio-brazo',
    familiaSlug: 'depilacion',
    orden: 10,
    porLocale: {
      es: {
        titulo: 'Depilación medio brazo',
        descripcion: 'Depilación de la mitad del brazo.',
        beneficios: ['Opción más breve', 'Ideal para mantenimiento'],
      },
      ca: {
        titulo: 'Depilació de mig braç',
        descripcion: 'Depilació de la meitat del braç.',
        beneficios: ['Opció més breu', 'Ideal per a manteniment'],
      },
      en: {
        titulo: 'Half arm hair removal',
        descripcion: 'Hair removal of half the arm.',
        beneficios: ['A shorter option', 'Ideal for maintenance'],
      },
      it: {
        titulo: 'Depilazione mezzo braccio',
        descripcion: 'Depilazione di metà braccio.',
        beneficios: ['Opzione più breve', 'Ideale per il mantenimento'],
      },
      fr: {
        titulo: 'Épilation demi-bras',
        descripcion: 'Une épilation de la moitié du bras.',
        beneficios: ['Une option plus courte', 'Idéal pour l’entretien'],
      },
      pt: {
        titulo: 'Depilação meio braço',
        descripcion: 'Depilação de metade do braço.',
        beneficios: ['Opção mais breve', 'Ideal para manutenção'],
      },
    },
  },
  {
    slug: 'depilacion-pecho',
    familiaSlug: 'depilacion',
    orden: 11,
    porLocale: {
      es: {
        titulo: 'Depilación de pecho',
        descripcion: 'Depilación de la zona del pecho.',
        beneficios: ['Servicio adaptado a tu piel', 'Atención personalizada'],
      },
      ca: {
        titulo: 'Depilació de pit',
        descripcion: 'Depilació de la zona del pit.',
        beneficios: ['Servei adaptat a la teva pell', 'Atenció personalitzada'],
      },
      en: {
        titulo: 'Chest hair removal',
        descripcion: 'Hair removal of the chest area.',
        beneficios: ['A service adapted to your skin', 'Personalised attention'],
      },
      it: {
        titulo: 'Depilazione petto',
        descripcion: 'Depilazione della zona del petto.',
        beneficios: ['Servizio adattato alla tua pelle', 'Attenzione personalizzata'],
      },
      fr: {
        titulo: 'Épilation du torse',
        descripcion: 'Une épilation de la zone du torse.',
        beneficios: ['Un service adapté à votre peau', 'Une attention personnalisée'],
      },
      pt: {
        titulo: 'Depilação do peito',
        descripcion: 'Depilação da zona do peito.',
        beneficios: ['Serviço adaptado à sua pele', 'Atenção personalizada'],
      },
    },
  },
  {
    slug: 'depilacion-abdomen',
    familiaSlug: 'depilacion',
    orden: 12,
    porLocale: {
      es: {
        titulo: 'Depilación de abdomen',
        descripcion: 'Depilación de la zona abdominal.',
        beneficios: ['Zona tratada con delicadeza', 'Resultado homogéneo'],
      },
      ca: {
        titulo: 'Depilació d’abdomen',
        descripcion: 'Depilació de la zona abdominal.',
        beneficios: ['Zona tractada amb delicadesa', 'Resultat homogeni'],
      },
      en: {
        titulo: 'Abdomen hair removal',
        descripcion: 'Hair removal of the abdominal area.',
        beneficios: ['An area treated with care', 'A uniform result'],
      },
      it: {
        titulo: 'Depilazione addome',
        descripcion: 'Depilazione della zona addominale.',
        beneficios: ['Zona trattata con delicatezza', 'Risultato omogeneo'],
      },
      fr: {
        titulo: 'Épilation de l’abdomen',
        descripcion: 'Une épilation de la zone abdominale.',
        beneficios: ['Une zone traitée avec délicatesse', 'Un résultat homogène'],
      },
      pt: {
        titulo: 'Depilação do abdómen',
        descripcion: 'Depilação da zona abdominal.',
        beneficios: ['Zona tratada com delicadeza', 'Resultado homogéneo'],
      },
    },
  },
  {
    slug: 'depilacion-gluteos',
    familiaSlug: 'depilacion',
    orden: 13,
    porLocale: {
      es: {
        titulo: 'Depilación de glúteos',
        descripcion: 'Depilación de la zona de los glúteos.',
        beneficios: ['Servicio discreto y profesional', 'Piel cuidada al finalizar'],
      },
      ca: {
        titulo: 'Depilació de glutis',
        descripcion: 'Depilació de la zona dels glutis.',
        beneficios: ['Servei discret i professional', 'Pell cuidada en acabar'],
      },
      en: {
        titulo: 'Buttocks hair removal',
        descripcion: 'Hair removal of the buttocks area.',
        beneficios: ['A discreet, professional service', 'Cared-for skin afterwards'],
      },
      it: {
        titulo: 'Depilazione glutei',
        descripcion: 'Depilazione della zona dei glutei.',
        beneficios: ['Servizio discreto e professionale', 'Pelle curata al termine'],
      },
      fr: {
        titulo: 'Épilation des fessiers',
        descripcion: 'Une épilation de la zone des fessiers.',
        beneficios: ['Un service discret et professionnel', 'Une peau soignée à la fin'],
      },
      pt: {
        titulo: 'Depilação de glúteos',
        descripcion: 'Depilação da zona dos glúteos.',
        beneficios: ['Serviço discreto e profissional', 'Pele cuidada no final'],
      },
    },
  },
  {
    slug: 'depilacion-perianal',
    familiaSlug: 'depilacion',
    orden: 14,
    porLocale: {
      es: {
        titulo: 'Depilación perianal',
        descripcion: 'Depilación de la zona perianal.',
        beneficios: ['Servicio discreto y profesional', 'Máxima higiene y cuidado'],
      },
      ca: {
        titulo: 'Depilació perianal',
        descripcion: 'Depilació de la zona perianal.',
        beneficios: ['Servei discret i professional', 'Màxima higiene i cura'],
      },
      en: {
        titulo: 'Perianal hair removal',
        descripcion: 'Hair removal of the perianal area.',
        beneficios: ['A discreet, professional service', 'Maximum hygiene and care'],
      },
      it: {
        titulo: 'Depilazione perianale',
        descripcion: 'Depilazione della zona perianale.',
        beneficios: ['Servizio discreto e professionale', 'Massima igiene e cura'],
      },
      fr: {
        titulo: 'Épilation périanale',
        descripcion: 'Une épilation de la zone périanale.',
        beneficios: ['Un service discret et professionnel', 'Une hygiène et un soin maximaux'],
      },
      pt: {
        titulo: 'Depilação perianal',
        descripcion: 'Depilação da zona perianal.',
        beneficios: ['Serviço discreto e profissional', 'Máxima higiene e cuidado'],
      },
    },
  },
  {
    slug: 'depilacion-ingles-brasilenas',
    familiaSlug: 'depilacion',
    orden: 15,
    porLocale: {
      es: {
        titulo: 'Depilación ingles brasileñas',
        descripcion: 'Depilación de ingles con acabado brasileño.',
        beneficios: ['Servicio discreto y profesional', 'Acabado cuidado'],
      },
      ca: {
        titulo: 'Depilació d’engonals brasilera',
        descripcion: 'Depilació d’engonals amb acabat brasiler.',
        beneficios: ['Servei discret i professional', 'Acabat cuidat'],
      },
      en: {
        titulo: 'Brazilian bikini hair removal',
        descripcion: 'Bikini area hair removal with a Brazilian finish.',
        beneficios: ['A discreet, professional service', 'A carefully finished result'],
      },
      it: {
        titulo: 'Depilazione inguine brasiliana',
        descripcion: 'Depilazione inguinale con finitura brasiliana.',
        beneficios: ['Servizio discreto e professionale', 'Finitura curata'],
      },
      fr: {
        titulo: 'Épilation maillot brésilien',
        descripcion: 'Une épilation du maillot avec une finition brésilienne.',
        beneficios: ['Un service discret et professionnel', 'Une finition soignée'],
      },
      pt: {
        titulo: 'Depilação virilha brasileira',
        descripcion: 'Depilação de virilha com acabamento brasileiro.',
        beneficios: ['Serviço discreto e profissional', 'Acabamento cuidado'],
      },
    },
  },
  {
    slug: 'depilacion-ingles-normales',
    familiaSlug: 'depilacion',
    orden: 16,
    porLocale: {
      es: {
        titulo: 'Depilación ingles normales',
        descripcion: 'Depilación de la zona de ingles.',
        beneficios: ['Servicio discreto y profesional', 'Atención personalizada'],
      },
      ca: {
        titulo: 'Depilació d’engonals normal',
        descripcion: 'Depilació de la zona d’engonals.',
        beneficios: ['Servei discret i professional', 'Atenció personalitzada'],
      },
      en: {
        titulo: 'Standard bikini hair removal',
        descripcion: 'Hair removal of the bikini area.',
        beneficios: ['A discreet, professional service', 'Personalised attention'],
      },
      it: {
        titulo: 'Depilazione inguine classica',
        descripcion: 'Depilazione della zona inguinale.',
        beneficios: ['Servizio discreto e professionale', 'Attenzione personalizzata'],
      },
      fr: {
        titulo: 'Épilation maillot classique',
        descripcion: 'Une épilation de la zone du maillot.',
        beneficios: ['Un service discret et professionnel', 'Une attention personnalisée'],
      },
      pt: {
        titulo: 'Depilação virilha normal',
        descripcion: 'Depilação da zona da virilha.',
        beneficios: ['Serviço discreto e profissional', 'Atenção personalizada'],
      },
    },
  },
  {
    slug: 'depilacion-ingles-integrales',
    familiaSlug: 'depilacion',
    orden: 17,
    porLocale: {
      es: {
        titulo: 'Depilación ingles integrales',
        descripcion: 'Depilación completa de la zona de ingles.',
        beneficios: ['Servicio discreto y profesional', 'Máxima cobertura de la zona'],
      },
      ca: {
        titulo: 'Depilació d’engonals integral',
        descripcion: 'Depilació completa de la zona d’engonals.',
        beneficios: ['Servei discret i professional', 'Màxima cobertura de la zona'],
      },
      en: {
        titulo: 'Full bikini hair removal',
        descripcion: 'Complete hair removal of the bikini area.',
        beneficios: ['A discreet, professional service', 'Maximum coverage of the area'],
      },
      it: {
        titulo: 'Depilazione inguine integrale',
        descripcion: 'Depilazione completa della zona inguinale.',
        beneficios: ['Servizio discreto e professionale', 'Massima copertura della zona'],
      },
      fr: {
        titulo: 'Épilation maillot intégral',
        descripcion: 'Une épilation complète de la zone du maillot.',
        beneficios: ['Un service discret et professionnel', 'Une couverture maximale de la zone'],
      },
      pt: {
        titulo: 'Depilação virilha integral',
        descripcion: 'Depilação completa da zona da virilha.',
        beneficios: ['Serviço discreto e profissional', 'Máxima cobertura da zona'],
      },
    },
  },
  {
    slug: 'depilacion-piernas',
    familiaSlug: 'depilacion',
    orden: 18,
    porLocale: {
      es: {
        titulo: 'Depilación de piernas',
        descripcion: 'Depilación de la pierna completa.',
        beneficios: ['Piel suave de principio a fin', 'Resultado uniforme'],
      },
      ca: {
        titulo: 'Depilació de cames',
        descripcion: 'Depilació de la cama completa.',
        beneficios: ['Pell suau de principi a fi', 'Resultat uniforme'],
      },
      en: {
        titulo: 'Leg hair removal',
        descripcion: 'Hair removal of the full leg.',
        beneficios: ['Smooth skin from start to finish', 'A uniform result'],
      },
      it: {
        titulo: 'Depilazione gambe',
        descripcion: 'Depilazione della gamba completa.',
        beneficios: ['Pelle morbida dall’inizio alla fine', 'Risultato uniforme'],
      },
      fr: {
        titulo: 'Épilation des jambes',
        descripcion: 'Une épilation de la jambe entière.',
        beneficios: ['Une peau douce du début à la fin', 'Un résultat uniforme'],
      },
      pt: {
        titulo: 'Depilação de pernas',
        descripcion: 'Depilação da perna completa.',
        beneficios: ['Pele suave do início ao fim', 'Resultado uniforme'],
      },
    },
  },
  {
    slug: 'depilacion-medias-piernas',
    familiaSlug: 'depilacion',
    orden: 19,
    porLocale: {
      es: {
        titulo: 'Depilación medias piernas',
        descripcion: 'Depilación de la mitad inferior de la pierna.',
        beneficios: ['Opción más breve', 'Ideal para mantenimiento'],
      },
      ca: {
        titulo: 'Depilació de mitges cames',
        descripcion: 'Depilació de la meitat inferior de la cama.',
        beneficios: ['Opció més breu', 'Ideal per a manteniment'],
      },
      en: {
        titulo: 'Half leg hair removal',
        descripcion: 'Hair removal of the lower half of the leg.',
        beneficios: ['A shorter option', 'Ideal for maintenance'],
      },
      it: {
        titulo: 'Depilazione mezza gamba',
        descripcion: 'Depilazione della metà inferiore della gamba.',
        beneficios: ['Opzione più breve', 'Ideale per il mantenimento'],
      },
      fr: {
        titulo: 'Épilation demi-jambes',
        descripcion: 'Une épilation de la moitié inférieure de la jambe.',
        beneficios: ['Une option plus courte', 'Idéal pour l’entretien'],
      },
      pt: {
        titulo: 'Depilação meia perna',
        descripcion: 'Depilação da metade inferior da perna.',
        beneficios: ['Opção mais breve', 'Ideal para manutenção'],
      },
    },
  },
  // ── Depilación Láser ──────────────────────────────────────────────────
  {
    slug: 'laser-patillas',
    familiaSlug: 'depilacion-laser',
    orden: 1,
    porLocale: {
      es: { titulo: 'Láser patillas', descripcion: 'Depilación láser en patillas para una definición facial precisa.', beneficios: ['Eliminación progresiva del vello', 'Sesión rápida de 15 min'] },
      ca: { titulo: 'Làser patilles', descripcion: 'Depilació làser a les patilles per a una definició facial precisa.', beneficios: ['Eliminació progressiva del pèl', 'Sessió ràpida de 15 min'] },
      en: { titulo: 'Laser sideburns', descripcion: 'Laser hair removal on sideburns for precise facial definition.', beneficios: ['Progressive hair removal', 'Quick 15 min session'] },
      it: { titulo: 'Laser basette', descripcion: 'Depilazione laser sulle basette per una definición facciale precisa.', beneficios: ['Eliminazione progressiva dei peli', 'Seduta rapida da 15 min'] },
      fr: { titulo: 'Laser favoris', descripcion: 'Épilation laser des favoris pour une définition faciale précise.', beneficios: ['Élimination progressive des poils', 'Séance rapide de 15 min'] },
      pt: { titulo: 'Laser patilhas', descripcion: 'Depilação laser nas patilhas para uma definição facial precisa.', beneficios: ['Eliminação progressiva do pelo', 'Sessão rápida de 15 min'] },
    },
  },
  {
    slug: 'laser-menton',
    familiaSlug: 'depilacion-laser',
    orden: 2,
    porLocale: {
      es: { titulo: 'Láser mentón', descripcion: 'Tratamiento láser en mentón para piel suave y libre de vello.', beneficios: ['Resultados duraderos', 'Zona delicada tratada con cuidado'] },
      ca: { titulo: 'Làser barbeta', descripcion: 'Tractament làser a la barbeta per a una pell suau i lliure de pèl.', beneficios: ['Resultats duradors', 'Zona delicada tractada amb cura'] },
      en: { titulo: 'Laser chin', descripcion: 'Laser treatment on the chin for smooth, hair-free skin.', beneficios: ['Long-lasting results', 'Delicate area treated with care'] },
      it: { titulo: 'Laser mento', descripcion: 'Trattamento laser sul mento per una pelle liscia e senza peli.', beneficios: ['Risultati duraturi', 'Zona delicata trattata con cura'] },
      fr: { titulo: 'Laser menton', descripcion: 'Soin laser du menton pour une peau douce et sans poils.', beneficios: ['Résultats durables', 'Zone délicate traitée avec soin'] },
      pt: { titulo: 'Laser queixo', descripcion: 'Tratamento laser no queixo para pele suave e livre de pelos.', beneficios: ['Resultados duradouros', 'Zona delicada tratada com cuidado'] },
    },
  },
  {
    slug: 'laser-axilas',
    familiaSlug: 'depilacion-laser',
    orden: 3,
    porLocale: {
      es: { titulo: 'Láser axilas', descripcion: 'Depilación láser de axilas eficaz y confortable.', beneficios: ['Piel suave y libre de irritaciones', 'Reducción duradera del vello'] },
      ca: { titulo: 'Làser aixelles', descripcion: 'Depilació làser d’aixelles eficaç i confortable.', beneficios: ['Pell suau i lliure d’irritacions', 'Reducció duradora del pèl'] },
      en: { titulo: 'Laser underarms', descripcion: 'Effective and comfortable underarm laser hair removal.', beneficios: ['Smooth, irritation-free skin', 'Long-lasting hair reduction'] },
      it: { titulo: 'Laser ascelle', descripcion: 'Depilazione laser delle ascelle efficace e confortevole.', beneficios: ['Pelle liscia e senza irritazioni', 'Riduzione duratura dei peli'] },
      fr: { titulo: 'Laser aisselles', descripcion: 'Épilation laser des aisselles efficace et confortable.', beneficios: ['Peau douce sans irritation', 'Réduction durable de la pilosité'] },
      pt: { titulo: 'Laser axilas', descripcion: 'Depilação laser de axilas eficaz e confortável.', beneficios: ['Pele suave e sem irritações', 'Redução duradoura do pelo'] },
    },
  },
  {
    slug: 'laser-espalda',
    familiaSlug: 'depilacion-laser',
    orden: 4,
    porLocale: {
      es: { titulo: 'Láser espalda completa', descripcion: 'Depilación láser completa en la zona de la espalda.', beneficios: ['Cobertura completa', 'Piel limpia y renovada'] },
      ca: { titulo: 'Làser esquena completa', descripcion: 'Depilació làser completa a la zona de l’esquena.', beneficios: ['Cobertura completa', 'Pell neta i renovada'] },
      en: { titulo: 'Laser full back', descripcion: 'Full back laser hair removal.', beneficios: ['Complete coverage', 'Clean and refreshed skin'] },
      it: { titulo: 'Laser schiena completa', descripcion: 'Depilazione laser completa sulla schiena.', beneficios: ['Copertura completa', 'Pelle pulita e rinnovata'] },
      fr: { titulo: 'Laser dos complet', descripcion: 'Épilation laser complète du dos.', beneficios: ['Couverture complète', 'Peau nette et rénovée'] },
      pt: { titulo: 'Laser costas completas', descripcion: 'Depilação laser completa na zona das costas.', beneficios: ['Cobertura completa', 'Pele limpa e renovada'] },
    },
  },
  {
    slug: 'laser-ingles-integrales',
    familiaSlug: 'depilacion-laser',
    orden: 5,
    porLocale: {
      es: { titulo: 'Láser ingles integrales', descripcion: 'Depilación láser completa de la zona íntima.', beneficios: ['Máxima comodidad y suavidad', 'Resultados duraderos'] },
      ca: { titulo: 'Làser engonal integral', descripcion: 'Depilació làser completa de la zona íntima.', beneficios: ['Màxima comoditat i suavitat', 'Resultats duradors'] },
      en: { titulo: 'Laser Hollywood bikini', descripcion: 'Full laser hair removal of the intimate area.', beneficios: ['Maximum comfort and smoothness', 'Long-lasting results'] },
      it: { titulo: 'Laser inguine integrale', descripcion: 'Depilazione laser completa della zona intima.', beneficios: ['Massimo comfort e morbidezza', 'Risultati duraturi'] },
      fr: { titulo: 'Laser maillot intégral', descripcion: 'Épilation laser complète de la zone intime.', beneficios: ['Confort et douceur maximales', 'Résultats durables'] },
      pt: { titulo: 'Laser virilha integral', descripcion: 'Depilação laser completa da zona íntima.', beneficios: ['Conforto e suavidade máximos', 'Resultados duradouros'] },
    },
  },
  {
    slug: 'laser-labio',
    familiaSlug: 'depilacion-laser',
    orden: 6,
    porLocale: {
      es: { titulo: 'Láser labio superior', descripcion: 'Depilación láser de labio superior rápida y eficaz.', beneficios: ['Tratamiento express de 10 min', 'Piel tersa'] },
      ca: { titulo: 'Làser llavi superior', descripcion: 'Depilació làser de llavi superior ràpida i eficaç.', beneficios: ['Tractament express de 10 min', 'Pell tersa'] },
      en: { titulo: 'Laser upper lip', descripcion: 'Fast and effective upper lip laser hair removal.', beneficios: ['Express 10 min treatment', 'Smooth skin'] },
      it: { titulo: 'Laser labbro superiore', descripcion: 'Depilazione laser del labbro superiore rapida ed efficace.', beneficios: ['Trattamento express da 10 min', 'Pelle liscia'] },
      fr: { titulo: 'Laser lèvre supérieure', descripcion: 'Épilation laser de la lèvre supérieure rapide et efficace.', beneficios: ['Soin express de 10 min', 'Peau lisse'] },
      pt: { titulo: 'Laser lábio superior', descripcion: 'Depilação laser de lábio superior rápida e eficaz.', beneficios: ['Tratamento express de 10 min', 'Pele suave'] },
    },
  },
  {
    slug: 'laser-medias-piernas',
    familiaSlug: 'depilacion-laser',
    orden: 7,
    porLocale: {
      es: { titulo: 'Láser medias piernas', descripcion: 'Depilación láser en gemelos y espinillas.', beneficios: ['Piernas suaves sin rasurado constante', 'Sensación de ligereza'] },
      ca: { titulo: 'Làser mitges cames', descripcion: 'Depilació làser a bessons i espinelles.', beneficios: ['Cames suaus sense raspat constant', 'Sensació de lleugeresa'] },
      en: { titulo: 'Laser half legs', descripcion: 'Laser hair removal on calves and shins.', beneficios: ['Smooth legs without constant shaving', 'Light feeling'] },
      it: { titulo: 'Laser mezza gamba', descripcion: 'Depilazione laser su polpacci e stinchi.', beneficios: ['Gambe lisce senza rasatura costante', 'Sensazione di leggerezza'] },
      fr: { titulo: 'Laser demi-jambes', descripcion: 'Épilation laser des mollets et tibias.', beneficios: ['Jambes douces sans rasage quotidien', 'Sensation de légèreté'] },
      pt: { titulo: 'Laser meias pernas', descripcion: 'Depilação laser nas barrigas das pernas e canelas.', beneficios: ['Pernas suaves sem depilação constante', 'Sensação de leveza'] },
    },
  },
  {
    slug: 'laser-piernas-completas',
    familiaSlug: 'depilacion-laser',
    orden: 8,
    porLocale: {
      es: { titulo: 'Láser piernas completas', descripcion: 'Depilación láser en piernas enteras de muslo a tobillos.', beneficios: ['Tratamiento integral', 'Resultados visibles desde las primeras sesiones'] },
      ca: { titulo: 'Làser cames completes', descripcion: 'Depilació làser a cames senceres de cuixa a tobells.', beneficios: ['Tractament integral', 'Resultats visibles des de les primeres sessions'] },
      en: { titulo: 'Laser full legs', descripcion: 'Full leg laser hair removal from thighs to ankles.', beneficios: ['Comprehensive treatment', 'Visible results from early sessions'] },
      it: { titulo: 'Laser gambe intere', descripcion: 'Depilazione laser su gambe intere dalle cosce alle caviglie.', beneficios: ['Trattamento integrale', 'Risultati visibili fin dalle prime sedute'] },
      fr: { titulo: 'Laser jambes complètes', descripcion: 'Épilation laser complète des cuisses aux chevilles.', beneficios: ['Soin intégral', 'Résultats visibles dès les premières séances'] },
      pt: { titulo: 'Laser pernas completas', descripcion: 'Depilação laser em pernas inteiras da coxa aos tornozelos.', beneficios: ['Tratamento integral', 'Resultados visíveis desde as primeiras sessões'] },
    },
  },
  {
    slug: 'laser-pecho',
    familiaSlug: 'depilacion-laser',
    orden: 9,
    porLocale: {
      es: { titulo: 'Láser pecho', descripcion: 'Depilación láser en la zona pectoral.', beneficios: ['Piel limpia', 'Sesión confortable de 30 min'] },
      ca: { titulo: 'Làser pit', descripcion: 'Depilació làser a la zona pectoral.', beneficios: ['Pell neta', 'Sessió meva confortable de 30 min'] },
      en: { titulo: 'Laser chest', descripcion: 'Laser hair removal on the chest area.', beneficios: ['Clear skin', 'Comfortable 30 min session'] },
      it: { titulo: 'Laser petto', descripcion: 'Depilazione laser nella zona del petto.', beneficios: ['Pelle liscia', 'Seduta confortevole da 30 min'] },
      fr: { titulo: 'Laser torse', descripcion: 'Épilation laser de la zone du torse.', beneficios: ['Peau nette', 'Séance confortable de 30 min'] },
      pt: { titulo: 'Laser peito', descripcion: 'Depilação laser na zona peitoral.', beneficios: ['Pele limpa', 'Sessão confortável de 30 min'] },
    },
  },
  {
    slug: 'laser-ingles-brasilenas',
    familiaSlug: 'depilacion-laser',
    orden: 10,
    porLocale: {
      es: { titulo: 'Láser ingles brasileñas', descripcion: 'Depilación láser de diseño brasileño en la zona de la ingle.', beneficios: ['Definición precisa', 'Higiene y suavidad duradera'] },
      ca: { titulo: 'Làser engonal brasiler', descripcion: 'Depilació làser de disseny brasiler a la zona de l’engonal.', beneficios: ['Definició precisa', 'Higiene i suavitat duradora'] },
      en: { titulo: 'Laser Brazilian bikini', descripcion: 'Brazilian style laser hair removal in the bikini area.', beneficios: ['Precise definition', 'Long-lasting hygiene and smoothness'] },
      it: { titulo: 'Laser inguine brasiliana', descripcion: 'Depilazione laser in stile brasiliano nella zona dell’inguine.', beneficios: ['Definizione precisa', 'Igiene e morbidezza duratura'] },
      fr: { titulo: 'Laser maillot brésilien', descripcion: 'Épilation laser style brésilien de la zone du maillot.', beneficios: ['Définition précise', 'Hygiène et douceur durables'] },
      pt: { titulo: 'Laser virilha brasileira', descripcion: 'Depilação laser estilo brasileiro na zona da virilha.', beneficios: ['Definição precisa', 'Higiene e suavidade duradouras'] },
    },
  },

  // ── Tratamientos faciales ────────────────────────────────────────────
  {
    slug: 'limpieza-facial-basica',
    familiaSlug: 'faciales',
    orden: 1,
    porLocale: {
      es: {
        titulo: 'Limpieza facial básica',
        descripcion: 'Limpieza en profundidad para renovar la piel del rostro.',
        beneficios: ['Piel más limpia y luminosa', 'Buen punto de partida para el cuidado facial'],
      },
      ca: {
        titulo: 'Neteja facial bàsica',
        descripcion: 'Neteja en profunditat per renovar la pell del rostre.',
        beneficios: ['Pell més neta i lluminosa', 'Un bon punt de partida per a la cura facial'],
      },
      en: {
        titulo: 'Basic facial cleansing',
        descripcion: 'A thorough cleanse to renew the skin of the face.',
        beneficios: ['Cleaner, more radiant skin', 'A good starting point for facial care'],
      },
      it: {
        titulo: 'Pulizia del viso base',
        descripcion: 'Pulizia in profondità per rinnovare la pelle del viso.',
        beneficios: ['Pelle più pulita e luminosa', 'Un buon punto di partenza per la cura del viso'],
      },
      fr: {
        titulo: 'Nettoyage de peau simple',
        descripcion: 'Un nettoyage en profondeur pour renouveler la peau du visage.',
        beneficios: ['Une peau plus propre et lumineuse', 'Un bon point de départ pour le soin du visage'],
      },
      pt: {
        titulo: 'Limpeza facial básica',
        descripcion: 'Limpeza em profundidade para renovar a pele do rosto.',
        beneficios: ['Pele mais limpa e luminosa', 'Um bom ponto de partida para o cuidado facial'],
      },
    },
  },
  {
    slug: 'limpieza-facial-profunda',
    familiaSlug: 'faciales',
    orden: 2,
    destacado: true,
    porLocale: {
      es: {
        titulo: 'Limpieza facial profunda',
        descripcion: 'Eliminación de impurezas y renovación para una piel limpia y luminosa.',
        beneficios: ['Piel visiblemente más limpia', 'Rutina completa de higiene facial', 'Sensación de piel renovada'],
      },
      ca: {
        titulo: 'Neteja facial profunda',
        descripcion: 'Eliminació d’impureses i renovació per a una pell neta i lluminosa.',
        beneficios: ['Pell visiblement més neta', 'Rutina completa d’higiene facial', 'Sensació de pell renovada'],
      },
      en: {
        titulo: 'Deep facial cleansing',
        descripcion: 'Impurity removal and renewal for clean, radiant skin.',
        beneficios: ['Visibly cleaner skin', 'A complete facial hygiene routine', 'A feeling of renewed skin'],
      },
      it: {
        titulo: 'Pulizia del viso profonda',
        descripcion: 'Eliminazione delle impurità e rinnovamento per una pelle pulita e luminosa.',
        beneficios: ['Pelle visibilmente più pulita', 'Una routine completa di igiene del viso', 'Sensazione di pelle rinnovata'],
      },
      fr: {
        titulo: 'Nettoyage de peau en profondeur',
        descripcion: 'Élimination des impuretés et renouvellement pour une peau propre et lumineuse.',
        beneficios: ['Une peau visiblement plus propre', 'Une routine complète d’hygiène du visage', 'Une sensation de peau renouvelée'],
      },
      pt: {
        titulo: 'Limpeza facial profunda',
        descripcion: 'Eliminação de impurezas e renovação para uma pele limpa e luminosa.',
        beneficios: ['Pele visivelmente mais limpa', 'Rotina completa de higiene facial', 'Sensação de pele renovada'],
      },
    },
  },
  {
    slug: 'mesoterapia-estetica',
    familiaSlug: 'faciales',
    orden: 3,
    porLocale: {
      es: {
        titulo: 'Mesoterapia estética no inyectable',
        descripcion: 'Técnica no inyectable orientada al cuidado de la piel del rostro.',
        beneficios: ['Técnica no invasiva', 'Complementa tu rutina facial'],
      },
      ca: {
        titulo: 'Mesoteràpia estètica no injectable',
        descripcion: 'Tècnica no injectable orientada a la cura de la pell del rostre.',
        beneficios: ['Tècnica no invasiva', 'Complementa la teva rutina facial'],
      },
      en: {
        titulo: 'Non-injectable aesthetic mesotherapy',
        descripcion: 'A non-injectable technique focused on facial skin care.',
        beneficios: ['A non-invasive technique', 'Complements your facial routine'],
      },
      it: {
        titulo: 'Mesoterapia estetica non iniettiva',
        descripcion: 'Tecnica non iniettiva orientata alla cura della pelle del viso.',
        beneficios: ['Tecnica non invasiva', 'Completa la tua routine viso'],
      },
      fr: {
        titulo: 'Mésothérapie esthétique non injectable',
        descripcion: 'Une technique non injectable dédiée au soin de la peau du visage.',
        beneficios: ['Une technique non invasive', 'Complète votre routine visage'],
      },
      pt: {
        titulo: 'Mesoterapia estética não injetável',
        descripcion: 'Técnica não injetável orientada para o cuidado da pele do rosto.',
        beneficios: ['Técnica não invasiva', 'Complementa a sua rotina facial'],
      },
    },
  },
  {
    slug: 'microneedling',
    familiaSlug: 'faciales',
    orden: 4,
    porLocale: {
      es: {
        titulo: 'Microneedling',
        descripcion: 'Técnica facial mediante microagujas orientada al cuidado de la piel.',
        beneficios: ['Protocolo especializado', 'Sesión guiada por profesional'],
      },
      ca: {
        titulo: 'Microneedling',
        descripcion: 'Tècnica facial mitjançant microagulles orientada a la cura de la pell.',
        beneficios: ['Protocol especialitzat', 'Sessió guiada per professional'],
      },
      en: {
        titulo: 'Microneedling',
        descripcion: 'A facial technique using micro-needles focused on skin care.',
        beneficios: ['A specialised protocol', 'A session guided by a professional'],
      },
      it: {
        titulo: 'Microneedling',
        descripcion: 'Tecnica viso con micro-aghi orientata alla cura della pelle.',
        beneficios: ['Protocollo specializzato', 'Seduta guidata da un professionista'],
      },
      fr: {
        titulo: 'Microneedling',
        descripcion: 'Une technique visage aux micro-aiguilles dédiée au soin de la peau.',
        beneficios: ['Un protocole spécialisé', 'Une séance guidée par une professionnelle'],
      },
      pt: {
        titulo: 'Microneedling',
        descripcion: 'Técnica facial com microagulhas orientada para o cuidado da pele.',
        beneficios: ['Protocolo especializado', 'Sessão guiada por profissional'],
      },
    },
  },
  {
    slug: 'dermapen',
    familiaSlug: 'faciales',
    orden: 5,
    porLocale: {
      es: {
        titulo: 'Dermapen',
        descripcion: 'Tratamiento facial con dispositivo específico de microagujado.',
        beneficios: ['Tecnología específica', 'Sesión personalizada'],
      },
      ca: {
        titulo: 'Dermapen',
        descripcion: 'Tractament facial amb dispositiu específic de microagulla.',
        beneficios: ['Tecnologia específica', 'Sessió personalitzada'],
      },
      en: {
        titulo: 'Dermapen',
        descripcion: 'Facial treatment using a specific micro-needling device.',
        beneficios: ['Specific technology', 'A personalised session'],
      },
      it: {
        titulo: 'Dermapen',
        descripcion: 'Trattamento viso con dispositivo specifico di microaghi.',
        beneficios: ['Tecnologia specifica', 'Seduta personalizzata'],
      },
      fr: {
        titulo: 'Dermapen',
        descripcion: 'Un soin du visage avec un dispositif spécifique de micro-perforation.',
        beneficios: ['Une technologie spécifique', 'Une séance personnalisée'],
      },
      pt: {
        titulo: 'Dermapen',
        descripcion: 'Tratamento facial com dispositivo específico de microagulhamento.',
        beneficios: ['Tecnologia específica', 'Sessão personalizada'],
      },
    },
  },
  {
    slug: 'radiofrecuencia-facial',
    familiaSlug: 'faciales',
    orden: 6,
    porLocale: {
      es: {
        titulo: 'Radiofrecuencia facial',
        descripcion: 'Tecnología facial orientada a la firmeza de la piel.',
        beneficios: ['Protocolo con tecnología especializada', 'Sesión adaptada a tu piel'],
      },
      ca: {
        titulo: 'Radiofreqüència facial',
        descripcion: 'Tecnologia facial orientada a la fermesa de la pell.',
        beneficios: ['Protocol amb tecnologia especialitzada', 'Sessió adaptada a la teva pell'],
      },
      en: {
        titulo: 'Facial radiofrequency',
        descripcion: 'Facial technology focused on skin firmness.',
        beneficios: ['A protocol using specialised technology', 'A session adapted to your skin'],
      },
      it: {
        titulo: 'Radiofrequenza facciale',
        descripcion: 'Tecnologia viso orientata alla compattezza della pelle.',
        beneficios: ['Protocollo con tecnologia specializzata', 'Seduta adattata alla tua pelle'],
      },
      fr: {
        titulo: 'Radiofréquence visage',
        descripcion: 'Une technologie visage dédiée à la fermeté de la peau.',
        beneficios: ['Un protocole avec une technologie spécialisée', 'Une séance adaptée à votre peau'],
      },
      pt: {
        titulo: 'Radiofrequência facial',
        descripcion: 'Tecnologia facial orientada para a firmeza da pele.',
        beneficios: ['Protocolo com tecnologia especializada', 'Sessão adaptada à sua pele'],
      },
    },
  },
  {
    slug: 'peeling-prx',
    familiaSlug: 'faciales',
    orden: 7,
    porLocale: {
      es: {
        titulo: 'Peeling PRX',
        descripcion: 'Renovación facial mediante técnica de peeling específica.',
        beneficios: ['Técnica de renovación facial', 'Protocolo guiado por profesional'],
      },
      ca: {
        titulo: 'Pèeling PRX',
        descripcion: 'Renovació facial mitjançant una tècnica de pèeling específica.',
        beneficios: ['Tècnica de renovació facial', 'Protocol guiat per professional'],
      },
      en: {
        titulo: 'PRX peel',
        descripcion: 'Facial renewal using a specific peeling technique.',
        beneficios: ['A facial renewal technique', 'A protocol guided by a professional'],
      },
      it: {
        titulo: 'Peeling PRX',
        descripcion: 'Rinnovamento del viso attraverso una tecnica di peeling specifica.',
        beneficios: ['Tecnica di rinnovamento del viso', 'Protocollo guidato da un professionista'],
      },
      fr: {
        titulo: 'Peeling PRX',
        descripcion: 'Un renouvellement du visage grâce à une technique de peeling spécifique.',
        beneficios: ['Une technique de renouvellement du visage', 'Un protocole guidé par une professionnelle'],
      },
      pt: {
        titulo: 'Peeling PRX',
        descripcion: 'Renovação facial através de uma técnica de peeling específica.',
        beneficios: ['Técnica de renovação facial', 'Protocolo guiado por profissional'],
      },
    },
  },
  {
    slug: 'skinpen',
    familiaSlug: 'faciales',
    orden: 8,
    porLocale: {
      es: {
        titulo: 'SkinPen',
        descripcion: 'Tratamiento facial con dispositivo SkinPen.',
        beneficios: ['Tecnología específica', 'Sesión personalizada según tu piel'],
      },
      ca: {
        titulo: 'SkinPen',
        descripcion: 'Tractament facial amb dispositiu SkinPen.',
        beneficios: ['Tecnologia específica', 'Sessió personalitzada segons la teva pell'],
      },
      en: {
        titulo: 'SkinPen',
        descripcion: 'Facial treatment using the SkinPen device.',
        beneficios: ['Specific technology', 'A session personalised to your skin'],
      },
      it: {
        titulo: 'SkinPen',
        descripcion: 'Trattamento viso con dispositivo SkinPen.',
        beneficios: ['Tecnologia specifica', 'Seduta personalizzata in base alla tua pelle'],
      },
      fr: {
        titulo: 'SkinPen',
        descripcion: 'Un soin du visage avec le dispositif SkinPen.',
        beneficios: ['Une technologie spécifique', 'Une séance personnalisée selon votre peau'],
      },
      pt: {
        titulo: 'SkinPen',
        descripcion: 'Tratamento facial com dispositivo SkinPen.',
        beneficios: ['Tecnologia específica', 'Sessão personalizada de acordo com a sua pele'],
      },
    },
  },
  {
    slug: 'laser-carbono',
    familiaSlug: 'faciales',
    orden: 9,
    porLocale: {
      es: {
        titulo: 'Láser de carbono',
        descripcion: 'Tratamiento facial mediante tecnología láser de carbono.',
        beneficios: ['Tecnología láser específica', 'Sesión guiada por profesional'],
      },
      ca: {
        titulo: 'Làser de carboni',
        descripcion: 'Tractament facial mitjançant tecnologia làser de carboni.',
        beneficios: ['Tecnologia làser específica', 'Sessió guiada per professional'],
      },
      en: {
        titulo: 'Carbon laser',
        descripcion: 'Facial treatment using carbon laser technology.',
        beneficios: ['Specific laser technology', 'A session guided by a professional'],
      },
      it: {
        titulo: 'Laser al carbonio',
        descripcion: 'Trattamento viso con tecnologia laser al carbonio.',
        beneficios: ['Tecnologia laser specifica', 'Seduta guidata da un professionista'],
      },
      fr: {
        titulo: 'Laser au carbone',
        descripcion: 'Un soin du visage utilisant la technologie laser au carbone.',
        beneficios: ['Une technologie laser spécifique', 'Une séance guidée par une professionnelle'],
      },
      pt: {
        titulo: 'Laser de carbono',
        descripcion: 'Tratamento facial através de tecnologia laser de carbono.',
        beneficios: ['Tecnologia laser específica', 'Sessão guiada por profissional'],
      },
    },
  },

  // ── Uñas ─────────────────────────────────────────────────────────────
  {
    slug: 'manicura-express',
    familiaSlug: 'unas',
    orden: 1,
    porLocale: {
      es: {
        titulo: 'Manicura express',
        descripcion: 'Manicura rápida para un acabado cuidado en poco tiempo.',
        beneficios: ['Servicio rápido', 'Ideal si vas con el tiempo justo'],
      },
      ca: {
        titulo: 'Manicura ràpida',
        descripcion: 'Manicura ràpida per a un acabat cuidat en poc temps.',
        beneficios: ['Servei ràpid', 'Ideal si vas justa de temps'],
      },
      en: {
        titulo: 'Express manicure',
        descripcion: 'A quick manicure for a neat finish in little time.',
        beneficios: ['A fast service', 'Ideal when you’re short on time'],
      },
      it: {
        titulo: 'Manicure express',
        descripcion: 'Manicure rapida per una finitura curata in poco tempo.',
        beneficios: ['Servizio rapido', 'Ideale se hai poco tempo'],
      },
      fr: {
        titulo: 'Manucure express',
        descripcion: 'Une manucure rapide pour une finition soignée en peu de temps.',
        beneficios: ['Un service rapide', 'Idéal si vous êtes pressée'],
      },
      pt: {
        titulo: 'Manicure expresso',
        descripcion: 'Manicure rápida para um acabamento cuidado em pouco tempo.',
        beneficios: ['Serviço rápido', 'Ideal se tem pouco tempo'],
      },
    },
  },
  {
    slug: 'manicura-tradicional',
    familiaSlug: 'unas',
    orden: 2,
    porLocale: {
      es: {
        titulo: 'Manicura tradicional',
        descripcion: 'Cuidado completo de manos y uñas con esmaltado clásico.',
        beneficios: ['Cuidado completo de manos', 'Acabado clásico impecable'],
      },
      ca: {
        titulo: 'Manicura tradicional',
        descripcion: 'Cura completa de mans i ungles amb esmalt clàssic.',
        beneficios: ['Cura completa de les mans', 'Acabat clàssic impecable'],
      },
      en: {
        titulo: 'Traditional manicure',
        descripcion: 'Complete hand and nail care with classic polish.',
        beneficios: ['Complete hand care', 'An impeccable classic finish'],
      },
      it: {
        titulo: 'Manicure tradizionale',
        descripcion: 'Cura completa di mani e unghie con smalto classico.',
        beneficios: ['Cura completa delle mani', 'Finitura classica impeccabile'],
      },
      fr: {
        titulo: 'Manucure traditionnelle',
        descripcion: 'Un soin complet des mains et des ongles avec un vernis classique.',
        beneficios: ['Un soin complet des mains', 'Une finition classique impeccable'],
      },
      pt: {
        titulo: 'Manicure tradicional',
        descripcion: 'Cuidado completo de mãos e unhas com esmaltagem clássica.',
        beneficios: ['Cuidado completo das mãos', 'Acabamento clássico impecável'],
      },
    },
  },
  {
    slug: 'manicura-semipermanente',
    familiaSlug: 'unas',
    orden: 3,
    destacado: true,
    porLocale: {
      es: {
        titulo: 'Manicura semipermanente',
        descripcion: 'Esmaltado de larga duración con preparación profesional de la uña.',
        beneficios: ['Acabado de larga duración', 'Preparación profesional de la uña', 'Brillo impecable'],
      },
      ca: {
        titulo: 'Manicura semipermanent',
        descripcion: 'Esmaltat de llarga durada amb preparació professional de l’ungla.',
        beneficios: ['Acabat de llarga durada', 'Preparació professional de l’ungla', 'Brillantor impecable'],
      },
      en: {
        titulo: 'Gel manicure',
        descripcion: 'Long-lasting polish with professional nail preparation.',
        beneficios: ['A long-lasting finish', 'Professional nail preparation', 'Impeccable shine'],
      },
      it: {
        titulo: 'Manicure semipermanente',
        descripcion: 'Smalto di lunga durata con preparazione professionale dell’unghia.',
        beneficios: ['Finitura di lunga durata', 'Preparazione professionale dell’unghia', 'Brillantezza impeccabile'],
      },
      fr: {
        titulo: 'Manucure semi-permanente',
        descripcion: 'Un vernis longue tenue avec une préparation professionnelle de l’ongle.',
        beneficios: ['Une finition longue tenue', 'Une préparation professionnelle de l’ongle', 'Une brillance impeccable'],
      },
      pt: {
        titulo: 'Manicure semipermanente',
        descripcion: 'Esmaltagem de longa duração com preparação profissional da unha.',
        beneficios: ['Acabamento de longa duração', 'Preparação profissional da unha', 'Brilho impecável'],
      },
    },
  },
  {
    slug: 'parafina-manos',
    familiaSlug: 'unas',
    orden: 4,
    porLocale: {
      es: {
        titulo: 'Parafina de manos',
        descripcion: 'Tratamiento de calor con parafina para hidratar las manos.',
        beneficios: ['Sensación de manos más suaves', 'Ritual de bienestar breve'],
      },
      ca: {
        titulo: 'Parafina de mans',
        descripcion: 'Tractament de calor amb parafina per hidratar les mans.',
        beneficios: ['Sensació de mans més suaus', 'Ritual de benestar breu'],
      },
      en: {
        titulo: 'Hand paraffin treatment',
        descripcion: 'A heat treatment with paraffin to moisturise the hands.',
        beneficios: ['A feeling of softer hands', 'A brief wellbeing ritual'],
      },
      it: {
        titulo: 'Paraffina mani',
        descripcion: 'Trattamento a caldo con paraffina per idratare le mani.',
        beneficios: ['Sensazione di mani più morbide', 'Un breve rituale di benessere'],
      },
      fr: {
        titulo: 'Paraffine des mains',
        descripcion: 'Un soin à la chaleur avec de la paraffine pour hydrater les mains.',
        beneficios: ['Une sensation de mains plus douces', 'Un bref rituel bien-être'],
      },
      pt: {
        titulo: 'Parafina de mãos',
        descripcion: 'Tratamento de calor com parafina para hidratar as mãos.',
        beneficios: ['Sensação de mãos mais suaves', 'Um breve ritual de bem-estar'],
      },
    },
  },
  {
    slug: 'pedicura-express',
    familiaSlug: 'unas',
    orden: 5,
    porLocale: {
      es: {
        titulo: 'Pedicura express',
        descripcion: 'Pedicura rápida para unos pies cuidados en poco tiempo.',
        beneficios: ['Servicio rápido', 'Ideal para mantenimiento'],
      },
      ca: {
        titulo: 'Pedicura ràpida',
        descripcion: 'Pedicura ràpida per a uns peus cuidats en poc temps.',
        beneficios: ['Servei ràpid', 'Ideal per a manteniment'],
      },
      en: {
        titulo: 'Express pedicure',
        descripcion: 'A quick pedicure for well-groomed feet in little time.',
        beneficios: ['A fast service', 'Ideal for maintenance'],
      },
      it: {
        titulo: 'Pedicure express',
        descripcion: 'Pedicure rapida per piedi curati in poco tempo.',
        beneficios: ['Servizio rapido', 'Ideale per il mantenimento'],
      },
      fr: {
        titulo: 'Pédicure express',
        descripcion: 'Une pédicure rapide pour des pieds soignés en peu de temps.',
        beneficios: ['Un service rapide', 'Idéal pour l’entretien'],
      },
      pt: {
        titulo: 'Pedicure expresso',
        descripcion: 'Pedicure rápida para pés cuidados em pouco tempo.',
        beneficios: ['Serviço rápido', 'Ideal para manutenção'],
      },
    },
  },
  {
    slug: 'pedicura-tradicional',
    familiaSlug: 'unas',
    orden: 6,
    porLocale: {
      es: {
        titulo: 'Pedicura tradicional',
        descripcion: 'Cuidado completo de pies y uñas con esmaltado clásico.',
        beneficios: ['Cuidado completo de los pies', 'Acabado clásico impecable'],
      },
      ca: {
        titulo: 'Pedicura tradicional',
        descripcion: 'Cura completa de peus i ungles amb esmalt clàssic.',
        beneficios: ['Cura completa dels peus', 'Acabat clàssic impecable'],
      },
      en: {
        titulo: 'Traditional pedicure',
        descripcion: 'Complete foot and nail care with classic polish.',
        beneficios: ['Complete foot care', 'An impeccable classic finish'],
      },
      it: {
        titulo: 'Pedicure tradizionale',
        descripcion: 'Cura completa di piedi e unghie con smalto classico.',
        beneficios: ['Cura completa dei piedi', 'Finitura classica impeccabile'],
      },
      fr: {
        titulo: 'Pédicure traditionnelle',
        descripcion: 'Un soin complet des pieds et des ongles avec un vernis classique.',
        beneficios: ['Un soin complet des pieds', 'Une finition classique impeccable'],
      },
      pt: {
        titulo: 'Pedicure tradicional',
        descripcion: 'Cuidado completo de pés e unhas com esmaltagem clássica.',
        beneficios: ['Cuidado completo dos pés', 'Acabamento clássico impecável'],
      },
    },
  },
  {
    slug: 'pedicura-semipermanente',
    familiaSlug: 'unas',
    orden: 7,
    porLocale: {
      es: {
        titulo: 'Pedicura semipermanente',
        descripcion: 'Pedicura completa con esmaltado de larga duración.',
        beneficios: ['Acabado de larga duración', 'Cuidado completo de los pies'],
      },
      ca: {
        titulo: 'Pedicura semipermanent',
        descripcion: 'Pedicura completa amb esmalt de llarga durada.',
        beneficios: ['Acabat de llarga durada', 'Cura completa dels peus'],
      },
      en: {
        titulo: 'Gel pedicure',
        descripcion: 'A complete pedicure with long-lasting polish.',
        beneficios: ['A long-lasting finish', 'Complete foot care'],
      },
      it: {
        titulo: 'Pedicure semipermanente',
        descripcion: 'Pedicure completa con smalto di lunga durata.',
        beneficios: ['Finitura di lunga durata', 'Cura completa dei piedi'],
      },
      fr: {
        titulo: 'Pédicure semi-permanente',
        descripcion: 'Une pédicure complète avec un vernis longue tenue.',
        beneficios: ['Une finition longue tenue', 'Un soin complet des pieds'],
      },
      pt: {
        titulo: 'Pedicure semipermanente',
        descripcion: 'Pedicure completa com esmaltagem de longa duração.',
        beneficios: ['Acabamento de longa duração', 'Cuidado completo dos pés'],
      },
    },
  },

  // ── Pestañas y cejas ─────────────────────────────────────────────────
  {
    slug: 'lifting-pestanas',
    familiaSlug: 'pestanas-cejas',
    orden: 1,
    destacado: true,
    porLocale: {
      es: {
        titulo: 'Lifting de pestañas',
        descripcion: 'Técnica que curva y realza las pestañas de forma natural.',
        beneficios: ['Mirada más abierta de forma natural', 'Resultado que dura semanas', 'Sin necesidad de rizador diario'],
      },
      ca: {
        titulo: 'Lifting de pestanyes',
        descripcion: 'Tècnica que corba i realça les pestanyes de manera natural.',
        beneficios: ['Mirada més oberta de manera natural', 'Resultat que dura setmanes', 'Sense necessitat de rínxol diari'],
      },
      en: {
        titulo: 'Lash lift',
        descripcion: 'A technique that curls and enhances lashes naturally.',
        beneficios: ['A naturally more open look', 'Results that last for weeks', 'No need for a daily eyelash curler'],
      },
      it: {
        titulo: 'Lifting delle ciglia',
        descripcion: 'Una tecnica che incurva e valorizza le ciglia in modo naturale.',
        beneficios: ['Uno sguardo più aperto in modo naturale', 'Un risultato che dura settimane', 'Senza bisogno dell’arricciaciglia quotidiano'],
      },
      fr: {
        titulo: 'Rehaussement de cils',
        descripcion: 'Une technique qui recourbe et sublime les cils naturellement.',
        beneficios: ['Un regard plus ouvert et naturel', 'Un résultat qui dure des semaines', 'Plus besoin de recourbe-cils quotidien'],
      },
      pt: {
        titulo: 'Lifting de pestanas',
        descripcion: 'Uma técnica que encaracola e realça as pestanas de forma natural.',
        beneficios: ['Olhar mais aberto de forma natural', 'Resultado que dura semanas', 'Sem necessidade de curvex diário'],
      },
    },
  },
  {
    slug: 'lifting-pestanas-tinte',
    familiaSlug: 'pestanas-cejas',
    orden: 2,
    porLocale: {
      es: {
        titulo: 'Lifting de pestañas + tinte',
        descripcion: 'Combina el lifting de pestañas con tinte para un resultado más intenso.',
        beneficios: ['Combina curvatura y color', 'Resultado más definido'],
      },
      ca: {
        titulo: 'Lifting de pestanyes + tint',
        descripcion: 'Combina el lifting de pestanyes amb tint per a un resultat més intens.',
        beneficios: ['Combina corbatura i color', 'Resultat més definit'],
      },
      en: {
        titulo: 'Lash lift + tint',
        descripcion: 'Combines a lash lift with tinting for a more intense result.',
        beneficios: ['Combines curl and colour', 'A more defined result'],
      },
      it: {
        titulo: 'Lifting ciglia + tinta',
        descripcion: 'Combina il lifting delle ciglia con la tinta per un risultato più intenso.',
        beneficios: ['Unisce curvatura e colore', 'Un risultato più definito'],
      },
      fr: {
        titulo: 'Rehaussement de cils + teinture',
        descripcion: 'Associe le rehaussement de cils à une teinture pour un résultat plus intense.',
        beneficios: ['Combine courbure et couleur', 'Un résultat plus défini'],
      },
      pt: {
        titulo: 'Lifting de pestanas + tinta',
        descripcion: 'Combina o lifting de pestanas com tinta para um resultado mais intenso.',
        beneficios: ['Combina curvatura e cor', 'Resultado mais definido'],
      },
    },
  },
  {
    slug: 'tinte-pestanas-cejas',
    familiaSlug: 'pestanas-cejas',
    orden: 3,
    porLocale: {
      es: {
        titulo: 'Tinte',
        descripcion: 'Tinte de pestañas o cejas para intensificar su color.',
        beneficios: ['Mirada más definida', 'Servicio breve'],
      },
      ca: {
        titulo: 'Tint',
        descripcion: 'Tint de pestanyes o celles per intensificar-ne el color.',
        beneficios: ['Mirada més definida', 'Servei breu'],
      },
      en: {
        titulo: 'Tint',
        descripcion: 'Eyelash or eyebrow tinting to intensify their colour.',
        beneficios: ['A more defined look', 'A brief service'],
      },
      it: {
        titulo: 'Tinta',
        descripcion: 'Tinta per ciglia o sopracciglia per intensificarne il colore.',
        beneficios: ['Uno sguardo più definito', 'Servizio breve'],
      },
      fr: {
        titulo: 'Teinture',
        descripcion: 'Une teinture des cils ou des sourcils pour intensifier leur couleur.',
        beneficios: ['Un regard plus défini', 'Un service bref'],
      },
      pt: {
        titulo: 'Tinta',
        descripcion: 'Tinta de pestanas ou sobrancelhas para intensificar a sua cor.',
        beneficios: ['Olhar mais definido', 'Serviço breve'],
      },
    },
  },
  {
    slug: 'laminado-cejas',
    familiaSlug: 'pestanas-cejas',
    orden: 4,
    porLocale: {
      es: {
        titulo: 'Laminado de cejas',
        descripcion: 'Técnica que peina y fija las cejas en la dirección deseada.',
        beneficios: ['Cejas con aspecto más pobladas', 'Efecto duradero'],
      },
      ca: {
        titulo: 'Laminat de celles',
        descripcion: 'Tècnica que pentina i fixa les celles en la direcció desitjada.',
        beneficios: ['Celles amb aspecte més poblat', 'Efecte durador'],
      },
      en: {
        titulo: 'Brow lamination',
        descripcion: 'A technique that brushes and sets the brows in the desired direction.',
        beneficios: ['Fuller-looking brows', 'A long-lasting effect'],
      },
      it: {
        titulo: 'Laminazione sopracciglia',
        descripcion: 'Tecnica che pettina e fissa le sopracciglia nella direzione desiderata.',
        beneficios: ['Sopracciglia dall’aspetto più folto', 'Effetto duraturo'],
      },
      fr: {
        titulo: 'Lamination des sourcils',
        descripcion: 'Une technique qui coiffe et fixe les sourcils dans la direction souhaitée.',
        beneficios: ['Des sourcils à l’aspect plus fourni', 'Un effet longue durée'],
      },
      pt: {
        titulo: 'Laminação de sobrancelhas',
        descripcion: 'Técnica que penteia e fixa as sobrancelhas na direção desejada.',
        beneficios: ['Sobrancelhas com aspeto mais preenchido', 'Efeito duradouro'],
      },
    },
  },
]
