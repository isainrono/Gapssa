import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { LoginForm } from '@/components/client/auth/LoginForm'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { sanitizeRedirectTarget } from '@/lib/auth/redirectSafety'
import { getOptionalSession } from '@/server/auth/dal'

type Args = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ next?: string }>
}

export const metadata: Metadata = { robots: 'noindex, nofollow' }
export const dynamic = 'force-dynamic'

export default async function AccederPage({ params, searchParams }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const dashboardHref = `/${locale}/mi-cuenta`
  const existingSession = await getOptionalSession()
  if (existingSession) {
    redirect(dashboardHref)
  }

  const { next } = await searchParams
  const safeNext = next ? sanitizeRedirectTarget(next, dashboardHref) : null
  const dict = getDictionary(locale)

  return (
    <div className="container section">
      <LoginForm
        dict={dict.miCuenta}
        registerHref={`/${locale}/mi-cuenta/registro`}
        forgotHref={`/${locale}/mi-cuenta/recuperar`}
        next={safeNext}
        fallbackAfterLogin={dashboardHref}
      />
    </div>
  )
}
