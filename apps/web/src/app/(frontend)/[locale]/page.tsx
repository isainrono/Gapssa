import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { contactoConfigurado, getAjustesGlobales } from '@/lib/content/ajustesGlobales'
import { getContenidoInicio } from '@/lib/content/contenidoInicio'
import { getContenidoSobreGapssa } from '@/lib/content/contenidoSobreGapssa'
import { getFamilias } from '@/lib/content/familias'
import { getGaleria } from '@/lib/content/galeria'
import { getInstagramPosts } from '@/lib/content/instagram'
import { mediaAlt, mediaUrl } from '@/lib/content/media'
import { getTestimonios } from '@/lib/content/testimonios'
import { publicEnv } from '@/lib/env.public'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { buildLocalBusinessJsonLd } from '@/lib/seo/jsonld'
import { buildLocalizedMetadata } from '@/lib/seo/metadata'

import { JsonLd } from '@/components/server/JsonLd'
import { DiferenciadoresSection } from '@/components/server/site/DiferenciadoresSection'
import { ProcesoSection } from '@/components/server/site/ProcesoSection'
import { QuienSoySection } from '@/components/server/site/QuienSoySection'
import { SectionHeading } from '@/components/server/site/SectionHeading'
import { TestimonialsCarousel } from '@/components/client/TestimonialsCarousel'

import styles from './Home.module.css'

type Args = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) {
    return {}
  }
  const ajustes = await getAjustesGlobales(locale)
  return buildLocalizedMetadata(
    {
      locale,
      path: '',
      title: ajustes.seoPorDefecto?.titulo || ajustes.nombreComercial,
      description: ajustes.seoPorDefecto?.descripcion || undefined,
      ogImage: mediaUrl(ajustes.seoPorDefecto?.ogImage),
    },
    publicEnv.NEXT_PUBLIC_SITE_URL,
  )
}

export default async function HomePage({ params }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)
  const [ajustes, inicio, sobreGapssa, familias, testimonios, galeria, instagramPosts] = await Promise.all([
    getAjustesGlobales(locale),
    getContenidoInicio(locale),
    getContenidoSobreGapssa(locale),
    getFamilias(locale),
    getTestimonios(locale),
    getGaleria(locale, 6),
    getInstagramPosts(locale),
  ])

  const contacto = contactoConfigurado(ajustes)
  const heroImageUrl = mediaUrl(inicio.heroImagen, 'hero')
  const ctaRuta = ajustes.ctaPrincipal?.ruta ?? 'reservar'
  const ctaLabel = ajustes.ctaPrincipal?.texto || dict.common.reservarCita

  return (
    <>
      <JsonLd
        data={buildLocalBusinessJsonLd({
          ajustes,
          siteUrl: publicEnv.NEXT_PUBLIC_SITE_URL,
          logoUrl: mediaUrl(ajustes.logo),
        })}
      />

      <section className={styles.hero} aria-label={dict.home.contactoTitulo}>
        {heroImageUrl ? (
          <div className={styles.heroImage}>
            <Image src={heroImageUrl} alt="" fill priority sizes="100vw" />
          </div>
        ) : null}
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>{inicio.heroTitulo}</h1>
          {inicio.heroSubtitulo ? <p className={styles.heroSubtitle}>{inicio.heroSubtitulo}</p> : null}
          <div className={styles.heroCtas}>
            <Link href={`/${locale}/${ctaRuta}`} className={styles.buttonGold}>
              {ctaLabel}
            </Link>
            {contacto.whatsapp ? (
              <a
                href={`https://wa.me/${contacto.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.buttonOutline}
              >
                WhatsApp
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <QuienSoySection
            sobreGapssa={sobreGapssa}
            eyebrow={dict.home.quienSoyEyebrow}
            cta={{ href: `/${locale}/sobre-gapssa`, label: dict.home.quienSoyCta }}
          />
        </div>
      </section>

      {familias.length > 0 ? (
        <section className="section" style={{ background: 'var(--surface-alt)' }}>
          <div className="container">
            <SectionHeading eyebrow={dict.home.familiasEyebrow} title={dict.home.familiasTitulo} intro={inicio.introFamilias ?? undefined} />
            <div className={styles.familiasGrid}>
              {familias.slice(0, 6).map((familia) => {
                const imgUrl = mediaUrl(familia.imagen, 'card')
                return (
                  <Link key={familia.id} href={`/${locale}/tratamientos?familia=${familia.slug}`} className={styles.familiaCard}>
                    {imgUrl ? <Image src={imgUrl} alt={mediaAlt(familia.imagen)} fill sizes="(min-width: 1000px) 33vw, 50vw" /> : null}
                    <div className={styles.familiaOverlay}>
                      <span className={styles.familiaTitle}>{familia.titulo}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
            <div className={styles.centeredCta}>
              <Link href={`/${locale}/tratamientos`} className={styles.buttonOutline}>
                {dict.home.familiasCta}
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {sobreGapssa.proceso && sobreGapssa.proceso.length > 0 ? (
        <section className="section">
          <div className="container">
            <ProcesoSection pasos={sobreGapssa.proceso} eyebrow={dict.home.procesoEyebrow} title={dict.home.procesoTitulo} />
          </div>
        </section>
      ) : null}

      <DiferenciadoresSection
        items={sobreGapssa.diferenciadores ?? []}
        eyebrow={dict.home.diferenciadoresEyebrow}
        title={dict.sobreGapssa.diferenciadoresTitulo}
      />

      {testimonios.length > 0 ? (
        <section className="section" style={{ background: 'var(--surface-alt)' }}>
          <div className="container">
            <SectionHeading eyebrow={dict.home.testimoniosEyebrow} title={dict.home.testimoniosTitulo} />
            <TestimonialsCarousel
              testimonios={testimonios}
              anteriorLabel={dict.common.testimonioAnterior}
              siguienteLabel={dict.common.testimonioSiguiente}
              irATestimonioLabel={dict.common.irATestimonio}
            />
          </div>
        </section>
      ) : null}

      {galeria.length > 0 ? (
        <section className="section">
          <div className="container">
            <SectionHeading eyebrow={dict.home.galeriaEyebrow} title={dict.home.galeriaTitulo} />
            <div className={styles.galeriaGrid}>
              {galeria.map((item) => {
                const imgUrl = mediaUrl(item.imagen, 'card')
                return imgUrl ? (
                  <div key={item.id} className={styles.galeriaItem}>
                    <Image src={imgUrl} alt={item.alt} fill sizes="(min-width: 640px) 33vw, 50vw" />
                  </div>
                ) : null
              })}
            </div>
          </div>
        </section>
      ) : null}

      {instagramPosts.length > 0 ? (
        <section className="section" style={{ background: 'var(--surface-alt)' }}>
          <div className="container">
            <SectionHeading eyebrow={dict.home.instagramEyebrow} title="Instagram" />
            <div className={styles.instagramGrid}>
              {instagramPosts.map((post) => {
                const imgUrl = mediaUrl(post.imagen, 'card')
                return imgUrl ? (
                  <a key={post.id} href={post.url} target="_blank" rel="noopener noreferrer" className={styles.instagramItem}>
                    <Image src={imgUrl} alt={mediaAlt(post.imagen)} fill sizes="16vw" />
                  </a>
                ) : null
              })}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="container">
          <div className={styles.contactoCta}>
            <SectionHeading eyebrow={dict.home.contactoEyebrow} title={dict.home.contactoTitulo} intro={inicio.introContacto ?? undefined} />
            <Link href={`/${locale}/contacto`} className={styles.buttonGold}>
              {dict.home.contactoCta}
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
