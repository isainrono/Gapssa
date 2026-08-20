import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getPaginaLegal, legalMetadata, tituloLegalPorDefecto } from '@/lib/content/legal'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'

import { LegalPageBody } from '@/components/server/site/LegalPageBody'

const TIPO = 'condiciones-reserva' as const

type Args = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) {
    return {}
  }
  return legalMetadata(locale, TIPO, getDictionary(locale))
}

export default async function CondicionesReservaPage({ params }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }
  const dict = getDictionary(locale)
  const pagina = await getPaginaLegal(locale, TIPO)

  return (
    <div className="section container">
      <LegalPageBody pagina={pagina} dict={dict} titulo={tituloLegalPorDefecto(TIPO, dict)} locale={locale} />
    </div>
  )
}
