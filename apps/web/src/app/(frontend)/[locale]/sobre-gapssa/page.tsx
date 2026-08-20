import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getContenidoSobreGapssa } from '@/lib/content/contenidoSobreGapssa'
import { publicEnv } from '@/lib/env.public'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { buildLocalizedMetadata } from '@/lib/seo/metadata'

import { DiferenciadoresSection } from '@/components/server/site/DiferenciadoresSection'
import { EstadisticasSection } from '@/components/server/site/EstadisticasSection'
import { ProcesoSection } from '@/components/server/site/ProcesoSection'
import { QuienSoySection } from '@/components/server/site/QuienSoySection'

type Args = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) {
    return {}
  }
  const dict = getDictionary(locale)
  return buildLocalizedMetadata(
    { locale, path: 'sobre-gapssa', title: `${dict.sobreGapssa.titulo}`, description: undefined },
    publicEnv.NEXT_PUBLIC_SITE_URL,
  )
}

export default async function SobreGapssaPage({ params }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)
  const sobreGapssa = await getContenidoSobreGapssa(locale)

  return (
    <div>
      <div className="section container">
        <h1 className="sr-only">{dict.sobreGapssa.titulo}</h1>
        <QuienSoySection sobreGapssa={sobreGapssa} eyebrow={dict.sobreGapssa.bioEyebrow} />
        <EstadisticasSection estadisticas={sobreGapssa.estadisticas ?? []} />
      </div>

      {sobreGapssa.proceso && sobreGapssa.proceso.length > 0 ? (
        <section className="section" style={{ background: 'var(--surface-alt)' }}>
          <div className="container">
            <ProcesoSection pasos={sobreGapssa.proceso} eyebrow={dict.home.procesoEyebrow} title={dict.sobreGapssa.procesoTitulo} />
          </div>
        </section>
      ) : null}

      <DiferenciadoresSection
        items={sobreGapssa.diferenciadores ?? []}
        eyebrow={dict.home.diferenciadoresEyebrow}
        title={dict.sobreGapssa.diferenciadoresTitulo}
      />
    </div>
  )
}
