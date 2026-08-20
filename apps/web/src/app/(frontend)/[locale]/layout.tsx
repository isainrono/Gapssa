import type { Metadata } from 'next'
import { Cormorant_Garamond, Jost } from 'next/font/google'
import { notFound } from 'next/navigation'

import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale, type Locale } from '@/lib/i18n/locales'

import { AnalyticsScript } from '@/components/server/AnalyticsScript'
import { Footer } from '@/components/server/site/Footer'
import { Header } from '@/components/server/site/Header'

import '@/styles/globals.css'

/**
 * Autoalojadas por Next (`next/font/google` descarga en build y sirve
 * desde el propio dominio, sin `<link>` a fonts.googleapis.com como en la
 * maqueta de referencia). Cada una publica su propia variable CSS
 * (`--font-serif`/`--font-sans`) vía `variable`, aplicada como clase en
 * `<html>` más abajo; `styles/globals.css` las consume con `var(...)`.
 */
const cormorantGaramond = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
})

const jost = Jost({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'GAPSSA by Nana',
  description: 'Centro de estética y belleza integral en Barcelona.',
}

/**
 * Todo el sitio público se sirve dinámico (SSR por petición contra
 * Postgres vía la Local API de Payload), nunca export estático — decisión
 * de arquitectura de Fase 2: el contenido es editable desde /admin en
 * cualquier momento y una página estática sin revalidación mostraría
 * contenido obsoleto hasta el siguiente `next build`. Se fija aquí, en el
 * layout, para que se aplique a todas las páginas de `(frontend)/[locale]`
 * sin repetirlo en cada una. `generateStaticParams` ya no se usa aquí
 * (dejaría de tener efecto con `force-dynamic`, y solo servía para listar
 * los 6 locales — `isLocale()` + `notFound()` más abajo ya los valida en
 * cada petición real).
 *
 * Sigue siendo la decisión correcta para cerrar Fase 2, pero con matices
 * documentados como deuda técnica (revalidación bajo demanda vía hooks de
 * Payload, coste por visita, agotamiento del pool si se pre-renderizan en
 * masa los 6 × 57 tratamientos) — ver "Deuda técnica — SSR y revalidación"
 * en `apps/web/README.md`. No cambiar sin pruebas de publicación,
 * actualización e invalidación.
 */
export const dynamic = 'force-dynamic'

type Args = {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

/**
 * Layout raíz del sitio público (grupo de rutas `(frontend)`), separado
 * del layout raíz de `(payload)`. Cada grupo de rutas de nivel superior
 * lleva su propio <html>/<body> — así lo estructura la propia plantilla
 * oficial de Payload para Next.js.
 */
export default async function LocaleLayout({ children, params }: Args) {
  const { locale } = await params

  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)

  return (
    <html lang={locale satisfies Locale} className={`${cormorantGaramond.variable} ${jost.variable}`}>
      <body>
        <a href="#contenido-principal" className="skip-link">
          {dict.common.saltarAlContenido}
        </a>
        <Header locale={locale} />
        <main id="contenido-principal">{children}</main>
        <Footer locale={locale} />
        <AnalyticsScript />
      </body>
    </html>
  )
}
