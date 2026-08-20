import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getFamilias } from '@/lib/content/familias'
import { mediaUrl } from '@/lib/content/media'
import { getTratamientos, precioLabel } from '@/lib/content/tratamientos'
import { publicEnv } from '@/lib/env.public'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { buildLocalizedMetadata } from '@/lib/seo/metadata'

import { SectionHeading } from '@/components/server/site/SectionHeading'

import styles from './Catalogo.module.css'

type Args = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ familia?: string }>
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) {
    return {}
  }
  const dict = getDictionary(locale)
  return buildLocalizedMetadata(
    { locale, path: 'tratamientos', title: `${dict.catalogo.titulo} — GAPSSA by Nana`, description: dict.catalogo.intro },
    publicEnv.NEXT_PUBLIC_SITE_URL,
  )
}

export default async function CatalogoPage({ params, searchParams }: Args) {
  const { locale } = await params
  const { familia: familiaSlug } = await searchParams
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)
  const [familias, tratamientos] = await Promise.all([getFamilias(locale), getTratamientos(locale, { familiaSlug })])

  const familiasAMostrar = familiaSlug ? familias.filter((familia) => familia.slug === familiaSlug) : familias

  return (
    <div className="section container">
      <SectionHeading as="h1" eyebrow={dict.home.familiasEyebrow} title={dict.catalogo.titulo} intro={dict.catalogo.intro} />

      <nav className={styles.filtros} aria-label={dict.catalogo.titulo}>
        <Link href={`/${locale}/tratamientos`} className={`${styles.filtroPill} ${!familiaSlug ? styles.filtroPillActive : ''}`}>
          {dict.catalogo.filtroTodos}
        </Link>
        {familias.map((familia) => (
          <Link
            key={familia.id}
            href={`/${locale}/tratamientos?familia=${familia.slug}`}
            className={`${styles.filtroPill} ${familiaSlug === familia.slug ? styles.filtroPillActive : ''}`}
          >
            {familia.titulo}
          </Link>
        ))}
      </nav>

      {familiasAMostrar.map((familia) => {
        const items = tratamientos.filter((tratamiento) => {
          const familiaId = typeof tratamiento.familia === 'number' ? tratamiento.familia : tratamiento.familia.id
          return familiaId === familia.id
        })
        return (
          <div key={familia.id} id={familia.slug} className={styles.familiaGrupo}>
            <h2 className={styles.familiaGrupoTitulo}>{familia.titulo}</h2>
            {items.length === 0 ? (
              <p className={styles.emptyState}>{dict.catalogo.sinTratamientos}</p>
            ) : (
              <div className={styles.grid}>
                {items.map((tratamiento) => {
                  const imgUrl = mediaUrl(tratamiento.imagenes?.[0], 'card')
                  const precio = precioLabel(tratamiento.indicadorPrecio, dict)
                  return (
                    <article key={tratamiento.id} className={styles.card}>
                      {imgUrl ? (
                        <div className={styles.cardImage}>
                          <Image src={imgUrl} alt="" fill sizes="(min-width: 1000px) 33vw, (min-width: 640px) 50vw, 100vw" />
                        </div>
                      ) : null}
                      <div className={styles.cardBody}>
                        <h3 className={styles.cardTitle}>{tratamiento.titulo}</h3>
                        {tratamiento.descripcion ? <p className={styles.cardDescripcion}>{tratamiento.descripcion}</p> : null}
                        {precio ? (
                          <div className={styles.cardFooter}>
                            <span className={styles.cardPrecio}>{precio}</span>
                          </div>
                        ) : null}
                        <Link href={`/${locale}/tratamientos/${tratamiento.slug}`} className={styles.cardLink}>
                          {dict.common.verMas}
                        </Link>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
