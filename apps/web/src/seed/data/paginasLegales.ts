import type { Locale } from '@/lib/i18n/locales'

import type { TipoPaginaLegal } from '@/collections/PaginasLegales'

export type PaginaLegalSeed = {
  tipo: TipoPaginaLegal
  porLocale: Record<Locale, { titulo: string; contenido: string }>
}

/**
 * Textos legales genéricos y deliberadamente provisionales
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §9, §11). No incluyen NIF, razón
 * social, teléfono ni correo legal — ninguno de esos datos está
 * confirmado todavía (`PROJECT_CONTEXT.md` §19) y no se inventan. Cada
 * texto lo dice explícitamente y se marca `estado: "provisional"` +
 * `seoNoIndex: true` en el seed (`index.ts`).
 */
export const PAGINAS_LEGALES_SEED: PaginaLegalSeed[] = [
  {
    tipo: 'aviso-legal',
    porLocale: {
      es: {
        titulo: 'Aviso legal',
        contenido: `Este es un texto provisional y genérico, pendiente de revisión legal definitiva por parte de Gapssa.

Información legal pendiente de validación: los datos de identificación del titular del sitio (razón social, NIF, domicilio social y datos de contacto legal) se completarán antes de la puesta en producción de este sitio web.

GAPSSA by Nana presta servicios de estética y belleza en Barcelona. El uso de este sitio web implica la aceptación de las condiciones que se publiquen en su versión definitiva.

Este aviso no debe interpretarse como una versión final ni vinculante. Se sustituirá por un texto validado antes del lanzamiento en producción.`,
      },
      ca: {
        titulo: 'Avís legal',
        contenido: `Aquest és un text provisional i genèric, pendent de revisió legal definitiva per part de Gapssa.

Informació legal pendent de validació: les dades d’identificació del titular del lloc web (raó social, NIF, domicili social i dades de contacte legal) es completaran abans de la posada en producció d’aquest lloc web.

GAPSSA by Nana ofereix serveis d’estètica i bellesa a Barcelona. L’ús d’aquest lloc web implica l’acceptació de les condicions que es publiquin en la seva versió definitiva.

Aquest avís no s’ha d’interpretar com una versió final ni vinculant. Se substituirà per un text validat abans del llançament en producció.`,
      },
      en: {
        titulo: 'Legal notice',
        contenido: `This is a provisional, generic text pending final legal review by Gapssa.

Legal information pending validation: the identification details of the site owner (legal name, tax ID, registered address and legal contact details) will be completed before this website goes into production.

GAPSSA by Nana provides beauty and aesthetic services in Barcelona. Use of this website implies acceptance of the terms that will be published in their final version.

This notice should not be read as a final or binding version. It will be replaced with a validated text before the production launch.`,
      },
      it: {
        titulo: 'Note legali',
        contenido: `Questo è un testo provvisorio e generico, in attesa di revisione legale definitiva da parte di Gapssa.

Informazioni legali in attesa di convalida: i dati identificativi del titolare del sito (ragione sociale, partita IVA, sede legale e recapiti legali) saranno completati prima della messa in produzione di questo sito web.

GAPSSA by Nana offre servizi di estetica e bellezza a Barcellona. L’uso di questo sito web implica l’accettazione delle condizioni che verranno pubblicate nella loro versione definitiva.

Questa nota non deve essere considerata una versione finale o vincolante. Sarà sostituita da un testo convalidato prima del lancio in produzione.`,
      },
      fr: {
        titulo: 'Mentions légales',
        contenido: `Ceci est un texte provisoire et générique, en attente de révision juridique définitive par Gapssa.

Informations légales en attente de validation : les données d’identification de la titulaire du site (raison sociale, numéro fiscal, siège social et coordonnées légales) seront complétées avant la mise en production de ce site web.

GAPSSA by Nana propose des services d’esthétique et de beauté à Barcelone. L’utilisation de ce site implique l’acceptation des conditions qui seront publiées dans leur version définitive.

Ces mentions ne doivent pas être considérées comme une version finale ou contraignante. Elles seront remplacées par un texte validé avant le lancement en production.`,
      },
      pt: {
        titulo: 'Aviso legal',
        contenido: `Este é um texto provisório e genérico, pendente de revisão legal definitiva por parte da Gapssa.

Informação legal pendente de validação: os dados de identificação da titular do site (denominação social, NIF, sede social e dados de contacto legal) serão completados antes da entrada em produção deste site.

A GAPSSA by Nana presta serviços de estética e beleza em Barcelona. A utilização deste site implica a aceitação das condições que serão publicadas na sua versão definitiva.

Este aviso não deve ser interpretado como uma versão final ou vinculativa. Será substituído por um texto validado antes do lançamento em produção.`,
      },
    },
  },
  {
    tipo: 'privacidad',
    porLocale: {
      es: {
        titulo: 'Política de privacidad',
        contenido: `Este es un texto provisional y genérico, pendiente de revisión legal definitiva por parte de Gapssa.

Información legal pendiente de validación: la identidad y los datos de contacto del responsable del tratamiento se completarán antes de la puesta en producción de este sitio web.

Los datos personales que en el futuro se recojan a través de este sitio (por ejemplo, al reservar una cita o completar un formulario de contacto) se tratarán con la finalidad de gestionar esa solicitud, con las bases legales, plazos de conservación y derechos de acceso, rectificación, supresión y oposición que se detallarán en la versión definitiva de esta política.

En Fase 2 de este sitio web no se procesan reservas ni formularios reales: no se recogen todavía datos personales a través de las páginas públicas más allá de lo estrictamente técnico.`,
      },
      ca: {
        titulo: 'Política de privacitat',
        contenido: `Aquest és un text provisional i genèric, pendent de revisió legal definitiva per part de Gapssa.

Informació legal pendent de validació: la identitat i les dades de contacte de la responsable del tractament es completaran abans de la posada en producció d’aquest lloc web.

Les dades personals que en el futur es recullin a través d’aquest lloc (per exemple, en reservar una cita o completar un formulari de contacte) es tractaran amb la finalitat de gestionar aquesta sol·licitud, amb les bases legals, terminis de conservació i drets d’accés, rectificació, supressió i oposició que es detallaran en la versió definitiva d’aquesta política.

En la Fase 2 d’aquest lloc web no es processen reserves ni formularis reals: no es recullen encara dades personals a través de les pàgines públiques més enllà del que és estrictament tècnic.`,
      },
      en: {
        titulo: 'Privacy policy',
        contenido: `This is a provisional, generic text pending final legal review by Gapssa.

Legal information pending validation: the identity and contact details of the data controller will be completed before this website goes into production.

Any personal data collected through this site in the future (for example, when booking an appointment or submitting a contact form) will be processed to manage that request, with the legal basis, retention periods and rights of access, rectification, erasure and objection detailed in the final version of this policy.

In Phase 2 of this website, no real bookings or forms are processed: no personal data is collected through the public pages beyond what is strictly technical.`,
      },
      it: {
        titulo: 'Informativa sulla privacy',
        contenido: `Questo è un testo provvisorio e generico, in attesa di revisione legale definitiva da parte di Gapssa.

Informazioni legali in attesa di convalida: l’identità e i recapiti del titolare del trattamento saranno completati prima della messa in produzione di questo sito web.

I dati personali eventualmente raccolti in futuro tramite questo sito (ad esempio prenotando un appuntamento o compilando un modulo di contatto) saranno trattati per gestire tale richiesta, con base giuridica, periodi di conservazione e diritti di accesso, rettifica, cancellazione e opposizione descritti nella versione definitiva di questa informativa.

Nella Fase 2 di questo sito web non vengono elaborate prenotazioni o moduli reali: non vengono ancora raccolti dati personali tramite le pagine pubbliche, salvo quanto strettamente tecnico.`,
      },
      fr: {
        titulo: 'Politique de confidentialité',
        contenido: `Ceci est un texte provisoire et générique, en attente de révision juridique définitive par Gapssa.

Informations légales en attente de validation : l’identité et les coordonnées de la responsable du traitement seront complétées avant la mise en production de ce site web.

Les données personnelles qui pourraient être collectées à l’avenir via ce site (par exemple lors d’une prise de rendez-vous ou d’un formulaire de contact) seront traitées pour gérer cette demande, avec la base légale, les durées de conservation et les droits d’accès, de rectification, d’effacement et d’opposition détaillés dans la version définitive de cette politique.

Dans la Phase 2 de ce site, aucune réservation ni aucun formulaire réel n’est traité : aucune donnée personnelle n’est encore collectée via les pages publiques, hormis ce qui est strictement technique.`,
      },
      pt: {
        titulo: 'Política de privacidade',
        contenido: `Este é um texto provisório e genérico, pendente de revisão legal definitiva por parte da Gapssa.

Informação legal pendente de validação: a identidade e os dados de contacto do responsável pelo tratamento serão completados antes da entrada em produção deste site.

Os dados pessoais eventualmente recolhidos no futuro através deste site (por exemplo, ao marcar uma consulta ou preencher um formulário de contacto) serão tratados com a finalidade de gerir esse pedido, com a base legal, os prazos de conservação e os direitos de acesso, retificação, eliminação e oposição detalhados na versão definitiva desta política.

Na Fase 2 deste site não são processadas marcações nem formulários reais: não são ainda recolhidos dados pessoais através das páginas públicas, para além do estritamente técnico.`,
      },
    },
  },
  {
    tipo: 'cookies',
    porLocale: {
      es: {
        titulo: 'Política de cookies',
        contenido: `Este es un texto provisional y genérico, pendiente de revisión legal definitiva por parte de Gapssa.

Actualmente este sitio web no utiliza cookies de analítica ni de publicidad. La analítica (Umami) está preparada técnicamente pero permanece desactivada: no se activará hasta disponer de un mecanismo de consentimiento adecuado.

Solo se utilizan, en su caso, cookies o almacenamiento técnico estrictamente necesario para el funcionamiento del sitio (por ejemplo, para recordar el idioma seleccionado), que no requieren consentimiento previo según la normativa aplicable.

Esta política se actualizará antes de activar cualquier cookie no esencial.`,
      },
      ca: {
        titulo: 'Política de cookies',
        contenido: `Aquest és un text provisional i genèric, pendent de revisió legal definitiva per part de Gapssa.

Actualment aquest lloc web no utilitza cookies d’analítica ni de publicitat. L’analítica (Umami) està preparada tècnicament però roman desactivada: no s’activarà fins a disposar d’un mecanisme de consentiment adequat.

Només s’utilitzen, si escau, cookies o emmagatzematge tècnic estrictament necessari per al funcionament del lloc (per exemple, per recordar l’idioma seleccionat), que no requereixen consentiment previ segons la normativa aplicable.

Aquesta política s’actualitzarà abans d’activar qualsevol cookie no essencial.`,
      },
      en: {
        titulo: 'Cookie policy',
        contenido: `This is a provisional, generic text pending final legal review by Gapssa.

This website currently does not use analytics or advertising cookies. Analytics (Umami) is technically prepared but remains inactive: it will not be enabled until an appropriate consent mechanism is in place.

Only strictly necessary technical cookies or storage may be used (for example, to remember the selected language), which do not require prior consent under applicable regulations.

This policy will be updated before any non-essential cookie is activated.`,
      },
      it: {
        titulo: 'Cookie policy',
        contenido: `Questo è un testo provvisorio e generico, in attesa di revisione legale definitiva da parte di Gapssa.

Attualmente questo sito web non utilizza cookie di analisi né pubblicitari. L’analisi (Umami) è predisposta tecnicamente ma resta disattivata: non verrà attivata finché non sarà disponibile un meccanismo di consenso adeguato.

Vengono utilizzati solo, se necessario, cookie o storage tecnico strettamente necessari al funzionamento del sito (ad esempio per ricordare la lingua selezionata), che non richiedono consenso preventivo secondo la normativa applicabile.

Questa informativa sarà aggiornata prima di attivare qualsiasi cookie non essenziale.`,
      },
      fr: {
        titulo: 'Politique de cookies',
        contenido: `Ceci est un texte provisoire et générique, en attente de révision juridique définitive par Gapssa.

Ce site n’utilise actuellement aucun cookie d’analyse ou publicitaire. L’outil d’analyse (Umami) est techniquement prêt mais reste désactivé : il ne sera activé qu’une fois un mécanisme de consentement approprié mis en place.

Seuls des cookies ou stockages techniques strictement nécessaires au fonctionnement du site peuvent être utilisés (par exemple pour mémoriser la langue choisie), sans consentement préalable requis selon la réglementation applicable.

Cette politique sera mise à jour avant l’activation de tout cookie non essentiel.`,
      },
      pt: {
        titulo: 'Política de cookies',
        contenido: `Este é um texto provisório e genérico, pendente de revisão legal definitiva por parte da Gapssa.

Atualmente este site não utiliza cookies de análise nem publicitários. A análise (Umami) está tecnicamente preparada mas permanece desativada: não será ativada até existir um mecanismo de consentimento adequado.

Apenas são utilizados, quando aplicável, cookies ou armazenamento técnico estritamente necessários ao funcionamento do site (por exemplo, para recordar o idioma selecionado), que não requerem consentimento prévio segundo a legislação aplicável.

Esta política será atualizada antes de ativar qualquer cookie não essencial.`,
      },
    },
  },
  {
    tipo: 'condiciones-reserva',
    porLocale: {
      es: {
        titulo: 'Condiciones de reserva',
        contenido: `Este es un texto provisional y genérico, pendiente de revisión legal definitiva por parte de Gapssa.

El sistema de reservas online todavía no está activo. Esta página se publica de forma preparatoria y no debe interpretarse como las condiciones definitivas del servicio de reservas.

Cuando el sistema de reservas entre en funcionamiento, esta página se sustituirá por condiciones completas que incluirán, entre otros aspectos, el proceso de solicitud y aprobación, los plazos de cancelación y las políticas aplicables, conforme a lo definido por Gapssa.

Mientras tanto, cualquier solicitud de cita se gestiona por los canales de contacto habituales indicados en la página de contacto.`,
      },
      ca: {
        titulo: 'Condicions de reserva',
        contenido: `Aquest és un text provisional i genèric, pendent de revisió legal definitiva per part de Gapssa.

El sistema de reserves en línia encara no està actiu. Aquesta pàgina es publica de manera preparatòria i no s’ha d’interpretar com les condicions definitives del servei de reserves.

Quan el sistema de reserves entri en funcionament, aquesta pàgina se substituirà per condicions completes que inclouran, entre altres aspectes, el procés de sol·licitud i aprovació, els terminis de cancel·lació i les polítiques aplicables, d’acord amb el que defineixi Gapssa.

Mentrestant, qualsevol sol·licitud de cita es gestiona pels canals de contacte habituals indicats a la pàgina de contacte.`,
      },
      en: {
        titulo: 'Booking terms',
        contenido: `This is a provisional, generic text pending final legal review by Gapssa.

The online booking system is not active yet. This page is published in preparation and should not be read as the final terms of the booking service.

Once the booking system is operational, this page will be replaced with complete terms covering, among other aspects, the request and approval process, cancellation windows and applicable policies, as defined by Gapssa.

In the meantime, any appointment request is handled through the usual contact channels listed on the contact page.`,
      },
      it: {
        titulo: 'Condizioni di prenotazione',
        contenido: `Questo è un testo provvisorio e generico, in attesa di revisione legale definitiva da parte di Gapssa.

Il sistema di prenotazione online non è ancora attivo. Questa pagina viene pubblicata in via preparatoria e non deve essere interpretata come le condizioni definitive del servizio di prenotazione.

Quando il sistema di prenotazione sarà operativo, questa pagina sarà sostituita da condizioni complete che includeranno, tra gli altri aspetti, il processo di richiesta e approvazione, i termini di cancellazione e le politiche applicabili, come definito da Gapssa.

Nel frattempo, qualsiasi richiesta di appuntamento viene gestita tramite i consueti canali di contatto indicati nella pagina dei contatti.`,
      },
      fr: {
        titulo: 'Conditions de réservation',
        contenido: `Ceci est un texte provisoire et générique, en attente de révision juridique définitive par Gapssa.

Le système de réservation en ligne n’est pas encore actif. Cette page est publiée à titre préparatoire et ne doit pas être interprétée comme les conditions définitives du service de réservation.

Une fois le système de réservation opérationnel, cette page sera remplacée par des conditions complètes couvrant, entre autres, le processus de demande et d’approbation, les délais d’annulation et les politiques applicables, telles que définies par Gapssa.

En attendant, toute demande de rendez-vous est traitée via les canaux de contact habituels indiqués sur la page de contact.`,
      },
      pt: {
        titulo: 'Condições de reserva',
        contenido: `Este é um texto provisório e genérico, pendente de revisão legal definitiva por parte da Gapssa.

O sistema de marcações online ainda não está ativo. Esta página é publicada de forma preparatória e não deve ser interpretada como as condições definitivas do serviço de marcações.

Quando o sistema de marcações entrar em funcionamento, esta página será substituída por condições completas que incluirão, entre outros aspetos, o processo de pedido e aprovação, os prazos de cancelamento e as políticas aplicáveis, conforme definido pela Gapssa.

Entretanto, qualquer pedido de consulta é gerido através dos canais de contacto habituais indicados na página de contacto.`,
      },
    },
  },
]
