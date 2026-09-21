'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export default function LocaleError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled page error:', error)
  }, [error])

  return (
    <div
      className="container section"
      style={{
        textAlign: 'center',
        minHeight: '50vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        paddingBlock: '4rem',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '2.5rem',
          fontWeight: 400,
          color: 'var(--text-primary)',
          marginBottom: '1rem',
        }}
      >
        Estamos trabajando en novedades
      </h1>
      <p
        style={{
          color: 'var(--text-secondary)',
          maxWidth: '32rem',
          marginBottom: '2rem',
          lineHeight: '1.8',
          fontSize: '1.1rem',
        }}
      >
        Actualmente estamos realizando mejoras en esta sección del portal. Disculpa las molestias.
      </p>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/es"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.85rem 2rem',
            background: 'var(--color-gold)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: '0.85rem',
            fontWeight: 500,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            border: '1px solid var(--color-gold)',
            transition: 'all 0.2s ease',
          }}
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  )
}
