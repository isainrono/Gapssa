import config from '@payload-config'
import { getPayload } from 'payload'

import { LOCALES, type Locale } from '@/lib/i18n/locales'

import { DIRECCION_SEED, HORARIO_SEED, SEO_POR_DEFECTO_SEED } from './data/ajustesGlobales'
import { BIO_SEED, DIFERENCIADORES_SEED, PROCESO_SEED } from './data/contenidoSobreGapssa'
import { CONTENIDO_INICIO_SEED } from './data/contenidoInicio'
import { FAMILIAS_SEED } from './data/familias'
import { GALERIA_SEED } from './data/galeria'
import { PAGINAS_LEGALES_SEED } from './data/paginasLegales'
import { TESTIMONIOS_SEED } from './data/testimonios'
import { TRATAMIENTOS_SEED } from './data/tratamientos'
import { assertSeedAllowedInEnv } from './guard'
import { shouldCreateDocument, shouldSeedGlobalField } from './idempotent'
import { computeMissingTratamientoLocaleUpdates, type RawLocalizedTratamiento } from './localeCompletion'
import { seedMedia } from './media'
import { reconcileTestimoniosFicticios } from './reconcileTestimoniosFicticios'

const OTHER_LOCALES: Exclude<Locale, 'es'>[] = ['ca', 'en', 'it', 'fr', 'pt']

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

async function run() {
  assertSeedAllowedInEnv(process.env.NODE_ENV)

  const payload = await getPayload({ config })
  const summary: Record<string, string> = {}

  payload.logger.info('Fase 2 — seed: iniciando (idempotente, nunca sobrescribe ediciones existentes)')

  const mediaIds = await seedMedia(payload)
  summary.media = `${Object.keys(mediaIds).length} archivos listos`

  summary.ajustesGlobales = await seedAjustesGlobales(payload, mediaIds)
  summary.contenidoInicio = await seedContenidoInicio(payload, mediaIds)
  summary.contenidoSobreGapssa = await seedContenidoSobreGapssa(payload, mediaIds)

  const familiaIdPorSlug = await seedFamilias(payload, mediaIds)
  summary.familias = `${Object.keys(familiaIdPorSlug).length} familias listas`

  summary.tratamientos = await seedTratamientos(payload, familiaIdPorSlug, mediaIds)
  summary.testimonios = await seedTestimonios(payload)
  // Corrige, de forma reproducible, cualquier base que haya ejecutado la
  // primera versión de este seed (testimonios ficticios publicados y
  // visibles antes de que existiera `requireAutorizacionParaPublicar`) —
  // ver el comentario de `reconcileTestimoniosFicticios.ts`.
  summary.testimoniosFicticios = await reconcileTestimoniosFicticios(payload)
  summary.galeria = await seedGaleria(payload, mediaIds)
  summary.paginasLegales = await seedPaginasLegales(payload)
  summary.instagramPosts = 'sin seedear a propósito — cuenta de Instagram todavía no confirmada'

  payload.logger.info({ summary }, 'Fase 2 — seed: completado')
  console.table(summary)
  process.exit(0)
}

async function seedAjustesGlobales(payload: PayloadClient, mediaIds: Record<string, number>): Promise<string> {
  const actual = await payload.findGlobal({ slug: 'ajustes-globales', overrideAccess: true })
  if (!shouldSeedGlobalField(actual.direccion?.calle)) {
    return 'sin cambios (ya configurado)'
  }

  await payload.updateGlobal({
    slug: 'ajustes-globales',
    overrideAccess: true,
    locale: 'es',
    data: {
      direccion: DIRECCION_SEED,
      horario: HORARIO_SEED,
      logo: mediaIds['logo'],
      seoPorDefecto: { titulo: SEO_POR_DEFECTO_SEED.es.titulo, descripcion: SEO_POR_DEFECTO_SEED.es.descripcion, ogImage: mediaIds['logo'] },
    },
  })
  for (const locale of OTHER_LOCALES) {
    await payload.updateGlobal({
      slug: 'ajustes-globales',
      overrideAccess: true,
      locale,
      data: { seoPorDefecto: { titulo: SEO_POR_DEFECTO_SEED[locale].titulo, descripcion: SEO_POR_DEFECTO_SEED[locale].descripcion } },
    })
  }
  return 'actualizado (campos vacíos rellenados)'
}

