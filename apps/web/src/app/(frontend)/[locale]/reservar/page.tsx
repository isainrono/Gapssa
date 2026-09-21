import type { Metadata } from 'next'
import Link from 'next/link'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { notFound } from 'next/navigation'

import { publicEnv } from '@/lib/env.public'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { buildLocalizedMetadata } from '@/lib/seo/metadata'
import { getOptionalSession } from '@/server/auth/dal'

import { BookingWizard } from '@/components/client/booking/BookingWizard'

type Args = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tratamiento?: string; treatmentId?: string; treatment?: string }>
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) {
    return {}
  }
  const dict = getDictionary(locale)
  return {
    ...buildLocalizedMetadata({ locale, path: 'reservar', title: dict.reservar.titulo }, publicEnv.NEXT_PUBLIC_SITE_URL),
    robots: 'noindex, nofollow',
  }
}

export default async function ReservarPage({ params, searchParams }: Args) {
  const { locale } = await params
  const { tratamiento, treatmentId, treatment } = await searchParams
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)
  let session = null
  let hasServiceError = false

  try {
    session = await getOptionalSession()
  } catch (error) {
    if (isRedirectError(error)) {
      throw error
    }
    console.error('Error de servicio en /reservar:', error)
    hasServiceError = true
  }

  if (hasServiceError) {
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
            fontSize: '2.25rem',
            fontWeight: 400,
            marginBottom: '1rem',
            color: 'var(--text-primary)',
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
            fontSize: '1.05rem',
          }}
        >
          Estamos actualizando el sistema de reservas para ofrecerte la mejor experiencia posible. Disculpa las molestias.
        </p>
        <Link
          href={`/${locale}`}
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
          }}
        >
          {dict.notFound.volverInicio}
        </Link>
      </div>
    )
  }

  const initialTreatmentParam = tratamiento || treatmentId || treatment || ''

  return (
    <div className="section container" style={{ maxWidth: '40rem' }}>
      <BookingWizard
        dict={dict.reservar}
        isAuthenticated={session !== null}
        initialTreatmentParam={initialTreatmentParam}
      />
    </div>
  )
}
