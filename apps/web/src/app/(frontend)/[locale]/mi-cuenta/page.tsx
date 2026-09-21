import type { Metadata } from 'next'
import Link from 'next/link'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { notFound } from 'next/navigation'

import type { ClientAccountStatus } from '@gapssa/contracts'
import { DeleteAccountButton } from '@/components/client/auth/DeleteAccountButton'
import { LogoutButton } from '@/components/client/auth/LogoutButton'
import { SessionsList } from '@/components/client/auth/SessionsList'
import { getDictionary, type Dictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { requireSession } from '@/server/auth/dal'

import styles from './MiCuenta.module.css'

type Args = {
  params: Promise<{ locale: string }>
}

// Ruta privada: nunca indexable (PLAN_DESARROLLO_WEB_PORTAL.md §16).
export const metadata: Metadata = {
  robots: 'noindex, nofollow',
}

export const dynamic = 'force-dynamic'

function statusLabel(status: ClientAccountStatus, dict: Dictionary['miCuenta']['dashboard']): string {
  switch (status) {
    case 'active':
      return dict.estadoActive
    case 'pending_verification':
      return dict.estadoPendingVerification
    case 'suspended':
      return dict.estadoSuspended
    case 'pending_deletion':
      return dict.estadoPendingDeletion
  }
}

/**
 * Portada privada mínima de `/mi-cuenta` (Fase 3,
 * `PLAN_DESARROLLO_WEB_PORTAL.md` §6): datos básicos de cuenta, sesiones
 * activas, y estados vacíos para citas/cuestionarios/consentimientos —
 * ninguna sección de pagos, facturas, bonos ni suscripciones, ocultas por
 * completo hasta que la integración económica exista (§8.2).
 */
export default async function MiCuentaPage({ params }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)

  let sessionResult
  try {
    sessionResult = await requireSession(locale)
  } catch (error) {
    if (isRedirectError(error)) {
      throw error
    }
    console.error('Error de servicio en /mi-cuenta:', error)
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
          Actualmente estamos realizando mejoras en el área de usuario. Disculpa las molestias.
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

  const { account } = sessionResult

  return (
    <div className="container section">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{dict.miCuenta.dashboard.titulo}</h1>
          <p className={styles.welcome}>{dict.miCuenta.dashboard.bienvenida}</p>
        </div>
        <LogoutButton
          label={dict.miCuenta.dashboard.cerrarSesionBoton}
          className={styles.logoutButton}
          redirectTo={`/${locale}`}
        />
      </div>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{dict.miCuenta.dashboard.titulo}</h2>
          <div className={styles.dataRow}>
            <span className={styles.dataLabel}>{dict.miCuenta.dashboard.correoLabel}</span>
            <span>{account.email}</span>
          </div>
          <div className={styles.dataRow}>
            <span className={styles.dataLabel}>{dict.miCuenta.dashboard.estadoLabel}</span>
            <span>{statusLabel(account.status, dict.miCuenta.dashboard)}</span>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{dict.miCuenta.sesiones.titulo}</h2>
          <SessionsList dict={dict.miCuenta.sesiones} locale={locale} />
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{dict.miCuenta.dashboard.citasTitulo}</h2>
          <p className={styles.emptyState}>{dict.miCuenta.dashboard.citasVacio}</p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{dict.miCuenta.dashboard.cuestionariosTitulo}</h2>
          <p className={styles.emptyState}>{dict.miCuenta.dashboard.cuestionariosVacio}</p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{dict.miCuenta.dashboard.consentimientosTitulo}</h2>
          <p className={styles.emptyState}>{dict.miCuenta.dashboard.consentimientosVacio}</p>
        </section>
      </div>

      <div className={styles.dangerZone}>
        <h2 className={styles.cardTitle}>{dict.miCuenta.dashboard.eliminarTitulo}</h2>
        <p className={styles.dangerText}>{dict.miCuenta.dashboard.eliminarTexto}</p>
        <DeleteAccountButton
          label={dict.miCuenta.dashboard.eliminarBoton}
          confirmMessage={dict.miCuenta.dashboard.eliminarConfirmacion}
          className={styles.deleteButton}
          redirectTo={`/${locale}`}
        />
      </div>
    </div>
  )
}