async function seedContenidoInicio(payload: PayloadClient, mediaIds: Record<string, number>): Promise<string> {
  const actual = await payload.findGlobal({ slug: 'contenido-inicio', overrideAccess: true })
  if (!shouldSeedGlobalField(actual.heroTitulo)) {
    return 'sin cambios (ya configurado)'
  }

  await payload.updateGlobal({
    slug: 'contenido-inicio',
    overrideAccess: true,
    locale: 'es',
    data: { ...CONTENIDO_INICIO_SEED.es, heroImagen: mediaIds['hero-centro'] },
  })
  for (const locale of OTHER_LOCALES) {
    await payload.updateGlobal({ slug: 'contenido-inicio', overrideAccess: true, locale, data: CONTENIDO_INICIO_SEED[locale] })
  }
  return 'creado'
}

async function seedContenidoSobreGapssa(payload: PayloadClient, mediaIds: Record<string, number>): Promise<string> {
  const actual = await payload.findGlobal({ slug: 'contenido-sobre-gapssa', overrideAccess: true })
  if (!shouldSeedGlobalField(actual.bioTitulo)) {
    return 'sin cambios (ya configurado)'
  }

  const primerPase = await payload.updateGlobal({
    slug: 'contenido-sobre-gapssa',
    overrideAccess: true,
    locale: 'es',
    data: {
      bioTitulo: BIO_SEED.es.bioTitulo,
      bioTexto: BIO_SEED.es.bioTexto,
      bioCita: BIO_SEED.es.bioCita,
      bioImagen: mediaIds['diana'],
      bioBullets: BIO_SEED.es.bioBullets.map((texto) => ({ texto })),
      proceso: PROCESO_SEED.map((paso) => ({ numero: paso.numero, titulo: paso.porLocale.es.titulo, descripcion: paso.porLocale.es.descripcion })),
      diferenciadores: DIFERENCIADORES_SEED.map((item) => ({
        iconoClave: item.iconoClave,
        titulo: item.porLocale.es.titulo,
        descripcion: item.porLocale.es.descripcion,
      })),
    },
  })

  // Los `id` que Payload asigna a cada fila de los arrays al crearlos se
  // reutilizan en las siguientes llamadas (una por idioma) para que
  // actualicen las MISMAS filas en vez de crear filas nuevas por idioma.
  const bulletIds = (primerPase.bioBullets ?? []).map((bullet) => bullet.id)
  const procesoIds = (primerPase.proceso ?? []).map((paso) => paso.id)
  const diferenciadorIds = (primerPase.diferenciadores ?? []).map((item) => item.id)

  for (const locale of OTHER_LOCALES) {
    await payload.updateGlobal({
      slug: 'contenido-sobre-gapssa',
      overrideAccess: true,
      locale,
      data: {
        bioTitulo: BIO_SEED[locale].bioTitulo,
        bioTexto: BIO_SEED[locale].bioTexto,
        bioCita: BIO_SEED[locale].bioCita,
        bioBullets: BIO_SEED[locale].bioBullets.map((texto, index) => ({ id: bulletIds[index] ?? undefined, texto })),
        proceso: PROCESO_SEED.map((paso, index) => ({
          id: procesoIds[index] ?? undefined,
          numero: paso.numero,
          titulo: paso.porLocale[locale].titulo,
          descripcion: paso.porLocale[locale].descripcion,
        })),
        diferenciadores: DIFERENCIADORES_SEED.map((item, index) => ({
          id: diferenciadorIds[index] ?? undefined,
          iconoClave: item.iconoClave,
          titulo: item.porLocale[locale].titulo,
          descripcion: item.porLocale[locale].descripcion,
        })),
      },
    })
  }
  return 'creado'
}

const FAMILIA_IMAGEN_POR_SLUG: Record<string, string> = {
  faciales: 'tratamiento-facial',
  'pestanas-cejas': 'hidratacion-facial',
  depilacion: 'depilacion-facial',
  'depilacion-laser': 'depilacion-facial',
  unas: 'manicura',
  masajes: 'masajes-masaje-relajante',
}

