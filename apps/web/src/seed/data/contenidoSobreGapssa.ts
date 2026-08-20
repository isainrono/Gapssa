import type { Locale } from '@/lib/i18n/locales'
import type { IconoDiferenciador } from '@/globals/ContenidoSobreGapssa'

type BioSeedLocale = {
  bioTitulo: string
  bioTexto: string
  bioCita: string
  bioBullets: string[]
}

/**
 * Biografía deliberadamente sin cifras de años de experiencia ni
 * titulaciones/certificaciones concretas — `PROJECT_CONTEXT.md` §6: "no
 * inventar titulaciones o certificaciones de Diana". Las estadísticas de
 * la maqueta ("5+ años", "+500 clientas") no se seedean en absoluto
 * (`ContenidoSobreGapssa.ts#estadisticas`, vacío por defecto).
 */
export const BIO_SEED: Record<Locale, BioSeedLocale> = {
  es: {
    bioTitulo: 'Diana, tu especialista en belleza',
    bioTexto:
      'Diana ha convertido su pasión por la estética en un espacio donde cada clienta recibe una atención completamente personalizada y profesional.',
    bioCita:
      'Cada mujer es única. Mi objetivo es ayudarte a sentirte bien contigo misma a través de tratamientos realizados con dedicación, precisión y cariño.',
    bioBullets: [
      'Formación continua en técnicas de estética facial y corporal',
      'Actualización constante en nuevas tecnologías y protocolos',
      'Atención cercana y trato personalizado en cada sesión',
    ],
  },
  ca: {
    bioTitulo: 'Diana, la teva especialista en bellesa',
    bioTexto:
      'La Diana ha convertit la seva passió per l’estètica en un espai on cada clienta rep una atenció completament personalitzada i professional.',
    bioCita:
      'Cada dona és única. El meu objectiu és ajudar-te a sentir-te bé amb tu mateixa a través de tractaments fets amb dedicació, precisió i afecte.',
    bioBullets: [
      'Formació contínua en tècniques d’estètica facial i corporal',
      'Actualització constant en noves tecnologies i protocols',
      'Atenció propera i tracte personalitzat en cada sessió',
    ],
  },
  en: {
    bioTitulo: 'Diana, your beauty specialist',
    bioTexto:
      'Diana has turned her passion for aesthetics into a space where every client receives fully personalised, professional attention.',
    bioCita:
      'Every woman is unique. My goal is to help you feel good about yourself through treatments carried out with dedication, precision and care.',
    bioBullets: [
      'Ongoing training in facial and body aesthetic techniques',
      'Continuous learning of new technologies and protocols',
      'A close, personalised approach in every session',
    ],
  },
  it: {
    bioTitulo: 'Diana, la tua specialista di bellezza',
    bioTexto:
      'Diana ha trasformato la sua passione per l’estetica in uno spazio dove ogni cliente riceve un’attenzione completamente personalizzata e professionale.',
    bioCita:
      'Ogni donna è unica. Il mio obiettivo è aiutarti a sentirti bene con te stessa attraverso trattamenti realizzati con dedizione, precisione e cura.',
    bioBullets: [
      'Formazione continua in tecniche di estetica viso e corpo',
      'Aggiornamento costante su nuove tecnologie e protocolli',
      'Un approccio vicino e personalizzato in ogni sessione',
    ],
  },
  fr: {
    bioTitulo: 'Diana, votre spécialiste beauté',
    bioTexto:
      'Diana a transformé sa passion pour l’esthétique en un lieu où chaque cliente reçoit une attention entièrement personnalisée et professionnelle.',
    bioCita:
      'Chaque femme est unique. Mon objectif est de vous aider à vous sentir bien dans votre peau grâce à des soins réalisés avec dévouement, précision et attention.',
    bioBullets: [
      'Formation continue aux techniques d’esthétique visage et corps',
      'Veille constante sur les nouvelles technologies et protocoles',
      'Un accompagnement proche et personnalisé à chaque séance',
    ],
  },
  pt: {
    bioTitulo: 'Diana, a sua especialista em beleza',
    bioTexto:
      'A Diana transformou a sua paixão pela estética num espaço onde cada cliente recebe uma atenção totalmente personalizada e profissional.',
    bioCita:
      'Cada mulher é única. O meu objetivo é ajudá-la a sentir-se bem consigo mesma através de tratamentos realizados com dedicação, precisão e carinho.',
    bioBullets: [
      'Formação contínua em técnicas de estética facial e corporal',
      'Atualização constante em novas tecnologias e protocolos',
      'Atendimento próximo e personalizado em cada sessão',
    ],
  },
}

type PasoSeed = { numero: number; porLocale: Record<Locale, { titulo: string; descripcion: string }> }

