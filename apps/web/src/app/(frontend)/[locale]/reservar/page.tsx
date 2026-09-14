import type { Metadata } from 'next'
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
  const session = await getOptionalSession()
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