async function seedFamilias(payload: PayloadClient, mediaIds: Record<string, number>): Promise<Record<string, number>> {
  const familiaIdPorSlug: Record<string, number> = {}

  for (const familia of FAMILIAS_SEED) {
    const existing = await payload.find({
      collection: 'familias-tratamiento',
      where: { slug: { equals: familia.slug } },
      limit: 1,
      overrideAccess: true,
    })
    if (!shouldCreateDocument(existing.docs[0])) {
      familiaIdPorSlug[familia.slug] = existing.docs[0]!.id
      continue
    }

    const created = await payload.create({
      collection: 'familias-tratamiento',
      overrideAccess: true,
      locale: 'es',
      draft: false,
      data: {
        slug: familia.slug,
        titulo: familia.porLocale.es.titulo,
        descripcion: familia.porLocale.es.descripcion,
        imagen: mediaIds[FAMILIA_IMAGEN_POR_SLUG[familia.slug] ?? ''],
        orden: familia.orden,
        visible: true,
        _status: 'published',
      },
    })
    familiaIdPorSlug[familia.slug] = created.id

    for (const locale of OTHER_LOCALES) {
      await payload.update({
        collection: 'familias-tratamiento',
        id: created.id,
        overrideAccess: true,
        locale,
        data: { titulo: familia.porLocale[locale].titulo, descripcion: familia.porLocale[locale].descripcion },
      })
    }
  }

  // Ocultar familias obsoletas que no están en la lista oficial (ej. aparatologia)
  const validSlugs = FAMILIAS_SEED.map((f) => f.slug)
  const obsoleteFamilias = await payload.find({
    collection: 'familias-tratamiento',
    where: { slug: { not_in: validSlugs } },
    limit: 100,
    overrideAccess: true,
  })
  for (const doc of obsoleteFamilias.docs) {
    await payload.update({
      collection: 'familias-tratamiento',
      id: doc.id,
      data: { visible: false },
      overrideAccess: true,
    })
  }

  return familiaIdPorSlug
}