export const PROCESO_SEED: PasoSeed[] = [
  {
    numero: 1,
    porLocale: {
      es: { titulo: 'Diagnóstico', descripcion: 'Análisis de tu piel y tus necesidades para un plan completamente personalizado.' },
      ca: { titulo: 'Diagnòstic', descripcion: 'Anàlisi de la teva pell i les teves necessitats per a un pla completament personalitzat.' },
      en: { titulo: 'Assessment', descripcion: 'An analysis of your skin and needs to build a fully personalised plan.' },
      it: { titulo: 'Diagnosi', descripcion: 'Analisi della tua pelle e delle tue esigenze per un piano completamente personalizzato.' },
      fr: { titulo: 'Diagnostic', descripcion: 'Une analyse de votre peau et de vos besoins pour un plan entièrement personnalisé.' },
      pt: { titulo: 'Diagnóstico', descripcion: 'Análise da sua pele e das suas necessidades para um plano totalmente personalizado.' },
    },
  },
  {
    numero: 2,
    porLocale: {
      es: { titulo: 'Evaluación', descripcion: 'Definimos juntas el protocolo más adecuado para tus objetivos.' },
      ca: { titulo: 'Avaluació', descripcion: 'Definim juntes el protocol més adequat per als teus objectius.' },
      en: { titulo: 'Evaluation', descripcion: 'Together we define the most suitable protocol for your goals.' },
      it: { titulo: 'Valutazione', descripcion: 'Definiamo insieme il protocollo più adatto ai tuoi obiettivi.' },
      fr: { titulo: 'Évaluation', descripcion: 'Nous définissons ensemble le protocole le plus adapté à vos objectifs.' },
      pt: { titulo: 'Avaliação', descripcion: 'Definimos juntas o protocolo mais adequado aos seus objetivos.' },
    },
  },
  {
    numero: 3,
    porLocale: {
      es: { titulo: 'Tratamiento', descripcion: 'Aplicación del protocolo con técnicas cuidadas y productos seleccionados.' },
      ca: { titulo: 'Tractament', descripcion: 'Aplicació del protocol amb tècniques curades i productes seleccionats.' },
      en: { titulo: 'Treatment', descripcion: 'The protocol is carried out with careful technique and selected products.' },
      it: { titulo: 'Trattamento', descripcion: 'Applicazione del protocollo con tecniche curate e prodotti selezionati.' },
      fr: { titulo: 'Soin', descripcion: 'Application du protocole avec des techniques soignées et des produits sélectionnés.' },
      pt: { titulo: 'Tratamento', descripcion: 'Aplicação do protocolo com técnicas cuidadas e produtos selecionados.' },
    },
  },
  {
    numero: 4,
    porLocale: {
      es: { titulo: 'Seguimiento', descripcion: 'Pautas y recomendaciones personalizadas para acompañar los resultados.' },
      ca: { titulo: 'Seguiment', descripcion: 'Pautes i recomanacions personalitzades per acompanyar els resultats.' },
      en: { titulo: 'Follow-up', descripcion: 'Personalised guidance and recommendations to support your results.' },
      it: { titulo: 'Follow-up', descripcion: 'Indicazioni e consigli personalizzati per accompagnare i risultati.' },
      fr: { titulo: 'Suivi', descripcion: 'Des conseils et recommandations personnalisés pour accompagner les résultats.' },
      pt: { titulo: 'Acompanhamento', descripcion: 'Indicações e recomendações personalizadas para acompanhar os resultados.' },
    },
  },
  {
    numero: 5,
    porLocale: {
      es: { titulo: 'Resultados', descripcion: 'Tu experiencia y bienestar, siempre en el centro de cada sesión.' },
      ca: { titulo: 'Resultats', descripcion: 'La teva experiència i benestar, sempre al centre de cada sessió.' },
      en: { titulo: 'Results', descripcion: 'Your experience and wellbeing, always at the centre of every session.' },
      it: { titulo: 'Risultati', descripcion: 'La tua esperienza e il tuo benessere, sempre al centro di ogni sessione.' },
      fr: { titulo: 'Résultats', descripcion: 'Votre expérience et votre bien-être, toujours au cœur de chaque séance.' },
      pt: { titulo: 'Resultados', descripcion: 'A sua experiência e bem-estar, sempre no centro de cada sessão.' },
    },
  },
]

type DiferenciadorSeed = {
  iconoClave: IconoDiferenciador
  porLocale: Record<Locale, { titulo: string; descripcion: string }>
}

