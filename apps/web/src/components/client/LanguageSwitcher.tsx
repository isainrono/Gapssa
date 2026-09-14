'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { getDictionary } from '@/lib/i18n/dictionary'
import { LOCALES, type Locale } from '@/lib/i18n/locales'
import { swapLocaleInPath } from '@/lib/i18n/pathnames'

import styles from './LanguageSwitcher.module.css'

type Props = {
  locale: Locale
  label: string
}

export function LanguageSwitcher({ locale, label }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function selectLocale(nextLocale: Locale) {
    setOpen(false)
    if (nextLocale !== locale) router.push(swapLocaleInPath(pathname, nextLocale))
  }

  return (
    <div ref={rootRef} className={styles.switcher}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
          const index = event.key === 'ArrowUp' ? LOCALES.length - 1 : 0
          requestAnimationFrame(() => optionRefs.current[index]?.focus())
        }}
      >
        <svg className={styles.globe} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
        </svg>
        <span>{getDictionary(locale).idioma[locale]}</span>
        <svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} viewBox="0 0 12 8" aria-hidden="true">
          <path d="m1 1 5 5 5-5" />
        </svg>
      </button>

      {open ? (
        <div id={menuId} className={styles.menu} role="listbox" aria-label={label}>
          <span className={styles.menuEyebrow}>{label}</span>
          {LOCALES.map((loc, index) => {
            const selected = loc === locale
            return (
              <button
                key={loc}
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                type="button"
                role="option"
                aria-selected={selected}
                className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                onClick={() => selectLocale(loc)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                  event.preventDefault()
                  const offset = event.key === 'ArrowDown' ? 1 : -1
                  optionRefs.current[(index + offset + LOCALES.length) % LOCALES.length]?.focus()
                }}
              >
                <span className={styles.localeCode}>{loc.toUpperCase()}</span>
                <span className={styles.localeName}>{getDictionary(loc).idioma[loc]}</span>
                <span className={styles.check} aria-hidden="true">✓</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
