import Link from 'next/link'

import { getDictionary } from '@/lib/i18n/dictionary'
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/locales'

type Args = {
  params?: Promise<{ locale?: string }>
}

/**
 * 404 con marca — cubre slugs de tratamiento y páginas legales inválidos
 * dentro de un locale válido (donde `[locale]/layout.tsx` sí ha podido
 * renderizar Header/Footer). El caso de un segmento de locale inválido
 * (`/xx`) no llega aquí — ver `src/app/not-found.tsx`, el layout falla
 * antes de tener `<html>` propio.
 */
export default async function LocaleNotFound({ params }: Args) {
  const resolved = params ? await params : undefined
  const locale = resolved?.locale && isLocale(resolved.locale) ? resolved.locale : DEFAULT_LOCALE
  const dict = getDictionary(locale)

  return (
    <div className="container section" style={{ textAlign: 'center' }}>
      <h1>{dict.notFound.titulo}</h1>
      <p>{dict.notFound.texto}</p>
      <p>
        <Link href={`/${locale}`}>{dict.notFound.volverInicio}</Link>
      </p>
    </div>
  )
}