export const DIFERENCIADORES_SEED: DiferenciadorSeed[] = [
  {
    iconoClave: 'atencion-personalizada',
    porLocale: {
      es: { titulo: 'Atención personalizada', descripcion: 'Cada clienta recibe un protocolo pensado para sus necesidades y objetivos.' },
      ca: { titulo: 'Atenció personalitzada', descripcion: 'Cada clienta rep un protocol pensat per a les seves necessitats i objectius.' },
      en: { titulo: 'Personalised care', descripcion: 'Every client receives a protocol designed around her needs and goals.' },
      it: { titulo: 'Attenzione personalizzata', descripcion: 'Ogni cliente riceve un protocollo pensato per le sue esigenze e i suoi obiettivi.' },
      fr: { titulo: 'Attention personnalisée', descripcion: 'Chaque cliente reçoit un protocole pensé pour ses besoins et ses objectifs.' },
      pt: { titulo: 'Atendimento personalizado', descripcion: 'Cada cliente recebe um protocolo pensado para as suas necessidades e objetivos.' },
    },
  },
  {
    iconoClave: 'productos-premium',
    porLocale: {
      es: { titulo: 'Productos cuidados', descripcion: 'Trabajamos con productos seleccionados por su calidad y seguridad.' },
      ca: { titulo: 'Productes curats', descripcion: 'Treballem amb productes seleccionats per la seva qualitat i seguretat.' },
      en: { titulo: 'Carefully chosen products', descripcion: 'We work with products selected for their quality and safety.' },
      it: { titulo: 'Prodotti curati', descripcion: 'Lavoriamo con prodotti selezionati per qualità e sicurezza.' },
      fr: { titulo: 'Des produits sélectionnés', descripcion: 'Nous travaillons avec des produits choisis pour leur qualité et leur sécurité.' },
      pt: { titulo: 'Produtos cuidados', descripcion: 'Trabalhamos com produtos selecionados pela sua qualidade e segurança.' },
    },
  },
  {
    iconoClave: 'experiencia-avalada',
    porLocale: {
      es: { titulo: 'Formación continua', descripcion: 'Actualización constante en técnicas y protocolos de estética.' },
      ca: { titulo: 'Formació contínua', descripcion: 'Actualització constant en tècniques i protocols d’estètica.' },
      en: { titulo: 'Ongoing training', descripcion: 'Continuous learning in aesthetic techniques and protocols.' },
      it: { titulo: 'Formazione continua', descripcion: 'Aggiornamento costante su tecniche e protocolli estetici.' },
      fr: { titulo: 'Formation continue', descripcion: 'Une veille constante sur les techniques et protocoles esthétiques.' },
      pt: { titulo: 'Formação contínua', descripcion: 'Atualização constante em técnicas e protocolos de estética.' },
    },
  },
  {
    iconoClave: 'cuidado-con-carino',
    porLocale: {
      es: { titulo: 'Cuidado con cariño', descripcion: 'Cada tratamiento se realiza con dedicación y un trato cercano.' },
      ca: { titulo: 'Cura amb afecte', descripcion: 'Cada tractament es fa amb dedicació i un tracte proper.' },
      en: { titulo: 'Caring approach', descripcion: 'Every treatment is carried out with dedication and a warm, personal touch.' },
      it: { titulo: 'Cura con affetto', descripcion: 'Ogni trattamento viene svolto con dedizione e un tocco vicino.' },
      fr: { titulo: 'Un soin attentionné', descripcion: 'Chaque soin est réalisé avec dévouement et une approche chaleureuse.' },
      pt: { titulo: 'Cuidado com carinho', descripcion: 'Cada tratamento é realizado com dedicação e um trato próximo.' },
    },
  },
  {
    iconoClave: 'resultados-naturales',
    porLocale: {
      es: { titulo: 'Resultados naturales', descripcion: 'Potenciamos tu belleza natural sin alterar tu esencia.' },
      ca: { titulo: 'Resultats naturals', descripcion: 'Potenciem la teva bellesa natural sense alterar la teva essència.' },
      en: { titulo: 'Natural-looking results', descripcion: 'We enhance your natural beauty without changing who you are.' },
      it: { titulo: 'Risultati naturali', descripcion: 'Valorizziamo la tua bellezza naturale senza alterare la tua essenza.' },
      fr: { titulo: 'Des résultats naturels', descripcion: 'Nous mettons en valeur votre beauté naturelle sans altérer votre essence.' },
      pt: { titulo: 'Resultados naturais', descripcion: 'Potenciamos a sua beleza natural sem alterar a sua essência.' },
    },
  },
  {
    iconoClave: 'seguimiento-individual',
    porLocale: {
      es: { titulo: 'Seguimiento individual', descripcion: 'Te acompañamos con pautas y seguimiento después de cada sesión.' },
      ca: { titulo: 'Seguiment individual', descripcion: 'T’acompanyem amb pautes i seguiment després de cada sessió.' },
      en: { titulo: 'Individual follow-up', descripcion: 'We stay with you with guidance and follow-up after every session.' },
      it: { titulo: 'Follow-up individuale', descripcion: 'Ti accompagniamo con indicazioni e follow-up dopo ogni sessione.' },
      fr: { titulo: 'Suivi individuel', descripcion: 'Nous vous accompagnons avec des conseils et un suivi après chaque séance.' },
      pt: { titulo: 'Acompanhamento individual', descripcion: 'Acompanhamo-la com indicações e seguimento após cada sessão.' },
    },
  },
]
