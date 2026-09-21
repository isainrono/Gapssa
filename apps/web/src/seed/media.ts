import fs from 'node:fs'
import path from 'node:path'

import type { BasePayload } from 'payload'

import { LOCALES, type Locale } from '@/lib/i18n/locales'

import { shouldCreateDocument } from './idempotent'
import { computeMissingAltUpdates, type RawLocalizedText } from './localeCompletion'

export type MediaFileSeed = {
  key: string
  relativePath: string
  /**
   * `Record<Locale, string>` obligatorio, no `Partial<...>`: revisión 2 de
   * Fase 2 detectó 10 de las 12 imágenes con `alt` solo en es/en — un
   * activo usado en una página multilingüe necesita `alt` en los 6 idiomas
   * (`PLAN_DESARROLLO_WEB_PORTAL.md` §5.1, WCAG 2.2 AA). El tipo obligatorio
   * evita que vuelva a faltar un idioma sin que TypeScript avise.
   */
  altPorLocale: Record<Locale, string>
}

export const PUBLIC_IMAGES_DIR = path.resolve(process.cwd(), 'public/images')

export const MEDIA_FILES: MediaFileSeed[] = [
  {
    key: 'logo',
    relativePath: 'marca/logo.webp',
    altPorLocale: {
      es: 'Logotipo de GAPSSA by Nana',
      ca: 'Logotip de GAPSSA by Nana',
      en: 'GAPSSA by Nana logo',
      it: 'Logo di GAPSSA by Nana',
      fr: 'Logo de GAPSSA by Nana',
      pt: 'Logótipo da GAPSSA by Nana',
    },
  },
  {
    key: 'diana',
    relativePath: 'equipo/diana.jpg',
    altPorLocale: {
      es: 'Diana, fundadora y especialista en belleza de GAPSSA by Nana',
      ca: 'Diana, fundadora i especialista en bellesa de GAPSSA by Nana',
      en: 'Diana, founder and beauty specialist at GAPSSA by Nana',
      it: 'Diana, fondatrice e specialista di bellezza di GAPSSA by Nana',
      fr: 'Diana, fondatrice et spécialiste de la beauté de GAPSSA by Nana',
      pt: 'Diana, fundadora e especialista em beleza da GAPSSA by Nana',
    },
  },
  {
    key: 'hero-centro',
    relativePath: 'stock/hero-centro.jpg',
    altPorLocale: {
      es: 'Interior del centro GAPSSA by Nana',
      ca: 'Interior del centre GAPSSA by Nana',
      en: 'Interior of the GAPSSA by Nana centre',
      it: 'Interno del centro GAPSSA by Nana',
      fr: 'Intérieur du centre GAPSSA by Nana',
      pt: 'Interior do centro GAPSSA by Nana',
    },
  },
  {
    key: 'tratamiento-facial',
    relativePath: 'stock/tratamiento-facial.jpg',
    altPorLocale: {
      es: 'Tratamiento facial',
      ca: 'Tractament facial',
      en: 'Facial treatment',
      it: 'Trattamento viso',
      fr: 'Soin du visage',
      pt: 'Tratamento facial',
    },
  },
  {
    key: 'manicura',
    relativePath: 'stock/manicura.jpg',
    altPorLocale: { es: 'Manicura', ca: 'Manicura', en: 'Manicure', it: 'Manicure', fr: 'Manucure', pt: 'Manicure' },
  },
  {
    key: 'masaje',
    relativePath: 'stock/masaje.jpg',
    altPorLocale: { es: 'Masaje', ca: 'Massatge', en: 'Massage', it: 'Massaggio', fr: 'Massage', pt: 'Massagem' },
  },
  {
    key: 'depilacion-facial',
    relativePath: 'stock/depilacion-facial.jpg',
    altPorLocale: {
      es: 'Depilación facial',
      ca: 'Depilació facial',
      en: 'Facial hair removal',
      it: 'Depilazione del viso',
      fr: 'Épilation du visage',
      pt: 'Depilação facial',
    },
  },
  {
    key: 'radiofrecuencia-facial',
    relativePath: 'stock/radiofrecuencia-facial.jpg',
    altPorLocale: {
      es: 'Radiofrecuencia facial',
      ca: 'Radiofreqüència facial',
      en: 'Facial radiofrequency',
      it: 'Radiofrequenza facciale',
      fr: 'Radiofréquence visage',
      pt: 'Radiofrequência facial',
    },
  },
  {
    key: 'hidratacion-facial',
    relativePath: 'stock/hidratacion-facial.jpg',
    altPorLocale: {
      es: 'Hidratación facial',
      ca: 'Hidratació facial',
      en: 'Facial hydration',
      it: 'Idratazione del viso',
      fr: 'Hydratation du visage',
      pt: 'Hidratação facial',
    },
  },
  {
    key: 'tratamiento-reafirmante',
    relativePath: 'stock/tratamiento-reafirmante.jpg',
    altPorLocale: {
      es: 'Tratamiento corporal reafirmante',
      ca: 'Tractament corporal reafirmant',
      en: 'Firming body treatment',
      it: 'Trattamento corpo rassodante',
      fr: 'Soin corporel raffermissant',
      pt: 'Tratamento corporal reafirmante',
    },
  },
  {
    key: 'pedicura',
    relativePath: 'stock/pedicura.jpg',
    altPorLocale: { es: 'Pedicura', ca: 'Pedicura', en: 'Pedicure', it: 'Pedicure', fr: 'Pédicure', pt: 'Pedicure' },
  },
  {
    key: 'microdermoabrasion',
    relativePath: 'stock/microdermoabrasion.jpg',
    altPorLocale: {
      es: 'Tratamiento facial de cuidado avanzado',
      ca: 'Tractament facial de cura avançada',
      en: 'Advanced facial care treatment',
      it: 'Trattamento viso di cura avanzata',
      fr: 'Soin du visage de haute technicité',
      pt: 'Tratamento facial de cuidado avançado',
    },
  },
  {
    key: 'unas-manicura-express',
    relativePath: 'unas/manicura-express.jpeg',
    altPorLocale: { es: 'Manicura express', ca: 'Manicura express', en: 'Express manicure', it: 'Manicure express', fr: 'Manucure express', pt: 'Manicure express' },
  },
  {
    key: 'unas-manicura-semipermanente',
    relativePath: 'unas/manicura-semipermanente.jpeg',
    altPorLocale: { es: 'Manicura semipermanente', ca: 'Manicura semipermanent', en: 'Gel manicure', it: 'Manicure semipermanente', fr: 'Manucure semi-permanente', pt: 'Manicure semipermanente' },
  },
  {
    key: 'unas-manicura-tradicional',
    relativePath: 'unas/manicura-tradicional.jpeg',
    altPorLocale: { es: 'Manicura tradicional', ca: 'Manicura tradicional', en: 'Traditional manicure', it: 'Manicure tradizionale', fr: 'Manucure traditionnelle', pt: 'Manicure tradicional' },
  },
  {
    key: 'unas-parafina-manos',
    relativePath: 'unas/parafina-manos.jpeg',
    altPorLocale: { es: 'Tratamiento de parafina de manos', ca: 'Tractament de parafina de mans', en: 'Hand paraffin treatment', it: 'Trattamento alla paraffina per le mani', fr: 'Soin à la paraffine pour les mains', pt: 'Tratamento de parafina para as mãos' },
  },
  {
    key: 'unas-pedicura-express',
    relativePath: 'unas/pedicura-express.jpeg',
    altPorLocale: { es: 'Pedicura express', ca: 'Pedicura express', en: 'Express pedicure', it: 'Pedicure express', fr: 'Pédicure express', pt: 'Pedicure express' },
  },
  {
    key: 'unas-pedicura-semipermanente',
    relativePath: 'unas/pedicura-semipermanente.jpeg',
    altPorLocale: { es: 'Pedicura semipermanente', ca: 'Pedicura semipermanent', en: 'Gel pedicure', it: 'Pedicure semipermanente', fr: 'Pédicure semi-permanente', pt: 'Pedicure semipermanente' },
  },
  {
    key: 'unas-pedicura-tradicional',
    relativePath: 'unas/pedicura-tradicional.jpeg',
    altPorLocale: { es: 'Pedicura tradicional', ca: 'Pedicura tradicional', en: 'Traditional pedicure', it: 'Pedicure tradizionale', fr: 'Pédicure traditionnelle', pt: 'Pedicure tradicional' },
  },

  // Faciales (fotos oficiales)
  {
    key: 'faciales-limpieza-basica',
    relativePath: 'faciales/limpieza-facial-basica.jpeg',
    altPorLocale: { es: 'Limpieza facial básica', ca: 'Neteja facial bàsica', en: 'Basic facial cleansing', it: 'Pulizia del viso base', fr: 'Nettoyage du visage de base', pt: 'Limpeza facial básica' },
  },
  {
    key: 'faciales-limpieza-profunda',
    relativePath: 'faciales/limpieza-facial-profunda.jpeg',
    altPorLocale: { es: 'Limpieza facial profunda', ca: 'Neteja facial profunda', en: 'Deep facial cleansing', it: 'Pulizia del viso profonda', fr: 'Nettoyage du visage en profondeur', pt: 'Limpeza facial profunda' },
  },
  {
    key: 'faciales-mesoterapia-estetica',
    relativePath: 'faciales/mesoterapia-estetica.jpeg',
    altPorLocale: { es: 'Mesoterapia facial', ca: 'Mesoteràpia facial', en: 'Facial mesotherapy', it: 'Mesoterapia facciale', fr: 'Mésothérapie du visage', pt: 'Mesoterapia facial' },
  },
  {
    key: 'faciales-microneedling',
    relativePath: 'faciales/microneedling.jpeg',
    altPorLocale: { es: 'Microneedling facial', ca: 'Microneedling facial', en: 'Facial microneedling', it: 'Microneedling facciale', fr: 'Microneedling du visage', pt: 'Microneedling facial' },
  },
  {
    key: 'faciales-dermapen',
    relativePath: 'faciales/dermapen.jpeg',
    altPorLocale: { es: 'Tratamiento Dermapen', ca: 'Tractament Dermapen', en: 'Dermapen treatment', it: 'Trattamento Dermapen', fr: 'Soin Dermapen', pt: 'Tratamento Dermapen' },
  },
  {
    key: 'faciales-radiofrecuencia-facial',
    relativePath: 'faciales/radiofrecuencia-facial.jpeg',
    altPorLocale: { es: 'Radiofrecuencia facial', ca: 'Radiofreqüència facial', en: 'Facial radiofrequency', it: 'Radiofrequenza facciale', fr: 'Radiofréquence visage', pt: 'Radiofrequência facial' },
  },
  {
    key: 'faciales-peeling-prx',
    relativePath: 'faciales/peeling-prx.jpeg',
    altPorLocale: { es: 'Peeling PRX-T33', ca: 'Peeling PRX-T33', en: 'PRX-T33 peeling', it: 'Peeling PRX-T33', fr: 'Peeling PRX-T33', pt: 'Peeling PRX-T33' },
  },
  {
    key: 'faciales-skinpen',
    relativePath: 'faciales/skinpen.jpeg',
    altPorLocale: { es: 'Rejuvenecimiento facial Skin Pen', ca: 'Rejoveniment facial Skin Pen', en: 'Skin Pen facial rejuvenation', it: 'Ringiovanimento del viso Skin Pen', fr: 'Rajeunissement du visage Skin Pen', pt: 'Rejuvenescimento facial Skin Pen' },
  },
  {
    key: 'faciales-laser-carbono',
    relativePath: 'faciales/laser-carbono.jpeg',
    altPorLocale: { es: 'Láser de carbono activo', ca: 'Làser de carboni actiu', en: 'Active carbon laser', it: 'Laser al carbonio attivo', fr: 'Laser au carbone actif', pt: 'Laser de carbono ativo' },
  },

  // Pestañas y cejas (fotos oficiales)
  {
    key: 'pestanas-cejas-lifting-pestanas',
    relativePath: 'pestanas-cejas/lifting-pestanas.jpeg',
    altPorLocale: { es: 'Lifting de pestañas', ca: 'Lifting de pestanyes', en: 'Lash lift', it: 'Lifting delle ciglia', fr: 'Rehaussement de cils', pt: 'Lifting de pestanas' },
  },
  {
    key: 'pestanas-cejas-lifting-pestanas-tinte',
    relativePath: 'pestanas-cejas/lifting-pestanas-tinte.jpeg',
    altPorLocale: { es: 'Lifting de pestañas + tinte', ca: 'Lifting de pestanyes + tint', en: 'Lash lift + tint', it: 'Lifting ciglia + tinta', fr: 'Rehaussement de cils + teinture', pt: 'Lifting de pestanas + tinta' },
  },
  {
    key: 'pestanas-cejas-tinte-pestanas-cejas',
    relativePath: 'pestanas-cejas/tinte-pestanas-cejas.jpeg',
    altPorLocale: { es: 'Tinte de pestañas y cejas', ca: 'Tint de pestanyes i celles', en: 'Lash and brow tint', it: 'Tinta ciglia e sopracciglia', fr: 'Teinture cils et sourcils', pt: 'Tinta de pestanas e sobrancelhas' },
  },
  {
    key: 'pestanas-cejas-laminado-cejas',
    relativePath: 'pestanas-cejas/laminado-cejas.jpeg',
    altPorLocale: { es: 'Laminado de cejas', ca: 'Laminat de celles', en: 'Brow lamination', it: 'Laminazione sopracciglia', fr: 'Lamination des sourcils', pt: 'Laminação de sobrancelhas' },
  },

  // Depilación (fotos oficiales)
  {
    key: 'depilacion-diseno-cejas',
    relativePath: 'depilacion/depilacion-diseno-cejas.jpeg',
    altPorLocale: { es: 'Diseño de cejas', ca: 'Disseny de celles', en: 'Eyebrow shaping', it: 'Disegno delle sopracciglia', fr: 'Dessin des sourcils', pt: 'Design de sobrancelhas' },
  },
  {
    key: 'depilacion-cejas',
    relativePath: 'depilacion/depilacion-cejas.jpeg',
    altPorLocale: { es: 'Depilación de cejas', ca: 'Depilació de celles', en: 'Eyebrow hair removal', it: 'Depilazione sopracciglia', fr: 'Épilation des sourcils', pt: 'Depilação de sobrancelhas' },
  },
  {
    key: 'depilacion-labio-superior',
    relativePath: 'depilacion/depilacion-labio-superior.jpeg',
    altPorLocale: { es: 'Depilación de labio superior', ca: 'Depilació de llavi superior', en: 'Upper lip hair removal', it: 'Depilazione labbro superiore', fr: 'Épilation de la lèvre supérieure', pt: 'Depilação do lábio superior' },
  },
  {
    key: 'depilacion-menton',
    relativePath: 'depilacion/depilacion-menton.jpeg',
    altPorLocale: { es: 'Depilación de mentón', ca: 'Depilació de barbeta', en: 'Chin hair removal', it: 'Depilazione mento', fr: 'Épilation du menton', pt: 'Depilação do queixo' },
  },
  {
    key: 'depilacion-patillas',
    relativePath: 'depilacion/depilacion-patillas.jpeg',
    altPorLocale: { es: 'Depilación de patillas', ca: 'Depilació de patilles', en: 'Sideburns hair removal', it: 'Depilazione basette', fr: 'Épilation des favoris', pt: 'Depilação das patilhas' },
  },
  {
    key: 'depilacion-facial-completa',
    relativePath: 'depilacion/depilacion-facial-completa.jpeg',
    altPorLocale: { es: 'Depilación facial completa', ca: 'Depilació facial completa', en: 'Full face hair removal', it: 'Depilazione viso completa', fr: 'Épilation complète du visage', pt: 'Depilação facial completa' },
  },
  {
    key: 'depilacion-axilas',
    relativePath: 'depilacion/depilacion-axilas.jpeg',
    altPorLocale: { es: 'Depilación de axilas', ca: 'Depilació d’aixelles', en: 'Underarm hair removal', it: 'Depilazione ascelle', fr: 'Épilation des aisselles', pt: 'Depilação das axilas' },
  },
  {
    key: 'depilacion-espalda',
    relativePath: 'depilacion/depilacion-espalda.jpeg',
    altPorLocale: { es: 'Depilación de espalda', ca: 'Depilació d’esquena', en: 'Back hair removal', it: 'Depilazione schiena', fr: 'Épilation du dos', pt: 'Depilação das costas' },
  },
  {
    key: 'depilacion-brazos',
    relativePath: 'depilacion/depilacion-brazos.jpeg',
    altPorLocale: { es: 'Depilación de brazos', ca: 'Depilació de braços', en: 'Arm hair removal', it: 'Depilazione braccia', fr: 'Épilation des bras', pt: 'Depilação dos braços' },
  },
  {
    key: 'depilacion-medio-brazo',
    relativePath: 'depilacion/depilacion-medio-brazo.jpeg',
    altPorLocale: { es: 'Depilación de medio brazo', ca: 'Depilació de mig braç', en: 'Half arm hair removal', it: 'Depilazione mezza braccia', fr: 'Épilation demi-bras', pt: 'Depilação de meio braço' },
  },
  {
    key: 'depilacion-pecho',
    relativePath: 'depilacion/depilacion-pecho.jpeg',
    altPorLocale: { es: 'Depilación de pecho', ca: 'Depilació de pit', en: 'Chest hair removal', it: 'Depilazione petto', fr: 'Épilation du torse', pt: 'Depilação do peito' },
  },
  {
    key: 'depilacion-abdomen',
    relativePath: 'depilacion/depilacion-abdomen.jpeg',
    altPorLocale: { es: 'Depilación de abdomen', ca: 'Depilació d’abdomen', en: 'Abdomen hair removal', it: 'Depilazione addome', fr: 'Épilation de l’abdomen', pt: 'Depilação do abdómen' },
  },
  {
    key: 'depilacion-gluteos',
    relativePath: 'depilacion/depilacion-gluteos.jpeg',
    altPorLocale: { es: 'Depilación de glúteos', ca: 'Depilació de glutis', en: 'Buttocks hair removal', it: 'Depilazione glutei', fr: 'Épilation des fesses', pt: 'Depilação dos glúteos' },
  },
  {
    key: 'depilacion-perianal',
    relativePath: 'depilacion/depilacion-perianal.jpeg',
    altPorLocale: { es: 'Depilación perianal', ca: 'Depilació perianal', en: 'Perianal hair removal', it: 'Depilazione perianale', fr: 'Épilation périanale', pt: 'Depilação perianal' },
  },
  {
    key: 'depilacion-ingles-brasilenas',
    relativePath: 'depilacion/depilacion-ingles-brasilenas.jpeg',
    altPorLocale: { es: 'Depilación de ingles brasileñas', ca: 'Depilació d’engonal brasiler', en: 'Brazilian bikini hair removal', it: 'Depilazione inguine brasiliana', fr: 'Épilation maillot brésilien', pt: 'Depilação de virilha brasileira' },
  },
  {
    key: 'depilacion-ingles-normales',
    relativePath: 'depilacion/depilacion-ingles-normales.jpeg',
    altPorLocale: { es: 'Depilación de ingles normales', ca: 'Depilació d’engonal normal', en: 'Standard bikini hair removal', it: 'Depilazione inguine normale', fr: 'Épilation maillot classique', pt: 'Depilação de virilha normal' },
  },
  {
    key: 'depilacion-ingles-integrales',
    relativePath: 'depilacion/depilacion-ingles-integrales.jpeg',
    altPorLocale: { es: 'Depilación de ingles integrales', ca: 'Depilació d’engonal integral', en: 'Hollywood bikini hair removal', it: 'Depilazione inguine integrale', fr: 'Épilation maillot intégral', pt: 'Depilação de virilha integral' },
  },
  {
    key: 'depilacion-piernas',
    relativePath: 'depilacion/depilacion-piernas.jpeg',
    altPorLocale: { es: 'Depilación de piernas completas', ca: 'Depilació de cames completes', en: 'Full leg hair removal', it: 'Depilazione gambe intere', fr: 'Épilation jambes complètes', pt: 'Depilação de pernas completas' },
  },
  {
    key: 'depilacion-medias-piernas',
    relativePath: 'depilacion/depilacion-medias-piernas.jpeg',
    altPorLocale: { es: 'Depilación de medias piernas', ca: 'Depilació de mitges cames', en: 'Half leg hair removal', it: 'Depilazione mezza gamba', fr: 'Épilation demi-jambes', pt: 'Depilação de meias pernas' },
  },

  // Depilación Láser (fotos oficiales)
  {
    key: 'depilacion-laser-laser-patillas',
    relativePath: 'depilacion-laser/laser-patillas.jpeg',
    altPorLocale: { es: 'Depilación láser en patillas', ca: 'Depilació làser a les patilles', en: 'Laser sideburns hair removal', it: 'Depilazione laser basette', fr: 'Épilation laser des favoris', pt: 'Depilação laser nas patilhas' },
  },
  {
    key: 'depilacion-laser-laser-menton',
    relativePath: 'depilacion-laser/laser-menton.jpeg',
    altPorLocale: { es: 'Depilación láser en mentón', ca: 'Depilació làser a la barbeta', en: 'Laser chin hair removal', it: 'Depilazione laser mento', fr: 'Épilation laser du menton', pt: 'Depilação laser no queixo' },
  },
  {
    key: 'depilacion-laser-laser-axilas',
    relativePath: 'depilacion-laser/laser-axilas.jpeg',
    altPorLocale: { es: 'Depilación láser en axilas', ca: 'Depilació làser a les aixelles', en: 'Laser underarms hair removal', it: 'Depilazione laser ascelle', fr: 'Épilation laser des aisselles', pt: 'Depilação laser nas axilas' },
  },
  {
    key: 'depilacion-laser-laser-espalda',
    relativePath: 'depilacion-laser/laser-espalda.jpeg',
    altPorLocale: { es: 'Depilación láser en espalda completa', ca: 'Depilació làser a l’esquena completa', en: 'Laser full back hair removal', it: 'Depilazione laser schiena completa', fr: 'Épilation laser del dos complet', pt: 'Depilação laser nas costas completas' },
  },
  {
    key: 'depilacion-laser-laser-ingles-integrales',
    relativePath: 'depilacion-laser/laser-ingles-integrales.jpeg',
    altPorLocale: { es: 'Depilación láser en ingles integrales', ca: 'Depilació làser a l’engonal integral', en: 'Laser Hollywood bikini hair removal', it: 'Depilazione laser inguine integrale', fr: 'Épilation laser del maillot intégral', pt: 'Depilação laser na virilha integral' },
  },
  {
    key: 'depilacion-laser-laser-labio',
    relativePath: 'depilacion-laser/laser-labio.jpeg',
    altPorLocale: { es: 'Depilación láser en labio superior', ca: 'Depilació làser al llavi superior', en: 'Laser upper lip hair removal', it: 'Depilazione laser labbro superiore', fr: 'Épilation laser de la lèvre supérieure', pt: 'Depilação laser no lábio superior' },
  },
  {
    key: 'depilacion-laser-laser-medias-piernas',
    relativePath: 'depilacion-laser/laser-medias-piernas.jpeg',
    altPorLocale: { es: 'Depilación láser en medias piernas', ca: 'Depilació làser a mitges cames', en: 'Laser half legs hair removal', it: 'Depilazione laser mezza gamba', fr: 'Épilation laser des demi-jambes', pt: 'Depilação laser nas meias pernas' },
  },
  {
    key: 'depilacion-laser-laser-piernas-completas',
    relativePath: 'depilacion-laser/laser-piernas-completas.jpeg',
    altPorLocale: { es: 'Depilación láser en piernas completas', ca: 'Depilació làser a cames completes', en: 'Laser full legs hair removal', it: 'Depilazione laser gambe intere', fr: 'Épilation laser des jambes complètes', pt: 'Depilação laser nas pernas completas' },
  },
  {
    key: 'depilacion-laser-laser-pecho',
    relativePath: 'depilacion-laser/laser-pecho.jpeg',
    altPorLocale: { es: 'Depilación láser en pecho', ca: 'Depilació làser al pit', en: 'Laser chest hair removal', it: 'Depilazione laser petto', fr: 'Épilation laser du torse', pt: 'Depilação laser no peito' },
  },
  {
    key: 'depilacion-laser-laser-ingles-brasilenas',
    relativePath: 'depilacion-laser/laser-ingles-brasilenas.jpeg',
    altPorLocale: { es: 'Depilación láser en ingles brasileñas', ca: 'Depilació làser a l’engonal brasiler', en: 'Laser Brazilian bikini hair removal', it: 'Depilazione laser inguine brasiliana', fr: 'Épilation laser du maillot brésilien', pt: 'Depilação laser na virilha brasileira' },
  },

  // Masajes (fotos oficiales)
  {
    key: 'masajes-masaje-relajante',
    relativePath: 'masajes/masaje-relajante.jpeg',
    altPorLocale: { es: 'Masaje relajante', ca: 'Massatge relaxant', en: 'Relaxing massage', it: 'Massaggio rilassante', fr: 'Massage relaxant', pt: 'Massagem relaxante' },
  },
  {
    key: 'masajes-masaje-descontracturante',
    relativePath: 'masajes/masaje-descontracturante.jpeg',
    altPorLocale: { es: 'Masaje descontracturante', ca: 'Massatge descontracturant', en: 'Deep tissue massage', it: 'Massaggio decontratturante', fr: 'Massage décontracturant', pt: 'Massagem descontraturante' },
  },
  {
    key: 'masajes-masaje-deportivo',
    relativePath: 'masajes/masaje-deportivo.jpeg',
    altPorLocale: { es: 'Masaje deportivo', ca: 'Massatge esportiu', en: 'Sports massage', it: 'Massaggio sportivo', fr: 'Massage sportif', pt: 'Massagem desportiva' },
  },
  {
    key: 'masajes-masaje-prenatal',
    relativePath: 'masajes/masaje-prenatal.jpeg',
    altPorLocale: { es: 'Masaje prenatal', ca: 'Massatge prenatal', en: 'Prenatal massage', it: 'Massaggio prenatale', fr: 'Massage prénatal', pt: 'Massagem pré-natal' },
  },
  {
    key: 'masajes-masaje-aromaterapia',
    relativePath: 'masajes/masaje-aromaterapia.jpeg',
    altPorLocale: { es: 'Masaje de aromaterapia', ca: 'Massatge d’aromateràpia', en: 'Aromatherapy massage', it: 'Massaggio aromaterapico', fr: 'Massage d’aromathérapie', pt: 'Massagem de aromaterapia' },
  },
  {
    key: 'masajes-masaje-craneofacial',
    relativePath: 'masajes/masaje-craneofacial.jpeg',
    altPorLocale: { es: 'Masaje craneofacial', ca: 'Massatge craniofacial', en: 'Craniofacial massage', it: 'Massaggio craniofacciale', fr: 'Massage crânio-facial', pt: 'Massagem craniofacial' },
  },
  {
    key: 'masajes-masaje-facial',
    relativePath: 'masajes/masaje-facial.jpeg',
    altPorLocale: { es: 'Masaje facial', ca: 'Massatge facial', en: 'Facial massage', it: 'Massaggio facciale', fr: 'Massage facial', pt: 'Massagem facial' },
  },
  {
    key: 'masajes-masaje-piernas-cansadas',
    relativePath: 'masajes/masaje-piernas-cansadas.jpeg',
    altPorLocale: { es: 'Masaje de piernas cansadas', ca: 'Massatge de cames cansades', en: 'Tired legs massage', it: 'Massaggio gambe stanche', fr: 'Massage jambes lourdes', pt: 'Massagem para pernas cansadas' },
  },
  {
    key: 'masajes-masaje-relajante-pies',
    relativePath: 'masajes/masaje-relajante-pies.jpeg',
    altPorLocale: { es: 'Masaje relajante de pies', ca: 'Massatge relaxant de peus', en: 'Relaxing foot massage', it: 'Massaggio rilassante ai piedi', fr: 'Massage relaxant des pieds', pt: 'Massagem relaxante para os pés' },
  },
  {
    key: 'masajes-reflexologia-podal',
    relativePath: 'masajes/reflexologia-podal.jpeg',
    altPorLocale: { es: 'Reflexología podal', ca: 'Reflexologia podal', en: 'Reflexology', it: 'Riflessologia plantare', fr: 'Réflexologie plantaire', pt: 'Reflexologia podal' },
  },
  {
    key: 'masajes-drenaje-manual',
    relativePath: 'masajes/drenaje-manual.jpeg',
    altPorLocale: { es: 'Drenaje linfático manual', ca: 'Drenatge limfàtic manual', en: 'Manual lymphatic drainage', it: 'Drenaggio linfatico manuale', fr: 'Drainage lymphatic manuel', pt: 'Drenagem linfática manual' },
  },
  {
    key: 'masajes-masaje-piedras-calientes',
    relativePath: 'masajes/masaje-piedras-calientes.jpeg',
    altPorLocale: { es: 'Masaje con piedras calientes', ca: 'Massatge amb pedres calentes', en: 'Hot stone massage', it: 'Massaggio con pietre calde', fr: 'Massage aux pierres chaudes', pt: 'Massagem com pedras quentes' },
  },
  {
    key: 'masajes-exfoliacion-corporal',
    relativePath: 'masajes/exfoliacion-corporal.jpeg',
    altPorLocale: { es: 'Exfoliación corporal', ca: 'Exfoliació corporal', en: 'Body scrub and exfoliation', it: 'Esfoliazione corporea', fr: 'Gommage corporel', pt: 'Esfoliação corporal' },
  },
]

