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
        titulo: 'Términos, Condiciones y Políticas del Servicio',
        contenido: `1. Preparación para Servicios de Depilación Láser
Para garantizar la máxima eficacia y seguridad del tratamiento, es imprescindible acudir a la cita con la zona correspondiente rasurada con 48 horas de antelación. En caso de presentarse sin el rasurado previo requerido, el centro aplicará un suplemento adicional por el servicio de preparación en cabina.

2. Estado de la Piel y Aptitud para Tratamientos
Por motivos de salud, seguridad e higiene, nos reservamos el derecho de no realizar el tratamiento en los siguientes casos:
• Depilación: Presencia de lesiones, heridas abiertas, piel irritada, alterada o con exposición solar reciente.
• Tratamientos Faciales: Cuadros de hipersensibilidad cutánea, dermatitis activa o afecciones que contravengan la aplicación segura de nuestros protocolos.
Nota: La valoración final de la aptitud de la piel la realizará la especialista previa a la sesión.

3. Política de Reservas y Depósitos
Para confirmar y asegurar la reserva de tu cita, se requerirá el abono previo de un depósito / señal. Dicho importe será descontado del valor total del servicio el día de tu visita.

4. Cancelaciones, Modificaciones y Penalizaciones
Comprendemos que pueden surgir imprevistos; no obstante, exigimos un aviso previo con un mínimo de 24 horas de antelación para cancelar o reprogramar cualquier cita.
• Las cancelaciones o modificaciones notificadas con menos de 24 horas de antelación incurrirán en una penalización equivalente al 50% del valor total del tratamiento reservado (la cual se cobrará directamente o se descontará del depósito abonado).

5. Política de Puntualidad
Agradecemos llegar a tiempo a tu cita para garantizar la calidad del servicio de todos nuestros clientes.
• Se otorgará un margen de tolerancia máximo de 10 minutos.
• Superado este tiempo, el centro se reserva el derecho de reducir la duración del tratamiento o reprogramar la cita para evitar retrasos en las agendas del resto de usuarias/os, aplicándose la penalización correspondiente por cancelación fuera de plazo si la cita no pudiera llevarse a cabo.

6. Código de Conducta y Respeto en Cabina
Mantenemos un compromiso firme con un entorno de trabajo seguro, profesional y respetuoso. Cualquier falta de respeto, actitud inapropiada o conducta verbalmente agresiva hacia nuestro personal facultará inmediatamente a la especialista a suspender el servicio y solicitar el abandono de las instalaciones.`,
      },
      ca: {
        titulo: 'Termes, Condicions i Polítiques del Servei',
        contenido: `1. Preparació per a Serveis de Depilació Làser
Per garantir la màxima eficàcia i seguretat del tractament, és imprescindible acudir a la cita amb la zona corresponent rasurada amb 48 hores d'antelació. En cas de presentar-se sense el rasurat previ requerit, el centre aplicarà un suplement addicional pel servei de preparació en cabina.

2. Estat de la Pell i Aptitud per a Tractaments
Per motius de salut, seguretat i higiene, ens reservem el dret de no realitzar el tractament en els següents casos:
• Depilació: Presència de lesions, ferides obertes, pell irritada, alterada o amb exposició solar recent.
• Tractaments Facials: Quadres d'hipersensibilitat cutània, dermatitis activa o afeccions que contravinguin l'aplicació segura dels nostres protocols.
Nota: La valoració final de l'aptitud de la pell la realitzarà l'especialista prèvia a la sessió.

3. Política de Reserves i Dipòsits
Per confirmar i assegurar la reserva de la teva cita, es requerirà l'abonament previ d'un dipòsit / paga i senyal. Aquest import serà descomptat del valor total del servei el dia de la teva visita.

4. Cancel·lacions, Modificacions i Penalitzacions
Comprenem que poden sorgir imprevistos; no obstant això, exigim un avís previ amb un mínim de 24 hores d'antelació per cancel·lar o reprogramar qualsevol cita.
• Les cancel·lacions o modificacions notificades amb menys de 24 hores d'antelació incorreran en una penalització equivalent al 50% del valor total del tractament reservat (la qual es cobrarà directament o es descomptarà del dipòsit abonat).

5. Política de Puntualitat
Agraïm arribar a temps a la teva cita per garantir la qualitat del servei de tots els nostres clients.
• S'atorgarà un marge de tolerància màxim de 10 minuts.
• Superat aquest temps, el centre es reserva el dret de reduir la durada del tractament o reprogramar la cita per evitar retards a les agendes de la resta d'usuaris/es, aplicant-se la penalització corresponent per cancel·lació fora de termini si la cita no pogués dur-se a terme.

6. Codi de Conducta i Respecte en Cabina
Mantenim un compromís ferm amb un entorn de treball segur, professional i respectuós. Qualsevol falta de respecte, actitud inapropiada o conducta verbalment agressiva envers el nostre personal facultarà immediatament l'especialista a suspendre el servei i sol·licitar l'abandonament de les instal·lacions.`,
      },
      en: {
        titulo: 'Terms, Conditions and Service Policies',
        contenido: `1. Preparation for Laser Hair Removal Services
To ensure maximum treatment efficacy and safety, it is essential to arrive at the appointment with the relevant area shaved 48 hours in advance. If attending without the required prior shaving, an additional fee will be applied for in-cabin preparation service.

2. Skin Condition and Fitness for Treatments
For health, safety, and hygiene reasons, we reserve the right not to perform the treatment in the following circumstances:
• Hair Removal: Presence of lesions, open wounds, irritated or compromised skin, or recent sun exposure.
• Facial Treatments: Severe skin hypersensitivity, active dermatitis, or conditions conflicting with the safe application of our protocols.
Note: The final evaluation of skin suitability will be conducted by the specialist prior to the session.

3. Booking and Deposit Policy
To confirm and secure your appointment booking, an advance deposit is required. This amount will be deducted from the total service price on the day of your visit.

4. Cancellations, Rescheduling and Penalties
We understand that unforeseen events may occur; however, we require a minimum of 24 hours advance notice to cancel or reschedule any appointment.
• Cancellations or modifications notified with less than 24 hours notice will incur a penalty equivalent to 50% of the total reserved treatment value (charged directly or deducted from the paid deposit).

5. Punctuality Policy
We appreciate arriving on time for your appointment to ensure high-quality service for all our clients.
• A maximum grace period of 10 minutes will be granted.
• Beyond this time, the centre reserves the right to shorten the treatment duration or reschedule the appointment to avoid delays for other clients, with the applicable late cancellation penalty if the appointment cannot take place.

6. Code of Conduct and Respect in Cabin
We maintain a firm commitment to a safe, professional, and respectful environment. Any disrespect, inappropriate attitude, or verbally aggressive behaviour towards our staff will immediately entitle the specialist to suspend the service and request departure from the premises.`,
      },
      it: {
        titulo: 'Termini, Condizioni e Politiche di Servizio',
        contenido: `1. Preparazione per i Servizi di Epilazione Laser
Per garantire la massima efficacia e sicurezza del trattamento, è indispensabile presentarsi all'appuntamento con la zona interessata rasata 48 ore prima. In caso di mancata rasatura preventiva, il centro applicherà un supplemento per il servizio di preparazione in cabina.

2. Stato della Pelle e Idoneità ai Trattamenti
Per motivi di salute, sicurezza e igiene, ci riserviamo il diritto di non effettuare il trattamento nei seguenti casi:
• Epilazione: Presenza di lesioni, ferite aperte, pelle irritata o recente esposizione al sole.
• Trattamenti Viso: Ipersensibilità cutanea, dermatite attiva o condizioni incompatibili con l'applicazione sicura dei nostri protocolli.
Nota: La valutazione finale dell'idoneità della pelle sarà effettuata dalla specialista prima della sessione.

3. Politica di Prenotazione e Depositi
Per confermare e garantire la prenotazione dell'appuntamento, è richiesto il versamento anticipato di un acconto/caparra. Tale importo verrà scalato dal valore totale del servizio il giorno della visita.

4. Cancellazioni, Modifiche e Penali
Comprendiamo che possano verificarsi imprevisti; tuttavia, richiediamo un preavviso minimo di 24 ore per cancellare o riprogrammare qualsiasi appuntamento.
• Le cancellazioni o modifiche comunicate con meno di 24 ore di anticipo comporteranno una penale pari al 50% del valore totale del trattamento prenotato (addebitata direttamente o trattenuta dall'acconto).

5. Politica di Puntualità
Chiediamo cortesemente di arrivare puntuali all'appuntamento per garantire la qualità del servizio a tutti i nostri clienti.
• Sarà concesso un margine di tolleranza massimo di 10 minuti.
• Oltre questo termine, il centro si riserva il diritto di ridurre la durata del trattamento o di riprogrammare l'appuntamento per evitare ritardi, applicando la penale per cancellazione tardiva qualora l'appuntamento non possa essere svolto.

6. Codice di Condotta e Rispetto in Cabina
Manteniamo un fermo impegno per un ambiente di lavoro sicuro, professionale e rispettoso. Qualsiasi mancanza di rispetto o comportamento inappropriato verso il nostro personale autorizzerà immediatamente la specialista a sospendere il servizio e richiedere l'uscita dalla struttura.`,
      },
      fr: {
        titulo: 'Conditions Générales et Politiques de Service',
        contenido: `1. Préparation pour les Soins d’Épilation Laser
Afin de garantir l’efficacité et la sécurité optimales du soin, il est indispensable de se présenter au rendez-vous avec la zone concernée rasée 48 heures à l’avance. En cas de non-rasage préalable, un supplément sera appliqué pour la préparation en cabine.

2. État de la Peau et Aptitude aux Soins
Pour des raisons de santé, de sécurité et d’hygiène, nous nous réservons le droit de ne pas effectuer le soin dans les cas suivants :
• Épilation : Présence de lésions, plaies ouvertes, peau irritée ou exposition solaire récente.
• Soins du Visage : Hypersensibilité cutanée, dermatite active ou affections incompatibles avec l’application sécurisée de nos protocoles.
Remarque : L’évaluation finale de l’aptitude de la peau est réalisée par la spécialiste avant la séance.

3. Politique de Réservation et d’Acompte
Pour confirmer et garantir la réservation de votre rendez-vous, le versement préalable d’un acompte sera exigé. Ce montant sera déduit du montant total de la prestation le jour de votre visite.

4. Annulations, Modifications et Pénalités
Nous comprenons que des imprévus puissent survenir ; néanmoins, nous exigeons un préavis d’au moins 24 heures pour annuler ou reporter un rendez-vous.
• Toute annulation ou modification notifiée moins de 24 heures à l’avance entraînera une pénalité équivalant à 50 % de la valeur totale du soin réservé (facturée directement ou déduite de l’acompte).

5. Politique de Ponctualité
Nous vous remercions d’arriver à l’heure afin de garantir la qualité de service pour l’ensemble de nos clientes et clients.
• Un délai de tolérance maximal de 10 minutes sera accordé.
• Au-delà de ce délai, le centre se réserve le droit de réduire la durée du soin ou de reporter le rendez-vous, avec application de la pénalité pour annulation tardive si le soin ne peut avoir lieu.

6. Code de Conduite et Respect en Cabine
Nous accordons une importance primordiale à un environnement de travail sécurisé, professionnel et respectueux. Tout manque de respect, attitude inappropriée ou comportement agressif envers notre personnel autorisera la spécialiste à interrompre immédiatement la prestation et à demander de quitter les lieux.`,
      },
      pt: {
        titulo: 'Termos, Condições e Políticas de Serviço',
        contenido: `1. Preparação para Serviços de Depilação a Laser
Para garantir a máxima eficácia e segurança do tratamento, é imprescindível comparecer à consulta com a área correspondente rapada com 48 horas de antecedência. Em caso de comparência sem a depilação prévia necessária, será aplicado um suplemento adicional pelo serviço de preparação em cabine.

2. Estado da Pele e Aptidão para Tratamentos
Por motivos de saúde, segurança e higiene, reservamo-nos o direito de não realizar o tratamento nos seguintes casos:
• Depilação: Presença de lesões, feridas abertas, pele irritada ou com exposição solar recente.
• Tratamentos Faciais: Hipersensibilidade cutânea, dermatite ativa ou condições contrárias à aplicação segura dos nossos protocolos.
Nota: A avaliação final da aptidão da pele será realizada pela especialista antes da sessão.

3. Política de Reservas e Sinal
Para confirmar e assegurar a marcação da sua consulta, será exigido o pagamento prévio de um sinal / depósito. Este valor será descontado do total do serviço no dia da sua visita.

4. Cancelamentos, Alterações e Penalizações
Compreendemos que imprevistos acontecem; contudo, exigimos um aviso prévio com um mínimo de 24 horas de antecedência para cancelar ou reagendar qualquer marcação.
• Cancelamentos ou alterações comunicados com menos de 24 horas de antecedência incorrerão numa penalização equivalente a 50% do valor total do tratamento reservado (cobrada diretamente ou descontada do sinal pago).

5. Política de Pontualidade
Agradecemos a chegada pontual à sua consulta para garantir a qualidade de atendimento a todos os nossos clientes.
• Será concedida uma tolerância máxima de 10 minutos.
• Ultrapassado este tempo, o centro reserva-se o direito de reduzir a duração do tratamento ou reagendar a consulta, aplicando-se a devida penalização por cancelamento fora de prazo caso a consulta não se possa realizar.

6. Código de Conducta e Respeito em Cabine
Mantemos um compromisso firme com um ambiente de trabalho seguro, profissional e respeitoso. Qualquer falta de respeito, atitude imprópria ou agressividade para com a nossa equipa facultará imediatamente à especialista a suspensão do serviço e a solicitação de saída das instalações.`,
      },
    },
  },
]
