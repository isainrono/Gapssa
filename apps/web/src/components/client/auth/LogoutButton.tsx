'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { authFetch } from '@/lib/auth/authFetch'

type Props = {
  label: string
  className: string | undefined
  redirectTo: string
}

export function LogoutButton({ label, className, redirectTo }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function handleClick() {
    setSubmitting(true)
    await authFetch('/api/auth/logout', { method: 'POST' })
    router.push(redirectTo)
    router.refresh()
  }

  return (
    <button type="button" className={className} onClick={handleClick} disabled={submitting}>
      {label}
    </button>
  )
}
