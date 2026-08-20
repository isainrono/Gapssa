import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ForgotPasswordForm } from '@/components/client/auth/ForgotPasswordForm'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'

type Args = {
  params: Promise<{ locale: string }>
}

export const metadata: Metadata = { robots: 'noindex, nofollow' }
export const dynamic = 'force-dynamic'

export default async function RecuperarPage({ params }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)

  return (
    <div className="container section">
      <ForgotPasswordForm
        dict={dict.miCuenta}
        loginHref={`/${locale}/mi-cuenta/acceder`}
        resetHref={(email) => `/${locale}/mi-cuenta/restablecer?email=${encodeURIComponent(email)}`}
      />
    </div>
  )
}
