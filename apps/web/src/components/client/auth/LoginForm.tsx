'use client'

import { useId, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import type { Dictionary } from '@/lib/i18n/dictionary'
import { authFetch } from '@/lib/auth/authFetch'
import { sanitizeRedirectTarget } from '@/lib/auth/redirectSafety'

import styles from './AuthForm.module.css'

type Props = {
  dict: Dictionary['miCuenta']
  registerHref: string
  forgotHref: string
  next: string | null
  fallbackAfterLogin: string
}

function mapErrorCode(code: string, dict: Dictionary['miCuenta']): string {
  switch (code) {
    case 'invalid_credentials':
      return dict.acceder.errorCredenciales
    case 'account_not_verified':
      return dict.acceder.errorNoVerificada
    case 'account_suspended':
      return dict.acceder.errorSuspendida
    case 'rate_limited':
      return dict.common.errorLimite
    case 'csrf_invalid':
      return dict.common.errorCsrf
    default:
      return dict.common.errorGenerico
  }
}

export function LoginForm({ dict, registerHref, forgotHref, next, fallbackAfterLogin }: Props) {
  const router = useRouter()
  const emailId = useId()
  const passwordId = useId()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await authFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })

    if (!result.ok) {
      setSubmitting(false)
      setError(mapErrorCode(result.error.code, dict))
      return
    }

    const target = sanitizeRedirectTarget(next, fallbackAfterLogin)
    router.push(target)
    router.refresh()
  }

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>{dict.acceder.titulo}</h1>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {error && (
          <p className={styles.alertError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={emailId}>
            {dict.acceder.correoLabel}
          </label>
          <input
            id={emailId}
            className={styles.input}
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={passwordId}>
            {dict.acceder.contrasenaLabel}
          </label>
          <input
            id={passwordId}
            className={styles.input}
            type="password"
            name="current-password"
            autoComplete="current-password"
            required
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <button className={styles.submit} type="submit" disabled={submitting}>
          {dict.acceder.entrarBoton}
        </button>
      </form>

      <div className={styles.links}>
        <a href={forgotHref}>{dict.acceder.olvidasteEnlace}</a>
        <span>
          {dict.acceder.noTienesCuenta} <a href={registerHref}>{dict.acceder.registrarseEnlace}</a>
        </span>
      </div>
    </div>
  )
}
