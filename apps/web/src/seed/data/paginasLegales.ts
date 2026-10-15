import type { Locale } from '@/lib/i18n/locales'

import type { TipoPaginaLegal } from '@/collections/PaginasLegales'

export type PaginaLegalSeed = {
  tipo: TipoPaginaLegal
  porLocale: Record<Locale, { titulo: string; contenido: string }>
}

/**
 * Textos legales oficiales de GAPSSA by Nana conforme a la legislación española
 * y europea (RGPD UE 2016/679, LOPDGDD 3/2018 y LSSI-CE 34/2002).
 */
export const PAGINAS_LEGALES_SEED: PaginaLegalSeed[] = [
  {
    tipo: 'aviso-legal',
    porLocale: {
      es: {
        titulo: 'Aviso legal',
        contenido: `1. Datos Identificativos del Titular
En cumplimiento con el artículo 10 de la Ley 34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y del Comercio Electrónico (LSSI-CE), se informa a las personas usuarias de los datos identificativos del titular del sitio web:
• Titular: Diana Marcela Atehortua Ramirez
• Nombre Comercial: GAPSSA by Nana
• Domicilio del centro: Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona (España)
• Teléfono: +34 680 373 663
• Correo electrónico: gapssabynana@gmail.com
• Actividad: Servicios integrales de estética, cuidado facial, corporal y belleza.

2. Objeto y Ámbito de Aplicación
El presente Aviso Legal regula el acceso, navegación y uso del sitio web oficial de GAPSSA by Nana, así como las responsabilidades derivadas del uso de sus contenidos (textos, gráficos, fotografías, marcas y logotipos). El acceso a este sitio web atribuye la condición de Persona Usuaria e implica la aceptación plena y sin reservas de las presentes disposiciones.

3. Condiciones de Uso
La persona usuaria se compromete a hacer un uso lícito, diligente y de buena fe del sitio web, absteniéndose de realizar cualquier acto que dañe, inutilice, sobrecargue o impida el normal funcionamiento del portal o los derechos e intereses de GAPSSA by Nana o de terceros.

4. Propiedad Intelectual e Industrial
Todos los contenidos del sitio web, incluidos logotipos, isotipo oficial, fotografías de tratamientos, diseño gráfico, código y textos, son propiedad de GAPSSA by Nana o de terceros con autorización legítima de uso. Queda expresamente prohibida su reproducción, distribución o comunicación pública sin autorización previa y por escrito.

5. Responsabilidad y Enlaces
GAPSSA by Nana no se responsabiliza de los posibles daños derivados de interferencias, interrupciones o virus informáticos ajenos a su control razonable, ni del contenido de los enlaces a sitios web de terceros que puedan constar en el portal.

6. Legislación Aplicable y Jurisdicción
La relación entre la persona usuaria y GAPSSA by Nana se regirá por la normativa española vigente. Para la resolución de cualquier controversia, las partes se someten a los Juzgados y Tribunales de la ciudad de Barcelona, sin perjuicio de los fueros imperativos aplicables a consumidores y usuarios.`,
      },
      ca: {
        titulo: 'Avís legal',
        contenido: `1. Dades Identificatives de la Titular
En compliment de l'article 10 de la Llei 34/2002, d'11 de juliol, de Serveis de la Societat de la Informació i del Comerç Electrònic (LSSI-CE), s'informa a les persones usuàries de les dades identificatives de la titular del lloc web:
• Titular: Diana Marcela Atehortua Ramirez
• Nom Comercial: GAPSSA by Nana
• Domicili del centre: Carrer de Gayarre 24, Entresòl 2, 08014 Barcelona (Espanya)
• Telèfon: +34 680 373 663
• Correu electrònic: gapssabynana@gmail.com
• Activitat: Serveis integrals d'estètica, cura facial, corporal i bellesa.

2. Objecte i Àmbit d'Aplicació
Aquest Avís Legal regula l'accés, navegació i ús del lloc web oficial de GAPSSA by Nana, així com les responsabilitats derivades de l'ús dels seus continguts (textos, gràfics, fotografies, marques i logotips). L'accés a aquest lloc web atribueix la condició de Persona Usuària i implica l'acceptació plena i sense reserves d'aquestes disposicions.

3. Condicions d'Ús
La persona usuària es compromet a fer un ús lícit, diligent i de bona fe del lloc web, abstenint-se de realitzar qualsevol acte que danyi, inutilitzi, sobrecarregui o impedeixi el funcionament normal del portal o els drets i interessos de GAPSSA by Nana o de tercers.

4. Propietat Intel·lectual i Industrial
Tots els continguts del lloc web, inclosos logotips, isotip oficial, fotografies de tractaments, disseny gràfic, codi i textos, són propietat de GAPSSA by Nana o de tercers amb autorització legítima d'ús. Queda expressament prohibida la seva reproducció, distribució o comunicació pública sense autorització prèvia i per escrit.

5. Responsabilitat i Enllaços
GAPSSA by Nana no es responsabilitza dels possibles danys derivats d'interferències, interrupcions o virus informàtics aliens al seu control raonable, ni del contingut dels enllaços a llocs web de tercers que puguin constar al portal.

6. Legislació Aplicable i Jurisdicció
La relació entre la persona usuària i GAPSSA by Nana es regirà per la normativa espanyola vigent. Per a la resolució de qualsevol controvèrsia, les parts es sotmeten als Jutjats i Tribunals de la ciutat de Barcelona, sens perjudici dels furs imperatius aplicables a consumidors i usuaris.`,
      },
      en: {
        titulo: 'Legal notice',
        contenido: `1. Owner Identification Details
In compliance with Article 10 of Spanish Law 34/2002 of July 11 on Information Society Services and Electronic Commerce (LSSI-CE), users are informed of the identification details of the website owner:
• Owner: Diana Marcela Atehortua Ramirez
• Commercial Name: GAPSSA by Nana
• Business Address: Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona (Spain)
• Telephone: +34 680 373 663
• Email: gapssabynana@gmail.com
• Activity: Integral aesthetic services, facial and body care, and beauty treatments.

2. Purpose and Scope
This Legal Notice governs access, browsing, and use of the official GAPSSA by Nana website, as well as responsibilities arising from the use of its content (texts, graphics, photographs, trademarks, and logos). Access to this website confers User status and implies full and unreserved acceptance of these provisions.

3. Terms of Use
The user agrees to make lawful, diligent, and good-faith use of the website, refraining from any action that damages, disables, overburdens, or impairs normal website operation or the rights and interests of GAPSSA by Nana or third parties.

4. Intellectual and Industrial Property
All website content, including logos, official logomark, treatment photographs, graphic design, code, and texts, is the property of GAPSSA by Nana or third parties with legitimate authorization. Reproduction, distribution, or public communication without prior written consent is strictly prohibited.

5. Liability and Links
GAPSSA by Nana shall not be held liable for potential damages resulting from interference, interruptions, or computer viruses beyond reasonable control, nor for content found on third-party links included on the portal.

6. Applicable Law and Jurisdiction
The relationship between the user and GAPSSA by Nana shall be governed by current Spanish legislation. For the resolution of any dispute, the parties submit to the Courts and Tribunals of the city of Barcelona, without prejudice to mandatory statutory consumer jurisdiction.`,
      },
      it: {
        titulo: 'Note legali',
        contenido: `1. Dati Identificativi del Titolare
In conformità all'articolo 10 della Legge 34/2002 dell'11 luglio sui Servizi della Società dell'Informazione e del Commercio Elettronico (LSSI-CE), si informano gli utenti sui dati identificativi della titolare del sito web:
• Titolare: Diana Marcela Atehortua Ramirez
• Nome Commerciale: GAPSSA by Nana
• Indirizzo della sede: Carrer de Gayarre 24, Entresuelo 2, 08014 Barcellona (Spagna)
• Telefono: +34 680 373 663
• Email: gapssabynana@gmail.com
• Attività: Servizi integrali di estetica, cura del viso, del corpo e bellezza.

2. Oggetto e Ambito di Applicazione
Le presenti Note Legali regolano l'accesso, la navigazione e l'uso del sito web ufficiale di GAPSSA by Nana, nonché le responsabilità derivanti dall'utilizzo dei suoi contenuti (testi, grafica, fotografie, marchi e loghi). L'accesso a questo sito web attribuisce la qualifica di Utente e implica l'accettazione piena e senza riserve delle presenti disposizioni.

3. Condizioni d'Uso
L'utente si impegna a fare un uso lecito, diligente e in buona fede del sito web, astenendosi da qualsiasi atto che danneggi, disabiliti, sovraccarichi o impedisca il normale funzionamento del portale o i diritti e gli interessi di GAPSSA by Nana o di terzi.

4. Proprietà Intellettuale e Industriale
Tutti i contenuti del sito web, inclusi loghi, isotipo ufficiale, fotografie dei trattamenti, design grafico, codice e testi, sono di proprietà di GAPSSA by Nana o di terzi legittimamente autorizzati. È espressamente vietata la riproduzione, distribuzione o comunicazione pubblica senza previa autorizzazione scritta.

5. Responsabilità e Collegamenti
GAPSSA by Nana non è responsabile per eventuali danni derivanti da interferenze, interruzioni o virus informatici al di fuori del proprio ragionevole controllo, né per il contenuto dei link a siti web di terzi eventualmente presenti sul portale.

6. Legislazione Applicabile e Giurisdizione
Il rapporto tra l'utente e GAPSSA by Nana è regolato dalla vigente normativa spagnola. Per la risoluzione di qualsiasi controversia, le parti si sottopongono ai Tribunali della città di Barcellona, fatti salvi i fori inderogabili applicabili ai consumatori.`,
      },
      fr: {
        titulo: 'Mentions légales',
        contenido: `1. Données d'Identification de la Titulaire
Conformément à l'article 10 de la Loi espagnole 34/2002 du 11 juillet sur les Services de la Société de l'Information et du Commerce Électronique (LSSI-CE), les utilisateurs sont informés des coordonnées de la titulaire du site web :
• Titulaire : Diana Marcela Atehortua Ramirez
• Nom Commercial : GAPSSA by Nana
• Adresse de l'institut : Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelone (Espagne)
• Téléphone : +34 680 373 663
• Courriel : gapssabynana@gmail.com
• Activité : Soins complets d'esthétique, soins du visage, soins du corps et beauté.

2. Objet et Champ d'Application
Les présentes Mentions Légales régissent l'accès, la navigation et l'utilisation du site web officiel de GAPSSA by Nana, ainsi que les responsabilités découlant de l'utilisation de ses contenus (textes, graphismes, photographies, marques et logos). L'accès à ce site attribue la qualité d'Utilisateur et implique l'acceptation pleine et entière de ces dispositions.

3. Conditions d'Utilisation
L'utilisateur s'engage à faire un usage licite, diligent et de bonne foi du site web, en s'abstenant de tout acte susceptible d'endommager, de désactiver, de surcharger ou d'entraver le fonctionnement normal du portail ou les droits et intérêts de GAPSSA by Nana ou de tiers.

4. Propriété Intellectuelle et Industrielle
L'ensemble des contenus du site web, y compris les logos, l'isotype officiel, les photographies de soins, la conception graphique, le code et les textes, est la propriété de GAPSSA by Nana ou de tiers dûment autorisés. Toute reproduction, distribution ou communication publique sans autorisation écrite préalable est strictement interdite.

5. Responsabilité et Liens
GAPSSA by Nana ne saurait être tenue responsable des dommages résultant d'interférences, d'interruptions ou de virus informatiques échappant à son contrôle raisonnable, ni du contenu des liens vers des sites tiers présents sur le portail.

6. Législation Applicable et Juridiction
Les relations entre l'utilisateur et GAPSSA by Nana sont régies par la législation espagnole en vigueur. Pour le règlement de tout litige, les parties se soumettent aux Tribunaux de la ville de Barcelone, sans préjudice des dispositions légales impératives relatives aux consommateurs.`,
      },
      pt: {
        titulo: 'Aviso legal',
        contenido: `1. Dados Identificativos da Titular
Em cumprimento do artigo 10 da Lei 34/2002, de 11 de julho, de Serviços da Sociedade da Informação e do Comércio Eletrónico (LSSI-CE), informa-se os utilizadores sobre os dados identificativos da titular do site:
• Titular: Diana Marcela Atehortua Ramirez
• Nome Comercial: GAPSSA by Nana
• Morada do centro: Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona (Espanha)
• Telefone: +34 680 373 663
• Correio eletrónico: gapssabynana@gmail.com
• Atividade: Serviços integrais de estética, cuidados faciais, corporais e beleza.

2. Objeto e Âmbito de Aplicação
O presente Aviso Legal regula o acesso, navegação e utilização do site oficial da GAPSSA by Nana, bem como as responsabilidades decorrentes da utilização dos seus conteúdos (textos, gráficos, fotografias, marcas e logótipos). O acesso a este site atribui a condição de Utilizador e implica a aceitação plena e sem reservas destas disposições.

3. Condições de Utilização
O utilizador compromete-se a fazer uma utilização lícita, diligente e de boa-fé do site, abstendo-se de realizar qualquer ato que danifique, inutilize, sobrecarregue ou impeça o normal funcionamento do portal ou os direitos e interesses da GAPSSA by Nana ou de terceiros.

4. Propriedade Intelectual e Industrial
Todos os conteúdos do site, incluindo logótipos, isotipo oficial, fotografias de tratamentos, design gráfico, código e textos, são propriedade da GAPSSA by Nana ou de terceiros com autorização legítima de utilização. É expressamente proibida a sua reprodução, distribuição ou comunicação pública sem autorização prévia por escrito.

5. Responsabilidade e Ligações
A GAPSSA by Nana não se responsabiliza por eventuais danos decorrentes de interferências, interrupções ou vírus informáticos alheios ao seu controlo razoável, nem pelo conteúdo das ligações a sites de terceiros constantes no portal.

6. Legislação Aplicável e Jurisdição
A relação entre o utilizador e a GAPSSA by Nana reger-se-á pela legislação espanhola em vigor. Para a resolução de qualquer litígio, as partes submetem-se aos Tribunais da cidade de Barcelona, sem prejuízo das normas jurídicas imperativas aplicáveis aos consumidores.`,
      },
    },
  },
  {
    tipo: 'privacidad',
    porLocale: {
      es: {
        titulo: 'Política de privacidad',
        contenido: `1. Responsable del Tratamiento
• Responsable: Diana Marcela Atehortua Ramirez (GAPSSA by Nana)
• Dirección: Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona, España
• Teléfono: +34 680 373 663
• Correo electrónico de contacto: gapssabynana@gmail.com

2. Datos que Recopilamos y Finalidades
Tratamos los datos personales facilitados voluntariamente con las siguientes finalidades y bases legítimas:
• Gestión de citas y reservas: Tramitar tu solicitud, confirmar y recordar la sesión, y prestar el servicio estético contratado (Base legal: Art. 6.1.b RGPD - ejecución de contrato).
• Atención de dudas y consultas: Responder a solicitudes recibidas a través de formulario web, teléfono o WhatsApp (Base legal: Art. 6.1.a y 6.1.f RGPD - consentimiento e interés legítimo).
• Valoración de aptitud para tratamientos: Evaluación en cabina de la piel y de posibles contraindicaciones de salud para garantizar la máxima seguridad en tratamientos faciales o depilación láser (Base legal: Art. 9.2.a y 9.2.h RGPD - consentimiento explícito y secreto profesional).
• Obligaciones legales y contables: Emisión de facturas y cumplimiento tributario (Base legal: Art. 6.1.c RGPD).

3. Conservación de los Datos
Tus datos se conservarán durante la vigencia de la relación de servicios y, posteriormente, durante los plazos legalmente establecidos por la normativa tributaria y civil española (hasta 5 años para prescripción de acciones civiles y 4 años para obligaciones fiscales).

4. Destinatarios y Seguridad
No cedemos datos a terceros salvo obligación legal expresa. Únicamente acceden a los datos los proveedores estrictamente necesarios para el soporte informático y alojamiento web seguro dentro del Espacio Económico Europeo, bajo contratos de encargo de tratamiento (Art. 28 RGPD).

5. Derechos de Protección de Datos
Puedes ejercer en cualquier momento tus derechos de acceso, rectificación, supresión ("derecho al olvido"), limitación del tratamiento, portabilidad y oposición enviando un correo electrónico a gapssabynana@gmail.com o por correo postal a Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona, adjuntando copia de tu documento de identidad e indicando "Protección de Datos".
Asimismo, tienes derecho a presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD, www.aepd.es) si consideras que tus derechos han sido vulnerados.`,
      },
      ca: {
        titulo: 'Política de privacitat',
        contenido: `1. Responsable del Tractament
• Responsable: Diana Marcela Atehortua Ramirez (GAPSSA by Nana)
• Direcció: Carrer de Gayarre 24, Entresòl 2, 08014 Barcelona, Espanya
• Telèfon: +34 680 373 663
• Correu electrònic de contacte: gapssabynana@gmail.com

2. Dades que Recopilem i Finalitats
Tractem les dades personals facilitades voluntàriament amb les següents finalitats i bases legítimes:
• Gestió de cites i reserves: Tramitar la teva sol·licitud, confirmar i recordar la sessió, i prestar el servei estètic contractat (Base legal: Art. 6.1.b RGPD - execució de contracte).
• Atenció de dubtes i consultes: Respondre a sol·licituds rebudes a través de formulari web, telèfon o WhatsApp (Base legal: Art. 6.1.a i 6.1.f RGPD - consentiment i interès legítim).
• Valoració d'aptitud per a tractaments: Avaluació en cabina de la pell i de possibles contraindicacions de salut per garantir la màxima seguretat en tractaments facials o depilació làser (Base legal: Art. 9.2.a i 9.2.h RGPD - consentiment explícit i secret professional).
• Obligacions legals i comptables: Emissió de factures i compliment tributari (Base legal: Art. 6.1.c RGPD).

3. Conservació de les Dades
Les teves dades es conservaran durant la vigència de la relació de serveis i, posteriorment, durant els terminis legalment establerts per la normativa tributària i civil espanyola (fins a 5 anys per a prescripció d'accions civils i 4 anys per a obligacions fiscals).

4. Destinataris i Seguretat
No cedim dades a tercers excepte obligació legal expressa. Únicament accedeixen a les dades els proveïdors estrictament necessaris per al suport informàtic i allotjament web segur dins de l'Espai Econòmic Europeu, sota contractes d'encarregat de tractament (Art. 28 RGPD).

5. Drets de Protecció de Dades
Pots exercir en qualsevol moment els teus drets d'accés, rectificació, supressió ("dret a l'oblit"), limitació del tractament, portabilitat i oposició enviant un correu electrònic a gapssabynana@gmail.com o per correu postal a Carrer de Gayarre 24, Entresòl 2, 08014 Barcelona, adjuntant còpia del teu document d'identitat i indicant "Protecció de Dades".
Així mateix, tens dret a presentar una reclamació davant l'Agència Espanyola de Protecció de Dades (AEPD, www.aepd.es) si consideres que els teus drets han estat vulnerats.`,
      },
      en: {
        titulo: 'Privacy policy',
        contenido: `1. Data Controller
• Controller: Diana Marcela Atehortua Ramirez (GAPSSA by Nana)
• Address: Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona, Spain
• Telephone: +34 680 373 663
• Contact email: gapssabynana@gmail.com

2. Data We Collect and Purposes
We process personal data provided voluntarily for the following purposes and legal grounds:
• Appointment and booking management: Processing your request, confirming and reminding you of your session, and performing the agreed aesthetic service (Legal basis: Art. 6.1.b GDPR - contract performance).
• Inquiries and customer service: Answering inquiries received via web forms, phone, or WhatsApp (Legal basis: Art. 6.1.a and 6.1.f GDPR - consent and legitimate interest).
• Treatment suitability assessment: In-cabin evaluation of skin suitability and health contraindications to guarantee maximum safety in facial treatments or laser hair removal (Legal basis: Art. 9.2.a and 9.2.h GDPR - explicit consent and professional secrecy).
• Legal and accounting obligations: Billing and fiscal compliance (Legal basis: Art. 6.1.c GDPR).

3. Data Retention
Your personal data will be kept during the service relationship and subsequently for the statutory periods mandated by Spanish civil and tax laws (up to 5 years for general civil liability and 4 years for tax records).

4. Recipients and Security
We do not disclose data to third parties unless required by law. Data is only accessible to technological service providers essential for secure hosting within the European Economic Area under Data Processing Agreements (Art. 28 GDPR).

5. Your Data Protection Rights
You may exercise your rights of access, rectification, erasure ("right to be forgotten"), restriction of processing, data portability, and objection at any time by emailing gapssabynana@gmail.com or writing to Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona, attaching proof of identity and referencing "Data Protection".
You also have the right to lodge a complaint with the Spanish Data Protection Agency (AEPD, www.aepd.es) if you consider that your rights have been infringed.`,
      },
      it: {
        titulo: 'Informativa sulla privacy',
        contenido: `1. Titolare del Trattamento
• Titolare: Diana Marcela Atehortua Ramirez (GAPSSA by Nana)
• Indirizzo: Carrer de Gayarre 24, Entresuelo 2, 08014 Barcellona, Spagna
• Telefono: +34 680 373 663
• Email di contatto: gapssabynana@gmail.com

2. Dati Raccolti e Finalità
Trattiamo i dati personali forniti volontariamente per le seguenti finalità e basi giuridiche:
• Gestione di appuntamenti e prenotazioni: Elaborazione della richiesta, conferma e promemoria della sessione ed esecuzione del servizio estetico concordato (Base giuridica: Art. 6.1.b RGPD - esecuzione contrattuale).
• Risposta a domande e informazioni: Gestione delle richieste ricevute tramite modulo web, telefono o WhatsApp (Base giuridica: Art. 6.1.a e 6.1.f RGPD - consenso e legittimo interesse).
• Valutazione dell'idoneità ai trattamenti: Valutazione in cabina della pelle e di eventuali controindicazioni per garantire la massima sicurezza nei trattamenti viso o epilazione laser (Base giuridica: Art. 9.2.a e 9.2.h RGPD - consenso esplicito e segreto professionale).
• Obblighi legali e fiscali: Fatturazione e adempimenti fiscali (Base giuridica: Art. 6.1.c RGPD).

3. Conservazione dei Dati
I dati personali saranno conservati per tutta la durata del rapporto di servizio e successivamente per i termini di legge previsti dalla normativa civile e tributaria spagnola (fino a 5 anni per azioni civili e 4 anni per obblighi fiscali).

4. Destinatari e Sicurezza
I dati non saranno ceduti a terzi, salvo obblighi di legge. Hanno accesso solo i fornitori tecnologici strettamente necessari per l'hosting sicuro all'interno dello Spazio Economico Europeo con accordi di responsabile del trattamento (Art. 28 RGPD).

5. Diritti dell'Interessato
È possibile esercitare in qualsiasi momento i diritti di accesso, rettifica, cancellazione ("diritto all'oblio"), limitazione del trattamento, portabilità e opposizione inviando un'email a gapssabynana@gmail.com o per posta a Carrer de Gayarre 24, Entresuelo 2, 08014 Barcellona, allegando copia del documento d'identità e indicando "Protezione dei Dati".
È inoltre possibile presentare un reclamo all'Agenzia Spagnola per la Protezione dei Dati (AEPD, www.aepd.es).`,
      },
      fr: {
        titulo: 'Politique de confidentialité',
        contenido: `1. Responsable du Traitement
• Responsable : Diana Marcela Atehortua Ramirez (GAPSSA by Nana)
• Adresse : Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelone, Espagne
• Téléphone : +34 680 373 663
• Courriel de contact : gapssabynana@gmail.com

2. Données Collectées et Finalités
Nous traitons les données personnelles fournies volontairement pour les finalités suivantes :
• Gestion des rendez-vous et réservations : Traitement de la demande, confirmation et rappel de la séance, et exécution de la prestation esthétique (Base légale : Art. 6.1.b RGPD - exécution du contrat).
• Réponse aux demandes et questions : Traitement des messages reçus via formulaire web, téléphone ou WhatsApp (Base légale : Art. 6.1.a et 6.1.f RGPD - consentement et intérêt légitime).
• Évaluation de l'aptitude aux soins : Évaluation préalable en cabine de la peau et d'éventuelles contre-indications pour garantir la sécurité des soins du visage ou de l'épilation laser (Base légale : Art. 9.2.a et 9.2.h RGPD - consentement explicite et secret professionnel).
• Obligations légales et fiscales : Facturation et tenue comptable (Base légale : Art. 6.1.c RGPD).

3. Conservation des Données
Vos données sont conservées pendant toute la durée de la relation de service, puis pendant les durées légales prévues par la législation civile et fiscale espagnole (jusqu'à 5 ans pour les responsabilités civiles et 4 ans pour les obligations fiscales).

4. Destinataires et Sécurité
Aucune donnée n'est cédée à des tiers, sauf obligation légale. Seuls nos prestataires techniques nécessaires à l'hébergement sécurisé dans l'Espace Économique Européen y ont accès sous contrat de sous-traitance (Art. 28 RGPD).

5. Droits des Personnes Concernées
Vous pouvez exercer à tout moment vos droits d'accès, de rectification, d'effacement (« droit à l'oubli »), de limitation, de portabilité et d'opposition en écrivant à gapssabynana@gmail.com ou à Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelone, avec une copie de votre pièce d'identité et la mention « Protection des Données ».
Vous disposez également du droit d'introduire une réclamation auprès de l'Agence Espagnole de Protection des Données (AEPD, www.aepd.es).`,
      },
      pt: {
        titulo: 'Política de privacidade',
        contenido: `1. Responsável pelo Tratamento
• Responsável: Diana Marcela Atehortua Ramirez (GAPSSA by Nana)
• Morada: Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona, Espanha
• Telefone: +34 680 373 663
• Correio eletrónico de contacto: gapssabynana@gmail.com

2. Dados que Recolhemos e Finalidades
Tratamos os dados pessoais fornecidos voluntariamente para as seguintes finalidades e bases legítimas:
• Gestão de marcações e reservas: Tramitação do pedido, confirmação e lembrete da sessão, e prestação do serviço estético acordado (Base legal: Art. 6.1.b RGPD - execução de contrato).
• Atendimento de dúvidas e pedidos de informação: Resposta a pedidos recebidos via formulário web, telefone ou WhatsApp (Base legal: Art. 6.1.a e 6.1.f RGPD - consentimento e interesse legítimo).
• Avaliação de aptidão para tratamentos: Avaliação em cabine da pele e de eventuais contraindicações de saúde para garantir total segurança em tratamentos faciais ou depilação a laser (Base legal: Art. 9.2.a e 9.2.h RGPD - consentimento explícito e sigilo profissional).
• Obrigações legais e contabilísticas: Emissão de faturas e cumprimento fiscal (Base legal: Art. 6.1.c RGPD).

3. Conservação dos Dados
Os dados pessoais serão conservados durante a relação de serviço e, posteriormente, pelos prazos legalmente fixados pela legislação tributária e civil espanhola (até 5 anos para responsabilidades civis e 4 anos para obrigações fiscais).

4. Destinatários e Segurança
Não partilhamos dados com terceiros, exceto por obrigação legal. Apenas têm acesso os prestadores de serviços técnicos essenciais ao alojamento seguro no Espaço Económico Europeu sob contratos de subcontratante (Art. 28 RGPD).

5. Direitos dos Titulares dos Dados
Pode exercer a qualquer momento os seus direitos de acesso, retificação, apagamento ("direito ao esquecimento"), limitação, portabilidade e oposição através do e-mail gapssabynana@gmail.com ou por correio postal para Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona, com cópia do documento de identificação e a referência "Proteção de Dados".
Pode ainda apresentar reclamação junto da Agência Espanhola de Proteção de Dados (AEPD, www.aepd.es).`,
      },
    },
  },
  {
    tipo: 'cookies',
    porLocale: {
      es: {
        titulo: 'Política de cookies',
        contenido: `1. ¿Qué son las cookies?
Una cookie es un pequeño archivo de texto que los sitios web descargan en tu navegador al acceder a determinadas páginas. Permite almacenar y recuperar información técnica sobre tu visita para garantizar el correcto funcionamiento del portal y recordar tus preferencias.

2. Cookies que utilizamos en este sitio web
• Cookies técnicas estrictamente necesarias: Imprescindibles para la navegación y la seguridad del portal (por ejemplo, recordar el idioma seleccionado o registrar tu preferencia sobre cookies). Conforme al artículo 22.2 de la LSSI-CE, estas cookies no requieren tu consentimiento previo.
• Cookies analíticas o de medición: Diseñadas para evaluar de forma agregada y anónima el uso del sitio web. Este portal no ejecuta herramientas analíticas de seguimiento hasta que pulses el botón "Aceptar todas" en nuestro banner de cookies.

3. Gestión y Configuración del Consentimiento
En tu primera visita dispones de un panel inferior que te permite:
• Aceptar todas: Activa las funciones técnicas y analíticas agregadas.
• Solo necesarias: Mantiene activas exclusivamente las cookies técnicas imprescindibles.
Puedes modificar tu decisión en cualquier momento borrando el historial y almacenamiento local de tu navegador.

4. Cómo deshabilitar las cookies en tu navegador
Puedes permitir, bloquear o eliminar las cookies instaladas en tu equipo mediante la configuración de las opciones de tu navegador web:
• Google Chrome: Configuración > Privacidad y seguridad > Cookies.
• Mozilla Firefox: Opciones > Privacidad y seguridad > Cookies.
• Apple Safari: Preferencias > Privacidad > Gestionar datos de sitios web.
• Microsoft Edge: Configuración > Privacidad, búsqueda y servicios > Cookies.`,
      },
      ca: {
        titulo: 'Política de galetes',
        contenido: `1. Què són les galetes (cookies)?
Una galeta és un petit fitxer de text que els llocs web descarreguen al teu navegador en accedir a determinades pàgines. Permet emmagatzemar i recuperar informació tècnica sobre la teva visita per garantir el funcionament correcte del portal i recordar les teves preferències.

2. Galetes que utilitzem en aquest lloc web
• Galetes tècniques estrictament necessàries: Imprescindibles per a la navegació i la seguretat del portal (per exemple, recordar l'idioma seleccionat o registrar la teva preferència sobre galetes). Conforme a l'article 22.2 de la LSSI-CE, aquestes galetes no requereixen el teu consentiment previ.
• Galetes analítiques o de mesurament: Dissenyades per avaluar de manera agregada i anònima l'ús del lloc web. Aquest portal no executa eines analítiques de seguiment fins que premis el botó "Acceptar totes" al nostre bàner de galetes.

3. Gestió i Configuració del Consentiment
En la teva primera visita disposes d'un panell inferior que et permet:
• Acceptar totes: Activa les funcions tècniques i analítiques agregades.
• Només necessàries: Manté actives exclusivament les galetes tècniques imprescindibles.
Pots modificar la teva decisió en qualsevol moment esborrant l'historial i l'emmagatzematge local del teu navegador.

4. Com deshabilitar les galetes al teu navegador
Pots permetre, bloquejar o eliminar les galetes instal·lades al teu equip mitjançant la configuració de les opcions del teu navegador web:
• Google Chrome: Configuració > Privacitat i seguretat > Galetes.
• Mozilla Firefox: Opcions > Privacitat i seguretat > Galetes.
• Apple Safari: Preferències > Privacitat > Gestionar dades de llocs web.
• Microsoft Edge: Configuració > Privacitat, cerca i serveis > Galetes.`,
      },
      en: {
        titulo: 'Cookie policy',
        contenido: `1. What are cookies?
A cookie is a small text file that websites download to your browser when accessing certain web pages. It stores and retrieves technical information about your visit to ensure proper website operation and remember your preferences.

2. Cookies Used on This Website
• Strictly necessary technical cookies: Essential for website navigation and security (e.g., remembering your chosen language or saving your cookie consent preference). Under Article 22.2 of Spanish LSSI-CE, these cookies do not require prior consent.
• Analytical or measurement cookies: Designed to assess website usage in an aggregate and anonymous manner. This portal does not activate tracking analytics until you click "Accept all" in our cookie banner.

3. Managing Your Consent
On your first visit, a bottom banner allows you to:
• Accept all: Enables technical and aggregate analytical functionality.
• Necessary only: Keeps only essential technical cookies active.
You can change your decision at any time by clearing your browser's local storage and browsing data.

4. How to Disable Cookies in Your Browser
You can allow, block, or delete cookies installed on your device through your browser settings:
• Google Chrome: Settings > Privacy and security > Cookies.
• Mozilla Firefox: Options > Privacy & Security > Cookies.
• Apple Safari: Preferences > Privacy > Manage Website Data.
• Microsoft Edge: Settings > Privacy, search, and services > Cookies.`,
      },
      it: {
        titulo: 'Informativa sui cookie',
        contenido: `1. Cosa sono i cookie?
Un cookie è un piccolo file di testo che i siti web scaricano nel browser durante la navigazione. Consente di memorizzare e recuperare informazioni tecniche sulla visita per garantire il corretto funzionamento del sito e ricordare le preferenze.

2. Cookie utilizzati in questo sito web
• Cookie tecnici strettamente necessari: Indispensabili per la navigazione e la sicurezza del portale (ad esempio, ricordare la lingua selezionata o registrare la preferenza sui cookie). Ai sensi dell'articolo 22.2 della LSSI-CE, questi cookie non richiedono il consenso preventivo.
• Cookie analitici o di misurazione: Progettati per valutare in forma aggregata e anonima l'utilizzo del sito web. Questo portale non attiva strumenti di analisi fino a quando non si seleziona "Accetta tutti" nel banner dei cookie.

3. Gestione del Consenso
Durante la prima visita, un banner inferiore consente di:
• Accetta tutti: Attiva le funzioni tecniche e analitiche aggregate.
• Solo necessari: Mantiene attivi solo i cookie tecnici indispensabili.
È possibile modificare la scelta in qualsiasi momento cancellando la cronologia e l'archiviazione locale del browser.

4. Come disabilitare i cookie nel browser
È possibile autorizzare, bloccare o cancellare i cookie installati sul dispositivo tramite le impostazioni del browser:
• Google Chrome: Impostazioni > Privacy e sicurezza > Cookie.
• Mozilla Firefox: Opzioni > Privacy e sicurezza > Cookie.
• Apple Safari: Preferenze > Privacy > Gestisci dati siti web.
• Microsoft Edge: Impostazioni > Privacy, ricerca e servizi > Cookie.`,
      },
      fr: {
        titulo: 'Politique de cookies',
        contenido: `1. Que sont les cookies ?
Un cookie est un petit fichier texte que les sites web déposent dans votre navigateur lors de votre visite. Il permet de stocker et de récupérer des informations techniques afin de garantir le bon fonctionnement du site et de mémoriser vos préférences.

2. Cookies utilisés sur ce site web
• Cookies techniques strictement nécessaires : Indispensables à la navigation et à la sécurité du portale (par exemple, mémoriser la langue sélectionnée ou enregistrer votre choix relatif aux cookies). Conformément à l'article 22.2 de la LSSI-CE, ces cookies ne nécessitent pas de consentement préalable.
• Cookies analytiques ou de mesure : Destinés à évaluer de manière agrégée et anonyme la fréquentation du site. Ce portail n'active aucun outil de mesure tant que vous n'avez pas cliqué sur « Tout accepter » dans notre bandeau de cookies.

3. Gestion du Consentement
Lors de votre première visite, un bandeau en bas de page vous permet de :
• Tout accepter : Active les fonctionnalités techniques et d'analyse agrégée.
• Uniquement nécessaires : Conserve uniquement les cookies techniques indispensables.
Vous pouvez modifier votre choix à tout moment en effaçant l'historique et les données de votre navigateur.

4. Comment désactiver les cookies dans votre navigateur
Vous pouvez autoriser, bloquer ou supprimer les cookies installés sur votre équipement via les paramètres de votre navigateur :
• Google Chrome : Paramètres > Confidentialité et sécurité > Cookies.
• Mozilla Firefox : Options > Vie privée et sécurité > Cookies.
• Apple Safari : Préférences > Confidentialité > Gérer les données de sites web.
• Microsoft Edge : Paramètres > Confidentialité, recherche et services > Cookies.`,
      },
      pt: {
        titulo: 'Política de cookies',
        contenido: `1. O que são cookies?
Um cookie é um pequeno ficheiro de texto que os sites descarregam no seu navegador ao aceder a determinadas páginas. Permite armazenar e recuperar informações técnicas sobre a visita para garantir o correto funcionamento do portal e recordar preferências.

2. Cookies utilizados neste site
• Cookies técnicos estritamente necessários: Indispensáveis para a navegação e segurança do portal (por exemplo, recordar o idioma selecionado ou registar a preferência sobre cookies). Nos termos do artigo 22.2 da LSSI-CE, estes cookies não requerem consentimento prévio.
• Cookies analíticos ou de medição: Concebidos para avaliar de forma agregada e anónima a utilização do site. Este portal não ativa ferramentas analíticas até que selecione "Aceitar todos" no nosso banner de cookies.

3. Gestão e Configuração do Consentimento
Na primeira visita, dispõe de um banner inferior que lhe permite:
• Aceitar todos: Ativa as funções técnicas e analíticas agregadas.
• Apenas necessários: Mantém ativos exclusivamente os cookies técnicos imprescindibles.
Pode alterar a sua decisão a qualquer momento limpando o histórico e armazenamento local do seu navegador.

4. Como desativar cookies no seu navegador
Pode permitir, bloquear ou eliminar os cookies instalados no seu equipamento através das opções de configuração do seu navegador:
• Google Chrome: Definições > Privacidade e segurança > Cookies.
• Mozilla Firefox: Opções > Privacidade e segurança > Cookies.
• Apple Safari: Preferências > Privacidade > Gerir dados de sites.
• Microsoft Edge: Definições > Privacidade, pesquisa e serviços > Cookies.`,
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
Per motivi di salute, sicurezza e igiene, ci riserviamo il diritto di non eseguire il trattamento nei seguenti casi:
• Epilazione: Presenza di lesioni, ferite aperte, pelle irritata o recente esposizione solare.
• Trattamenti Viso: Ipersensibilità cutanea, dermatite attiva o condizioni che contrastino con l'applicazione sicura dei nostri protocolli.
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
