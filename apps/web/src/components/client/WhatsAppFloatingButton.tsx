'use client'

import type { Locale } from '@/lib/i18n/locales'

import styles from './WhatsAppFloatingButton.module.css'

const DEFAULT_WHATSAPP_NUMBER = '+34680373663'

type Props = {
  whatsappNumber?: string
  locale: Locale
  label: string
}

export function WhatsAppFloatingButton({ whatsappNumber, locale, label }: Props) {
  const numberToUse = whatsappNumber || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER
  const cleanNumber = numberToUse ? numberToUse.replace(/\D/g, '') : ''
  const href = cleanNumber ? `https://wa.me/${cleanNumber}` : `/${locale}/contacto`
  const isExternal = Boolean(cleanNumber)

  return (
    <a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className={styles.button}
      aria-label={label}
    >
      <svg
        viewBox="0 0 24 24"
        width="32"
        height="32"
        fill="currentColor"
        aria-hidden="true"
        className={styles.icon}
      >
        <path d="M17.472 14.382c-.301-.15-1.776-.876-2.051-.976-.275-.1-.475-.15-.675.15-.2.3-.775.976-.95 1.176-.175.2-.35.225-.65.075-.301-.15-1.27-.468-2.42-1.494-.895-.798-1.5-1.784-1.675-2.084-.175-.3-.018-.462.132-.611.135-.134.3-.35.45-.525.15-.175.2-.3.3-.5.1-.2.05-.375-.025-.525-.075-.15-.675-1.625-.925-2.225-.243-.585-.49-.506-.675-.515-.175-.009-.375-.01-.575-.01-.2 0-.525.075-.8.375-.275.3-1.05 1.025-1.05 2.5 0 1.475 1.075 2.899 1.225 3.1.15.2 2.116 3.23 5.125 4.528.716.309 1.275.493 1.71.632.72.229 1.375.197 1.893.12.578-.087 1.776-.726 2.026-1.428.25-.702.25-1.304.175-1.428-.075-.124-.275-.2-.576-.35zM12.04 2C6.516 2 2.022 6.494 2.022 12.018c0 1.956.564 3.784 1.543 5.333L2 22.022l4.81-1.526c1.492.898 3.242 1.412 5.23 1.412 5.524 0 10.018-4.494 10.018-10.018C22.058 6.494 17.564 2 12.04 2z" />
      </svg>
      <span className={styles.tooltip}>{label}</span>
    </a>
  )
}
