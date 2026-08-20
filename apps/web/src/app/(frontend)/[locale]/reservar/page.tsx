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

/**
 * Interfaz mínima de reserva — Fase 4A (encargo, punto 9). Sustituye la
 * página puramente informativa de Fase 2 (`PLAN_DESARROLLO_WEB_PORTAL.md`
 * §1 y §9 ya no aplican: el motor de reservas real, con adaptador EspoCRM
 * simulado, existe desde esta fase). Funciona para invitado (sin sesión)
 * y para cliente autenticado (`getOptionalSession`, Fase 3 DAL) —
 * `BookingWizard` decide el endpoint según `isAuthenticated`, sin
 * duplicar lógica de negocio en ningún lado (esa vive en
 * `server/booking/*`).
 */
export default async function ReservarPage({ params }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)
  const session = await getOptionalSession()

  return (
    <div className="section container" style={{ maxWidth: '40rem' }}>
      <BookingWizard dict={dict.reservar} isAuthenticated={session !== null} />
    </div>
  )
}
