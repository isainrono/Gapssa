import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { RegisterForm } from '@/components/client/auth/RegisterForm'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { getOptionalSession } from '@/server/auth/dal'

type Args = {
  params: Promise<{ locale: string }>
}

export const metadata: Metadata = { robots: 'noindex, nofollow' }
export const dynamic = 'force-dynamic'

export default async function RegistroPage({ params }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  let existingSession = null
  try {
    existingSession = await getOptionalSession()
  } catch (err) {
    console.error('Error al comprobar sesión previa en /mi-cuenta/registro:', err)
  }
  if (existingSession) {
    redirect(`/${locale}/mi-cuenta`)
  }

  const dict = getDictionary(locale)

  return (
    <div className="container section">
      <RegisterForm dict={dict.miCuenta} locale={locale} loginHref={`/${locale}/mi-cuenta/acceder`} />
    </div>
  )
}
