import { parrafosDe } from '@/lib/content/legal'
import type { Dictionary } from '@/lib/i18n/dictionary'
import type { Locale } from '@/lib/i18n/locales'
import type { PaginasLegale } from '@/payload-types'

import styles from './LegalPageBody.module.css'

type Props = {
  pagina: PaginasLegale | undefined
  dict: Dictionary
  titulo: string
  locale: Locale
}

/**
 * Reutilizado por las 4 rutas `legal/*`. Si `pagina` no existe todavía
 * (colección sin seedear o documento borrado), muestra el aviso
 * profesional que pide el encargo — nunca un dato legal inventado
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §11).
 */
export function LegalPageBody({ pagina, dict, titulo, locale }: Props) {
  if (!pagina) {
    return (
      <div>
        <h1>{titulo}</h1>
        <p className={styles.aviso}>{dict.legal.pendienteValidacion}</p>
      </div>
    )
  }

  const fecha = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(pagina.fecha))

  return (
    <div>
      <h1>{pagina.titulo}</h1>
      <div className={styles.meta}>
        <span>
          {dict.legal.versionLabel}: {pagina.version}
        </span>
        <span>
          {dict.legal.fechaLabel}: {fecha}
        </span>
      </div>
      {pagina.estado === 'provisional' ? <p className={styles.aviso}>{dict.legal.provisionalAviso}</p> : null}
      <div className={styles.contenido}>
        {parrafosDe(pagina.contenido).map((parrafo, index) => (
          <p key={index}>{parrafo}</p>
        ))}
      </div>
    </div>
  )
}
