'use client'

import { useEffect, useRef, useState } from 'react'

import type { Locale } from '@/lib/i18n/locales'

import { LanguageSwitcher } from './LanguageSwitcher'
import styles from './MobileNav.module.css'

type NavItem = {
  href: string
  label: string
}

type Props = {
  locale: Locale
  navItems: NavItem[]
  abrirMenuLabel: string
  cerrarMenuLabel: string
  selectorIdiomaLabel: string
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), select, [tabindex]:not([tabindex="-1"])'

/**
 * Menú móvil a pantalla completa. Accesibilidad deliberada, no
 * decorativa: `aria-expanded`/`aria-controls` en el disparador, Escape
 * cierra, el foco se mueve al panel al abrir y vuelve al disparador al
 * cerrar, el bloqueo de scroll del body es reversible (se restaura el
 * valor anterior, no se fuerza `hidden` a ciegas), y un trampa de foco
 * básica evita que Tab escape del panel mientras está abierto.
 */
export function MobileNav({ locale, navItems, abrirMenuLabel, cerrarMenuLabel, selectorIdiomaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Distingue "se acaba de cerrar" (debe devolver el foco al disparador)
  // de "montaje inicial con open=false" (no debe tocar el foco en
  // absoluto): sin esto, el efecto de abajo robaba el foco hacia el botón
  // de hamburguesa en cuanto la página cargaba, en cualquier viewport
  // donde fuera visible — rompía el primer Tab del teclado en móvil.
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      return
    }

    const panel = panelRef.current
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    firstFocusable?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !panel) {
        return
      }
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) {
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open && wasOpenRef.current) {
      triggerRef.current?.focus()
    }
    wasOpenRef.current = open
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls="menu-movil"
        aria-label={abrirMenuLabel}
        onClick={() => setOpen(true)}
      >
        <span className={styles.triggerBarWide} />
        <span className={styles.triggerBarNarrow} />
        <span className={styles.triggerBarWide} />
      </button>

      {open ? (
        <div id="menu-movil" ref={panelRef} className={styles.overlay} role="dialog" aria-modal="true">
          <button type="button" className={styles.closeButton} aria-label={cerrarMenuLabel} onClick={() => setOpen(false)}>
            ✕
          </button>
          {navItems.map((item) => (
            <a key={item.href} href={item.href} className={styles.link} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          <div className={styles.switcherRow}>
            <LanguageSwitcher locale={locale} label={selectorIdiomaLabel} />
          </div>
        </div>
      ) : null}
    </>
  )
}
