'use client'

import { useId, useState, type FormEvent } from 'react'

import type { Dictionary } from '@/lib/i18n/dictionary'
import { authFetch } from '@/lib/auth/authFetch'

import styles from './AuthForm.module.css'

type Props = {
  dict: Dictionary['miCuenta']
  loginHref: string
  resetHref: (email: string) => string
}

function mapErrorCode(code: string, dict: Dictionary['miCuenta']): string {
  switch (code) {
    case 'rate_limited':
      return dict.common.errorLimite
    case 'csrf_invalid':
      return dict.common.errorCsrf
    default:
      return dict.common.errorGenerico
  }
}

export function ForgotPasswordForm({ dict, loginHref, resetHref }: Props) {
  const emailId = useId()

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await authFetch('/api/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })

    setSubmitting(false)

    if (!result.ok) {
      setError(mapErrorCode(result.error.code, dict))
      return
    }

    setSuccess(true)
  }

  if (success) {
    return (
      <div className={styles.wrapper}>
        <h1 className={styles.title}>{dict.recuperar.titulo}</h1>
        <p className={styles.alertSuccess} role="status">
          {dict.recuperar.exitoMensaje}
        </p>
        <div className={styles.links}>
          <a href={resetHref(email)}>{dict.restablecer.titulo}</a>
          <a href={loginHref}>{dict.recuperar.volverAAccederEnlace}</a>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>{dict.recuperar.titulo}</h1>
      <p className={styles.intro}>{dict.recuperar.texto}</p>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {error && (
          <p className={styles.alertError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={emailId}>
            {dict.recuperar.correoLabel}
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

        <button className={styles.submit} type="submit" disabled={submitting}>
          {dict.recuperar.enviarBoton}
        </button>
      </form>

      <div className={styles.links}>
        <a href={loginHref}>{dict.recuperar.volverAAccederEnlace}</a>
      </div>
    </div>
  )
}
