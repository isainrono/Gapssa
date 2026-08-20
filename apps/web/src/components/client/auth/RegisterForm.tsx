'use client'

import { useId, useState, type FormEvent } from 'react'

import type { Dictionary } from '@/lib/i18n/dictionary'
import type { Locale } from '@/lib/i18n/locales'
import { authFetch } from '@/lib/auth/authFetch'

import styles from './AuthForm.module.css'

type Props = {
  dict: Dictionary['miCuenta']
  locale: Locale
  loginHref: string
}

function mapErrorCode(code: string, dict: Dictionary['miCuenta']): string {
  switch (code) {
    case 'weak_password':
      return dict.registro.errorContrasenaDebil
    case 'invalid_date_of_birth':
      return dict.registro.errorFechaInvalida
    case 'rate_limited':
      return dict.common.errorLimite
    case 'csrf_invalid':
      return dict.common.errorCsrf
    default:
      return dict.common.errorGenerico
  }
}

export function RegisterForm({ dict, locale, loginHref }: Props) {
  const emailId = useId()
  const passwordId = useId()
  const dobId = useId()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await authFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, dateOfBirth, locale }),
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
        <h1 className={styles.title}>{dict.registro.exitoTitulo}</h1>
        <p className={styles.alertSuccess} role="status">
          {dict.registro.exitoMensaje}
        </p>
        <div className={styles.links}>
          <a href={loginHref}>{dict.registro.iniciarSesionEnlace}</a>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>{dict.registro.titulo}</h1>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {error && (
          <p className={styles.alertError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={emailId}>
            {dict.registro.correoLabel}
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
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={passwordId}>
            {dict.registro.contrasenaLabel}
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={`${passwordId}-hint`}
          />
          <span id={`${passwordId}-hint`} className={styles.hint}>
            {dict.registro.contrasenaAyuda}
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={dobId}>
            {dict.registro.fechaNacimientoLabel}
          </label>
          <input
            id={dobId}
            className={styles.input}
            type="date"
            name="bday"
            autoComplete="bday"
            required
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
          />
        </div>

        <button className={styles.submit} type="submit" disabled={submitting}>
          {dict.registro.enviarBoton}
        </button>
      </form>

      <div className={styles.links}>
        <span>{dict.registro.yaTienesCuenta}</span> <a href={loginHref}>{dict.registro.iniciarSesionEnlace}</a>
      </div>
    </div>
  )
}
