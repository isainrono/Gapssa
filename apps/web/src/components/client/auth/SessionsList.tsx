'use client'

import { useEffect, useState } from 'react'

import type { Dictionary } from '@/lib/i18n/dictionary'
import type { Locale } from '@/lib/i18n/locales'
import { authFetch } from '@/lib/auth/authFetch'

import styles from './SessionsList.module.css'

type SessionDto = {
  id: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  ipAddress: string | null
  userAgent: string | null
  isCurrent: boolean
}

type Props = {
  dict: Dictionary['miCuenta']['sesiones']
  locale: Locale
}

export function SessionsList({ dict, locale }: Props) {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    authFetch<{ sessions: SessionDto[] }>('/api/auth/sessions').then((result) => {
      if (!cancelled && result.ok) {
        setSessions(result.data.sessions)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRevoke(id: string) {
    setPendingId(id)
    const result = await authFetch(`/api/auth/sessions/${id}`, { method: 'DELETE' })
    setPendingId(null)
    if (result.ok) {
      setSessions((current) => (current ? current.filter((session) => session.id !== id) : current))
    }
  }

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  if (sessions === null) {
    return <p className={styles.loading}>{dict.vacio}</p>
  }

  if (sessions.length === 0) {
    return <p className={styles.emptyState}>{dict.vacio}</p>
  }

  return (
    <ul className={styles.list}>
      {sessions.map((session) => (
        <li key={session.id} className={styles.item}>
          <div>
            <p className={styles.deviceLine}>
              {session.userAgent ?? '—'} {session.isCurrent && <span className={styles.badge}>{dict.actual}</span>}
            </p>
            <p className={styles.meta}>
              {dict.creada}: {formatter.format(new Date(session.createdAt))} · {dict.actividad}:{' '}
              {formatter.format(new Date(session.lastSeenAt))}
            </p>
          </div>
          <button
            type="button"
            className={styles.revokeButton}
            onClick={() => handleRevoke(session.id)}
            disabled={pendingId === session.id}
          >
            {dict.cerrarBoton}
          </button>
        </li>
      ))}
    </ul>
  )
}
