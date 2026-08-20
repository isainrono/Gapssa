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
      return dict.restablecer.errorCodigo
    case 'weak_password':
      return dict.restablecer.errorContrasenaDebil
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

export function ResetPasswordForm({ dict, loginHref, initialEmail }: Props) {
  const emailId = useId()
  const codeId = useId()
  const passwordId = useId()

  const [email, setEmail] = useState(initialEmail ?? '')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await authFetch('/api/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword }),
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
        <h1 className={styles.title}>{dict.restablecer.titulo}</h1>
        <p className={styles.alertSuccess} role="status">
          {dict.restablecer.exitoMensaje}
        </p>
        <div className={styles.links}>
          <a href={loginHref}>{dict.acceder.titulo}</a>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>{dict.restablecer.titulo}</h1>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {error && (
          <p className={styles.alertError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={emailId}>
            {dict.restablecer.correoLabel}
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
            {dict.restablecer.codigoLabel}
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
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={passwordId}>
            {dict.restablecer.nuevaContrasenaLabel}
          </label>
          <input
            id={passwordId}
            className={styles.input}
            type="password"
            name="new-password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <button className={styles.submit} type="submit" disabled={submitting}>
          {dict.restablecer.guardarBoton}
        </button>
      </form>
    </div>
  )
}