export function mimeTypeFor(filePath: string): string {
  return filePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
}

/**
 * Sube (si no existe ya, por `filename`) el logo y la selección de
 * imágenes de stock a la colección `media`. Devuelve un mapa
 * `key -> id` para que el resto del seed (`index.ts`) pueda enlazar las
 * relaciones de imagen sin volver a tocar el sistema de archivos.
 */
export async function seedMedia(payload: BasePayload): Promise<Record<string, number>> {
  const ids: Record<string, number> = {}

  for (const file of MEDIA_FILES) {
    const filename = path.basename(file.relativePath)
    const existing = await payload.find({
      collection: 'media',
      where: { filename: { equals: filename } },
      // Sin fallback: hace falta distinguir "sin traducir todavía" de "ya
      // traducido pero por casualidad devuelto por el fallback a español"
      // (mismo razonamiento que `seedTratamientos`, `index.ts`).
      locale: 'all',
      fallbackLocale: false,
      limit: 1,
      overrideAccess: true,
    })
    const doc = existing.docs[0]

    if (shouldCreateDocument(doc)) {
      const absolutePath = path.join(PUBLIC_IMAGES_DIR, file.relativePath)
      const buffer = fs.readFileSync(absolutePath)
      const created = await payload.create({
        collection: 'media',
        overrideAccess: true,
        locale: 'es',
        data: { alt: file.altPorLocale.es },
        file: {
          data: buffer,
          mimetype: mimeTypeFor(absolutePath),
          name: filename,
          size: buffer.length,
        },
      })
      ids[file.key] = created.id

      // El local API tipado no admite `locale: 'all'` en escrituras (solo en
      // lecturas) — una llamada a `update` por idioma adicional, reutilizando
      // el mismo documento por `id`.
      for (const locale of LOCALES) {
        if (locale === 'es') {
          continue
        }
        await payload.update({
          collection: 'media',
          id: created.id,
          overrideAccess: true,
          locale,
          data: { alt: file.altPorLocale[locale] },
        })
      }
      continue
    }

    ids[file.key] = doc!.id
    const rawAlt = (doc as unknown as { alt?: RawLocalizedText }).alt
    const updates = computeMissingAltUpdates(rawAlt, file.altPorLocale, LOCALES)
    for (const update of updates) {
      await payload.update({ collection: 'media', id: doc!.id, overrideAccess: true, locale: update.locale, data: { alt: update.alt } })
    }
  }

  return ids
}