const DESTACADO_IMAGEN_POR_SLUG: Record<string, string> = {
  'lipolaser-radiofrecuencia': 'radiofrecuencia-facial',

  // Uñas (fotos oficiales)
  'manicura-express': 'unas-manicura-express',
  'manicura-semipermanente': 'unas-manicura-semipermanente',
  'manicura-tradicional': 'unas-manicura-tradicional',
  'parafina-manos': 'unas-parafina-manos',
  'pedicura-express': 'unas-pedicura-express',
  'pedicura-semipermanente': 'unas-pedicura-semipermanente',
  'pedicura-tradicional': 'unas-pedicura-tradicional',

  // Faciales (fotos oficiales)
  'limpieza-facial-basica': 'faciales-limpieza-basica',
  'limpieza-facial-profunda': 'faciales-limpieza-profunda',
  'mesoterapia-estetica': 'faciales-mesoterapia-estetica',
  'microneedling': 'faciales-microneedling',
  'dermapen': 'faciales-dermapen',
  'radiofrecuencia-facial': 'faciales-radiofrecuencia-facial',
  'peeling-prx': 'faciales-peeling-prx',
  'skinpen': 'faciales-skinpen',
  'laser-carbono': 'faciales-laser-carbono',

  // Pestañas y cejas (fotos oficiales)
  'lifting-pestanas': 'pestanas-cejas-lifting-pestanas',
  'lifting-pestanas-tinte': 'pestanas-cejas-lifting-pestanas-tinte',
  'tinte-pestanas-cejas': 'pestanas-cejas-tinte-pestanas-cejas',
  'laminado-cejas': 'pestanas-cejas-laminado-cejas',

  // Depilación (fotos oficiales)
  'depilacion-diseno-cejas': 'depilacion-diseno-cejas',
  'depilacion-cejas': 'depilacion-cejas',
  'depilacion-labio-superior': 'depilacion-labio-superior',
  'depilacion-menton': 'depilacion-menton',
  'depilacion-patillas': 'depilacion-patillas',
  'depilacion-facial-completa': 'depilacion-facial-completa',
  'depilacion-axilas': 'depilacion-axilas',
  'depilacion-espalda': 'depilacion-espalda',
  'depilacion-brazos': 'depilacion-brazos',
  'depilacion-medio-brazo': 'depilacion-medio-brazo',
  'depilacion-pecho': 'depilacion-pecho',
  'depilacion-abdomen': 'depilacion-abdomen',
  'depilacion-gluteos': 'depilacion-gluteos',
  'depilacion-perianal': 'depilacion-perianal',
  'depilacion-ingles-brasilenas': 'depilacion-ingles-brasilenas',
  'depilacion-ingles-normales': 'depilacion-ingles-normales',
  'depilacion-piernas': 'depilacion-piernas',
  'depilacion-medias-piernas': 'depilacion-medias-piernas',

  // Depilación Láser (fotos oficiales)
  'laser-patillas': 'depilacion-laser-laser-patillas',
  'laser-menton': 'depilacion-laser-laser-menton',
  'laser-axilas': 'depilacion-laser-laser-axilas',
  'laser-espalda': 'depilacion-laser-laser-espalda',
  'laser-ingles-integrales': 'depilacion-laser-laser-ingles-integrales',
  'laser-labio': 'depilacion-laser-laser-labio',
  'laser-medias-piernas': 'depilacion-laser-laser-medias-piernas',
  'laser-piernas-completas': 'depilacion-laser-laser-piernas-completas',
  'laser-pecho': 'depilacion-laser-laser-pecho',
  'laser-ingles-brasilenas': 'depilacion-laser-laser-ingles-brasilenas',

  // Masajes (fotos oficiales)
  'masaje-relajante': 'masajes-masaje-relajante',
  'masaje-descontracturante': 'masajes-masaje-descontracturante',
  'masaje-deportivo': 'masajes-masaje-deportivo',
  'masaje-prenatal': 'masajes-masaje-prenatal',
  'masaje-aromaterapia': 'masajes-masaje-aromaterapia',
  'masaje-craneofacial': 'masajes-masaje-craneofacial',
  'masaje-facial': 'masajes-masaje-facial',
  'masaje-piernas-cansadas': 'masajes-masaje-piernas-cansadas',
  'masaje-relajante-pies': 'masajes-masaje-relajante-pies',
  'reflexologia-podal': 'masajes-reflexologia-podal',
  'drenaje-manual': 'masajes-drenaje-manual',
  'piedras-calientes': 'masajes-masaje-piedras-calientes',
  'exfoliacion-corporal': 'masajes-exfoliacion-corporal',
}

function imagenKeyParaTratamiento(slug: string, familiaSlug: string): string {
  return DESTACADO_IMAGEN_POR_SLUG[slug] ?? FAMILIA_IMAGEN_POR_SLUG[familiaSlug] ?? 'tratamiento-facial'
}

/**
 * A diferencia del resto de colecciones de este seed (que crean-o-saltan
 * por documento vía `shouldCreateDocument`), `tratamientos` además
 * **completa** los idiomas que falten en un documento ya existente —
 * requisito de la revisión 2 de Fase 2: el catálogo previo solo traducía 5
 * de los 57, y una segunda ejecución del seed se limitaba a saltar los 57
 * documentos ya creados sin rellenar nunca el resto de idiomas. Nunca pisa
 * un valor ya presente (`computeMissingTratamientoLocaleUpdates`,
 * `localeCompletion.ts`): una edición manual desde /admin en un idioma
 * sobrevive a la siguiente ejecución del seed igual que antes.
 */
