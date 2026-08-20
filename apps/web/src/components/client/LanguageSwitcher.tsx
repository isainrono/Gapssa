'use client'

import { usePathname, useRouter } from 'next/navigation'

import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale, LOCALES, type Locale } from '@/lib/i18n/locales'
import { swapLocaleInPath } from '@/lib/i18n/pathnames'

import styles from './LanguageSwitcher.module.css'

type Props = {
  locale: Locale
  label: string
}

/**
 * `<select>` nativo en vez de un desplegable propio: teclado y lectores de
 * pantalla lo entienden gratis, sin implementar un listbox accesible a
 * mano. Sustituye solo el segmento de locale del pathname actual
 * (`swapLocaleInPath`, `src/lib/i18n/pathnames.ts`) — nunca traduce el
 * resto de la ruta porque los slugs son estables entre idiomas.
 */
export function LanguageSwitcher({ locale, label }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <select
      className={styles.select}
      aria-label={label}
      value={locale}
      onChange={(event) => {
        const target = event.target.value
        if (isLocale(target)) {
          router.push(swapLocaleInPath(pathname, target))
        }
      }}
    >
      {LOCALES.map((loc) => (
        <option key={loc} value={loc}>
          {getDictionary(loc).idioma[loc]}
        </option>
      ))}
    </select>
  )
}
