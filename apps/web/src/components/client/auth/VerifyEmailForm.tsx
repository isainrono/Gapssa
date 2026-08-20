'use client'

import { useId, useState, type FormEvent } from 'react'

import type { Dictionary } from '@/lib/i18n/dictionary'
import { authFetch } from '@/lib/auth/authFetch'

import styles from './AuthForm.module.css'

type Props = {
  dict: Dictionary['miCuenta']
  loginHref: string
  initialEmail?: string
}

function mapErrorCode(code: string, dict: Dictionary['miCuenta']): string {
  switch (code) {
    case 'invalid_code':
    case 'already_consumed':
    case 'expired':
      return dict.verificar.errorCodigo
    case 'locked':
      return dict.verificar.errorBloqueado
    case 'rate_limited':
      return dict.common.errorLimite
    case 'csrf_invalid':
      return dict.common.errorCsrf
    default:
      return dict.common.errorGenerico
  }
}

export function VerifyEmailForm({ dict, loginHref, initialEmail }: Props) {
  const emailId = useId()
  const codeId = useId()

  const [email, setEmail] = useState(initialEmail ?? '')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await authFetch('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
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
        <h1 className={styles.title}>{dict.verificar.titulo}</h1>
        <p className={styles.alertSuccess} role="status">
          {dict.verificar.exitoMensaje}
        </p>
        <div className={styles.links}>
          <a href={loginHref}>{dict.verificar.irAAccederEnlace}</a>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>{dict.verificar.titulo}</h1>
      <p className={styles.intro}>{dict.verificar.texto}</p>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {error && (
          <p className={styles.alertError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={emailId}>
            {dict.verificar.correoLabel}
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
          <label className={styles.label} htmlFor={codeId}>
            {dict.verificar.codigoLabel}
          </label>
          <input
            id={codeId}
            className={styles.input}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            minLength={4}
            maxLength={12}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <button className={styles.submit} type="submit" disabled={submitting}>
          {dict.verificar.enviarBoton}
        </button>
      </form>
    </div>
  )
}
