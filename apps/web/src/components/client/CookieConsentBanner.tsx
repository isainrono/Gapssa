'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import type { Locale } from '@/lib/i18n/locales'

import styles from './CookieConsentBanner.module.css'

const STORAGE_KEY = 'gapssa_cookie_consent'

type Props = {
  locale: Locale
  dict: {
    titulo: string
    mensaje: string
    aceptar: string
    rechazar: string
    politica: string
  }
}

export function CookieConsentBanner({ locale, dict }: Props) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setMounted(true)
    const consent = localStorage.getItem(STORAGE_KEY)
    if (!consent) {
      setVisible(true)
    }
  }, [])

  if (!mounted || !visible) {
    return null
  }

  const handleAccept = () => {
    localStorage.setItem(STORAGE_KEY, 'accepted')
    setVisible(false)
    window.dispatchEvent(new CustomEvent('gapssa_consent_accepted'))
  }

  const handleReject = () => {
    localStorage.setItem(STORAGE_KEY, 'rejected')
    setVisible(false)
    window.dispatchEvent(new CustomEvent('gapssa_consent_rejected'))
  }

  return (
    <aside
      className={styles.banner}
      role="region"
      aria-label={dict.titulo}
      aria-describedby="cookie-desc"
    >
      <div className={styles.container}>
        <div className={styles.content}>
          <h2 className={styles.title}>{dict.titulo}</h2>
          <p id="cookie-desc" className={styles.message}>
            {dict.mensaje}
            <Link href={`/${locale}/legal/cookies`} className={styles.link}>
              {dict.politica}
            </Link>
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.rejectButton}
            onClick={handleReject}
          >
            {dict.rechazar}
          </button>
          <button
            type="button"
            className={styles.acceptButton}
            onClick={handleAccept}
          >
            {dict.aceptar}
          </button>
        </div>
      </div>
    </aside>
  )
}
