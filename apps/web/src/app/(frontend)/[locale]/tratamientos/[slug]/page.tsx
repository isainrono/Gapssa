import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'

import { mediaAlt, mediaUrl } from '@/lib/content/media'
import { getTratamientoPorSlug, precioLabel } from '@/lib/content/tratamientos'
import { publicEnv } from '@/lib/env.public'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { buildBreadcrumbJsonLd } from '@/lib/seo/jsonld'
import { buildLocalizedMetadata, buildLocalizedUrl } from '@/lib/seo/metadata'

import { Breadcrumbs } from '@/components/server/site/Breadcrumbs'
import { JsonLd } from '@/components/server/JsonLd'

import styles from './Detalle.module.css'

type Args = {
  params: Promise<{ locale: string; slug: string }>
}

// Sin `generateStaticParams` a propósito: el contenido vive en Postgres y
// es editable desde /admin en cualquier momento (decisión de arquitectura
// de Fase 2, ver el plan aprobado — "renderizado dinámico, no export
// estático"). Pre-renderizar aquí 6 idiomas × cada tratamiento agotaba el
// pool de conexiones de Postgres durante `next build` (11 workers en
// paralelo, cientos de páginas a la vez) — el mismo problema que la
// decisión de arquitectura ya evitaba para el resto de páginas del sitio.
export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { locale, slug } = await params
  if (!isLocale(locale)) {
    return {}
  }
  const tratamiento = await getTratamientoPorSlug(locale, slug)
  if (!tratamiento) {
    return {}
  }
  return buildLocalizedMetadata(
    {
      locale,
      path: `tratamientos/${slug}`,
      title: tratamiento.seo?.title || `${tratamiento.titulo} — GAPSSA by Nana`,
      description: tratamiento.seo?.description || tratamiento.descripcion || undefined,
      ogImage: mediaUrl(tratamiento.imagenes?.[0]),
    },
    publicEnv.NEXT_PUBLIC_SITE_URL,
  )
}

export default async function TratamientoDetallePage({ params }: Args) {
  const { locale, slug } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)
  const tratamiento = await getTratamientoPorSlug(locale, slug)
  if (!tratamiento) {
    notFound()
  }

  const familia = typeof tratamiento.familia === 'number' ? undefined : tratamiento.familia
  const imgUrl = mediaUrl(tratamiento.imagenes?.[0], 'hero')
  const precio = precioLabel(tratamiento.indicadorPrecio, dict)

  const breadcrumbItems = [
    { label: dict.common.inicioBreadcrumb, href: `/${locale}` },
    { label: dict.nav.tratamientos, href: `/${locale}/tratamientos` },
    { label: tratamiento.titulo },
  ]
  const breadcrumbJsonLdItems = [
    { name: dict.common.inicioBreadcrumb, url: buildLocalizedUrl(publicEnv.NEXT_PUBLIC_SITE_URL, locale, '') },
    { name: dict.nav.tratamientos, url: buildLocalizedUrl(publicEnv.NEXT_PUBLIC_SITE_URL, locale, 'tratamientos') },
    { name: tratamiento.titulo, url: buildLocalizedUrl(publicEnv.NEXT_PUBLIC_SITE_URL, locale, `tratamientos/${slug}`) },
  ]

  return (
    <div className="section container">
      <JsonLd data={buildBreadcrumbJsonLd(breadcrumbJsonLdItems)} />
      <Breadcrumbs items={breadcrumbItems} />

      <div className={styles.grid}>
        <div className={styles.imageWrapper}>
          {imgUrl ? <Image src={imgUrl} alt={mediaAlt(tratamiento.imagenes?.[0])} fill sizes="(min-width: 900px) 50vw, 100vw" /> : null}
        </div>

        <div>
          {familia ? (
            <span className={styles.familiaBadge}>{familia.titulo}</span>
          ) : null}
          <h1 className={styles.titulo}>{tratamiento.titulo}</h1>
          {precio ? <p className={styles.precio}>{precio}</p> : null}
          {tratamiento.descripcion ? <p className={styles.descripcion}>{tratamiento.descripcion}</p> : null}

          <a href={`/${locale}/reservar?tratamiento=${tratamiento.slug}`} className={styles.reservarBoton}>
            {dict.tratamiento.reservarBoton}
          </a>

          {tratamiento.beneficios && tratamiento.beneficios.length > 0 ? (
            <>
              <h2 className={styles.sectionTitle}>{dict.tratamiento.beneficiosTitulo}</h2>
              <ul className={styles.beneficiosList}>
                {tratamiento.beneficios.map((beneficio) => (
                  <li key={beneficio.id}>
                    <span className={styles.bulletDot} />
                    <span>{beneficio.texto}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {tratamiento.requisitosContraindicaciones ? (
            <>
              <h2 className={styles.sectionTitle}>{dict.tratamiento.requisitosTitulo}</h2>
              <p className={styles.requisitos}>{tratamiento.requisitosContraindicaciones}</p>
            </>
          ) : null}

          {tratamiento.preguntasFrecuentes && tratamiento.preguntasFrecuentes.length > 0 ? (
            <>
              <h2 className={styles.sectionTitle}>{dict.tratamiento.faqTitulo}</h2>
              <div>
                {tratamiento.preguntasFrecuentes.map((faq) => (
                  <details key={faq.id} className={styles.faqItem}>
                    <summary>{faq.pregunta}</summary>
                    <p>{faq.respuesta}</p>
                  </details>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