async function seedTratamientos(
  payload: PayloadClient,
  familiaIdPorSlug: Record<string, number>,
  mediaIds: Record<string, number>,
): Promise<string> {
  let creados = 0
  let actualizados = 0

  for (const tratamiento of TRATAMIENTOS_SEED) {
    const existing = await payload.find({
      collection: 'tratamientos',
      where: { slug: { equals: tratamiento.slug } },
      // Sin fallback: se necesita saber qué idioma tiene contenido propio
      // de verdad, no lo que Payload devolvería con el `fallback: true`
      // global de `payload.config.ts`.
      locale: 'all',
      fallbackLocale: false,
      limit: 1,
      overrideAccess: true,
    })
    const doc = existing.docs[0]

    if (shouldCreateDocument(doc)) {
      const esTraduccion = tratamiento.porLocale.es
      const imagenKey = imagenKeyParaTratamiento(tratamiento.slug, tratamiento.familiaSlug)
      const imagenId = mediaIds[imagenKey]
      if (imagenId === undefined) {
        throw new Error(`No se encontró el recurso de imagen "${imagenKey}" para el tratamiento "${tratamiento.slug}"`)
      }
      const created = await payload.create({
        collection: 'tratamientos',
        overrideAccess: true,
        locale: 'es',
        draft: false,
        data: {
          slug: tratamiento.slug,
          familia: familiaIdPorSlug[tratamiento.familiaSlug] as number,
          titulo: esTraduccion.titulo,
          descripcion: esTraduccion.descripcion,
          beneficios: esTraduccion.beneficios.map((texto) => ({ texto })),
          requisitosContraindicaciones: esTraduccion.requisitosContraindicaciones,
          preguntasFrecuentes: esTraduccion.preguntasFrecuentes?.map((faq) => ({ pregunta: faq.pregunta, respuesta: faq.respuesta })),
          seo: esTraduccion.seo ? { title: esTraduccion.seo.titulo, description: esTraduccion.seo.descripcion } : undefined,
          imagenes: [imagenId],
          indicadorPrecio: 'consultar',
          visible: true,
          destacado: Boolean(tratamiento.destacado),
          orden: tratamiento.orden,
          _status: 'published',
        },
      })
      creados += 1

      // Reutiliza los `id` de fila que Payload acaba de asignar a
      // `beneficios`/`preguntasFrecuentes` para que las siguientes llamadas
      // (una por idioma) actualicen las MISMAS filas en vez de crear filas
      // nuevas por idioma (mismo patrón que `seedContenidoSobreGapssa`).
      const beneficioIds = (created.beneficios ?? []).map((fila) => fila.id)
      const faqIds = (created.preguntasFrecuentes ?? []).map((fila) => fila.id)

      for (const locale of OTHER_LOCALES) {
        const traduccion = tratamiento.porLocale[locale]
        await payload.update({
          collection: 'tratamientos',
          id: created.id,
          overrideAccess: true,
          locale,
          data: {
            titulo: traduccion.titulo,
            descripcion: traduccion.descripcion,
            beneficios: traduccion.beneficios.map((texto, index) => ({ id: beneficioIds[index], texto })),
            requisitosContraindicaciones: traduccion.requisitosContraindicaciones,
            preguntasFrecuentes: traduccion.preguntasFrecuentes?.map((faq, index) => ({
              id: faqIds[index],
              pregunta: faq.pregunta,
              respuesta: faq.respuesta,
            })),
            seo: traduccion.seo ? { title: traduccion.seo.titulo, description: traduccion.seo.descripcion } : undefined,
          },
        })
      }
      continue
    }

    // El documento ya existe: completa solo los idiomas/campos que falten.
    const raw = doc as unknown as RawLocalizedTratamiento
    const updates = computeMissingTratamientoLocaleUpdates(raw, tratamiento.porLocale, LOCALES)
    const imagenKey = imagenKeyParaTratamiento(tratamiento.slug, tratamiento.familiaSlug)
    const imagenId = mediaIds[imagenKey]
    if (imagenId !== undefined) {
      await payload.update({
        collection: 'tratamientos',
        id: raw.id,
        overrideAccess: true,
        locale: 'es',
        data: { imagenes: [imagenId] },
      })
    }
    if (updates.length > 0) {
      actualizados += 1
    }
    for (const update of updates) {
      await payload.update({
        collection: 'tratamientos',
        id: raw.id,
        overrideAccess: true,
        locale: update.locale,
        data: update.data,
      })
    }
  }

  return `${creados} creados, ${actualizados} completados con idiomas que faltaban, ${TRATAMIENTOS_SEED.length - creados - actualizados} ya estaban completos`
}

