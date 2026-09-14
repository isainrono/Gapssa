import Image from 'next/image'
import Link from 'next/link'

import { getAjustesGlobales } from '@/lib/content/ajustesGlobales'
import { getDictionary } from '@/lib/i18n/dictionary'
import type { Locale } from '@/lib/i18n/locales'

import { LanguageSwitcher } from '@/components/client/LanguageSwitcher'
import { MobileNav } from '@/components/client/MobileNav'

import styles from './Header.module.css'

type Props = {
  locale: Locale
}

export async function Header({ locale }: Props) {
  const dict = getDictionary(locale)
  const ajustes = await getAjustesGlobales(locale)

  const navItems = [
    { href: `/${locale}`, label: dict.nav.inicio },
    { href: `/${locale}/tratamientos`, label: dict.nav.tratamientos },
    { href: `/${locale}/sobre-gapssa`, label: dict.nav.sobreGapssa },
    { href: `/${locale}/contacto`, label: dict.nav.contacto },
    { href: `/${locale}/mi-cuenta`, label: dict.nav.miCuenta },
  ]

  const ctaRuta = ajustes.ctaPrincipal?.ruta ?? 'reservar'
  const ctaLabel = ajustes.ctaPrincipal?.texto || dict.common.reservarCita
  const ctaHref = `/${locale}/${ctaRuta}`

  return (
    <header className={styles.header}>
      <Link href={`/${locale}`} className={styles.logoLink}>
        <Image
          src="/images/marca/gapssa-logo-oficial.webp"
          alt={`Logotipo de ${ajustes.nombreComercial}`}
          width={35}
          height={44}
          className={styles.logoImage}
          priority
        />
      </Link>

      <nav className={styles.desktopNav}>
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className={styles.navLink}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className={styles.actions}>
        <LanguageSwitcher locale={locale} label={dict.idioma.selectorLabel} />
        <Link href={ctaHref} className={styles.ctaButton}>
          {ctaLabel}
        </Link>
      </div>

      <MobileNav
        locale={locale}
        navItems={[...navItems, { href: ctaHref, label: ctaLabel }]}
        abrirMenuLabel={dict.nav.abrirMenu}
        cerrarMenuLabel={dict.nav.cerrarMenu}
        selectorIdiomaLabel={dict.idioma.selectorLabel}
      />
    </header>
  )
}
