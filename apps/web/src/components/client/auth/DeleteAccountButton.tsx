'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { authFetch } from '@/lib/auth/authFetch'

type Props = {
  label: string
  confirmMessage: string
  className: string | undefined
  redirectTo: string
}

export function DeleteAccountButton({ label, confirmMessage, className, redirectTo }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function handleClick() {
    // Confirmación nativa del navegador — suficiente para esta acción
    // destructiva de baja frecuencia, sin necesidad de un sistema de
    // diálogos propio en esta fase.
    if (!window.confirm(confirmMessage)) {
      return
    }
    setSubmitting(true)
    await authFetch('/api/auth/account/delete-request', { method: 'POST' })
    router.push(redirectTo)
    router.refresh()
  }

  return (
    <button type="button" className={className} onClick={handleClick} disabled={submitting}>
      {label}
    </button>
  )
}