/**
 * Los 4 testimonios de `TESTIMONIOS_SEED` son contenido editorial de
 * ejemplo, no reseñas reales de clientas (ver el comentario de ese
 * archivo) — revisión 2 de Fase 2 corrige que antes se creaban visibles y
 * publicados. Se siembran como borrador (`_status: 'draft'`), no visibles
 * (`visible: false`) y sin autorización (`autorizacionRegistrada: false`):
 * existen en /admin para que el equipo pueda ver cómo luce el carrusel,
 * pero nunca son alcanzables por la web pública. `TestimonioAutorizacion.ts`
 * además impediría publicarlos o hacerlos visibles por accidente sin
 * marcar antes la autorización.
 */
async function seedTestimonios(payload: PayloadClient): Promise<string> {
  let creados = 0

  for (const testimonio of TESTIMONIOS_SEED) {
    const existing = await payload.find({
      collection: 'testimonios',
      locale: 'es',
      where: { autor: { equals: testimonio.autorPorLocale.es } },
      limit: 1,
      overrideAccess: true,
    })
    if (!shouldCreateDocument(existing.docs[0])) {
      continue
    }

    const created = await payload.create({
      collection: 'testimonios',
      overrideAccess: true,
      locale: 'es',
      draft: true,
      data: {
        texto: testimonio.textoPorLocale.es,
        autor: testimonio.autorPorLocale.es,
        visible: false,
        orden: testimonio.orden,
        autorizacionRegistrada: false,
        _status: 'draft',
      },
    })
    creados += 1

    for (const locale of OTHER_LOCALES) {
      await payload.update({
        collection: 'testimonios',
        id: created.id,
        overrideAccess: true,
        locale,
        data: { texto: testimonio.textoPorLocale[locale], autor: testimonio.autorPorLocale[locale] },
      })
    }
  }

  return `${creados} creados, ${TESTIMONIOS_SEED.length - creados} ya existían`
}

async function seedGaleria(payload: PayloadClient, mediaIds: Record<string, number>): Promise<string> {
  let creados = 0

  for (const item of GALERIA_SEED) {
    const existing = await payload.find({
      collection: 'galeria',
      locale: 'es',
      where: { categoria: { equals: item.categoriaPorLocale.es } },
      limit: 1,
      overrideAccess: true,
    })
    if (!shouldCreateDocument(existing.docs[0])) {
      continue
    }

    const created = await payload.create({
      collection: 'galeria',
      overrideAccess: true,
      locale: 'es',
      draft: false,
      data: {
        imagen: mediaIds[item.mediaKey] as number,
        alt: item.altPorLocale.es,
        categoria: item.categoriaPorLocale.es,
        orden: item.orden,
        visible: true,
        _status: 'published',
      },
    })
    creados += 1

    for (const locale of OTHER_LOCALES) {
      await payload.update({
        collection: 'galeria',
        id: created.id,
        overrideAccess: true,
        locale,
        data: { alt: item.altPorLocale[locale], categoria: item.categoriaPorLocale[locale] },
      })
    }
  }

  return `${creados} creadas, ${GALERIA_SEED.length - creados} ya existían`
}

async function seedPaginasLegales(payload: PayloadClient): Promise<string> {
  let creadas = 0

  for (const pagina of PAGINAS_LEGALES_SEED) {
    const existing = await payload.find({
      collection: 'paginas-legales',
      where: { tipo: { equals: pagina.tipo } },
      limit: 1,
      overrideAccess: true,
    })
    if (!shouldCreateDocument(existing.docs[0])) {
      continue
    }

    const created = await payload.create({
      collection: 'paginas-legales',
      overrideAccess: true,
      locale: 'es',
      draft: false,
      data: {
        tipo: pagina.tipo,
        titulo: pagina.porLocale.es.titulo,
        contenido: pagina.porLocale.es.contenido,
        version: '0.1',
        fecha: new Date().toISOString(),
        estado: 'provisional',
        seoNoIndex: true,
        _status: 'published',
      },
    })
    creadas += 1

    for (const locale of OTHER_LOCALES) {
      await payload.update({
        collection: 'paginas-legales',
        id: created.id,
        overrideAccess: true,
        locale,
        data: { titulo: pagina.porLocale[locale].titulo, contenido: pagina.porLocale[locale].contenido },
      })
    }
  }

  return `${creadas} creadas, ${PAGINAS_LEGALES_SEED.length - creadas} ya existían`
}

run().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
