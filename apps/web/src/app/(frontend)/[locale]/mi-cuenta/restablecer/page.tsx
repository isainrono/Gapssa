import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ResetPasswordForm } from '@/components/client/auth/ResetPasswordForm'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'

type Args = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ email?: string }>
}

export const metadata: Metadata = { robots: 'noindex, nofollow' }
export const dynamic = 'force-dynamic'

export default async function RestablecerPage({ params, searchParams }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const { email } = await searchParams
  const dict = getDictionary(locale)

  return (
    <div className="container section">
      <ResetPasswordForm dict={dict.miCuenta} loginHref={`/${locale}/mi-cuenta/acceder`} initialEmail={email} />
    </div>
  )
}
