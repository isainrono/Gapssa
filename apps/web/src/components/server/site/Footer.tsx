import Link from 'next/link'

import { contactoConfigurado, getAjustesGlobales } from '@/lib/content/ajustesGlobales'
import { getDictionary } from '@/lib/i18n/dictionary'
import type { Locale } from '@/lib/i18n/locales'

import styles from './Footer.module.css'

type Props = {
  locale: Locale
}

export async function Footer({ locale }: Props) {
  const dict = getDictionary(locale)
  const ajustes = await getAjustesGlobales(locale)
  const contacto = contactoConfigurado(ajustes)
  const direccionTexto = [ajustes.direccion?.calle, ajustes.direccion?.ciudad].filter(Boolean).join(', ')

  const navItems = [
    { href: `/${locale}`, label: dict.nav.inicio },
    { href: `/${locale}/tratamientos`, label: dict.nav.tratamientos },
    { href: `/${locale}/sobre-gapssa`, label: dict.nav.sobreGapssa },
    { href: `/${locale}/contacto`, label: dict.nav.contacto },
  ]

  const legalItems = [
    { href: `/${locale}/legal/aviso-legal`, label: dict.footer.legalAvisoLegal },
    { href: `/${locale}/legal/privacidad`, label: dict.footer.legalPrivacidad },
    { href: `/${locale}/legal/cookies`, label: dict.footer.legalCookies },
    { href: `/${locale}/legal/condiciones-reserva`, label: dict.footer.legalCondicionesReserva },
  ]

  return (
    <footer className={styles.footer}>
      <div className={styles.grid}>
        <div className={styles.brand}>
          <p className={styles.brandName}>{ajustes.nombreComercial}</p>
          {direccionTexto ? <p className={styles.link}>{direccionTexto}</p> : null}
        </div>

        <div>
          <p className={styles.columnTitle}>{dict.footer.navegacionTitulo}</p>
          <ul className={styles.linkList}>
            {navItems.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={styles.link}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className={styles.columnTitle}>{dict.footer.contactoTitulo}</p>
          <ul className={styles.linkList}>
            {direccionTexto ? <li className={styles.link}>{direccionTexto}</li> : null}
            {contacto.telefono ? (
              <li>
                <a href={`tel:${contacto.telefono}`} className={styles.link}>
                  {contacto.telefono}
                </a>
              </li>
            ) : null}
            {contacto.correoPublico ? (
              <li>
                <a href={`mailto:${contacto.correoPublico}`} className={styles.link}>
                  {contacto.correoPublico}
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          <p className={styles.columnTitle}>{dict.footer.reservasTitulo}</p>
          <p className={styles.link}>{dict.footer.reservasTexto}</p>
        </div>
      </div>

      <div className={styles.bottomRow}>
        <p className={styles.copyright}>
          © {new Date().getFullYear()} {ajustes.nombreComercial} · {dict.footer.copyrightNota}
        </p>
        <ul className={styles.legalLinks}>
          {legalItems.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={styles.link}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}
