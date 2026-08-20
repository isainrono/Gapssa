'use client'

import { useEffect, useId, useState, type FormEvent } from 'react'

import type { Dictionary } from '@/lib/i18n/dictionary'
import { authFetch } from '@/lib/auth/authFetch'

import styles from '../auth/AuthForm.module.css'

type Props = {
  dict: Dictionary['reservar']
  isAuthenticated: boolean
}

interface Treatment {
  id: string
  name: string
  durationMinutes: number
  familia: string
}

interface Slot {
  startAt: string
  endAt: string
  treatmentId: string
  professionalId: string
  zoneId: string
}

type Step = 'search' | 'slots' | 'details' | 'otp' | 'success'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
}

function mapErrorCode(code: string, dict: Dictionary['reservar']): string {
  switch (code) {
    case 'treatment_not_found':
      return dict.errorTratamientoNoEncontrado
    case 'invalid_date':
    case 'invalid_start_time':
      return dict.errorFechaInvalida
    case 'lead_time_violation':
      return dict.errorAntelacionMinima
    case 'horizon_violation':
      return dict.errorHorizonteMaximo
    case 'slot_unavailable':
      return dict.errorHorarioNoDisponible
    case 'too_many_pending_requests':
      return dict.errorDemasiadasSolicitudes
    case 'invalid_code':
      return dict.errorCodigoIncorrecto
    case 'account_not_active':
      return dict.errorCuentaNoActiva
    default:
      return dict.errorTratamientoNoEncontrado
  }
}

/**
 * Interfaz mínima de reserva — encargo de Fase 4A, punto 9. Un único
 * componente cliente con una pequeña máquina de estados
 * (`search -> slots -> details -> otp? -> success`), sin panel de
 * administración: solo el camino del cliente (invitado o autenticado).
 * `isAuthenticated` decide el endpoint (`/requests` + verificación por
 * OTP para invitado, `/requests/authenticated`, síncrono, para sesión
 * activa) — la lógica de negocio en sí vive enteramente en el servidor
 * (`server/booking/*`), este componente solo la invoca.
 */
export function BookingWizard({ dict, isAuthenticated }: Props) {
  const treatmentId = useId()
  const dateId = useId()
  const nameId = useId()
  const lastNameId = useId()
  const phoneId = useId()
  const emailId = useId()
  const codeId = useId()

  const [step, setStep] = useState<Step>('search')
  const [treatments, setTreatments] = useState<Treatment[] | null>(null)
  const [selectedTreatmentId, setSelectedTreatmentId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  const [requestId, setRequestId] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/booking/v1/treatments')
      .then((response) => response.json())
      .then((body: { treatments: Treatment[] }) => {
        if (!cancelled) setTreatments(body.treatments)
      })
      .catch(() => {
        if (!cancelled) setTreatments([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ treatmentId: selectedTreatmentId, date })
    const response = await fetch(`/api/booking/v1/availability?${params.toString()}`)
    const body = (await response.json().catch(() => ({}))) as { slots?: Slot[]; error?: { code: string } }

    setLoading(false)

    if (!response.ok) {
      setError(mapErrorCode(body.error?.code ?? '', dict))
      return
    }

    setSlots(body.slots ?? [])
    setStep('slots')
  }

  function handleChooseSlot(slot: Slot) {
    setSelectedSlot(slot)
    setStep('details')
  }

  async function handleSubmitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSlot) return
    setLoading(true)
    setError(null)

    const idempotencyKey = crypto.randomUUID()

    if (isAuthenticated) {
      const result = await authFetch<{ requestId: string; meetingId: string }>('/api/booking/v1/requests/authenticated', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          treatmentId: selectedSlot.treatmentId,
          professionalId: selectedSlot.professionalId,
          zoneId: selectedSlot.zoneId,
          startAt: selectedSlot.startAt,
          contact: { firstName, lastName, phone },
        }),
      })
      setLoading(false)
      if (!result.ok) {
        setError(mapErrorCode(result.error.code, dict))
        return
      }
      setRequestId(result.data.requestId)
      setStep('success')
      return
    }

    const result = await authFetch<{ requestId: string; accessToken: string }>('/api/booking/v1/requests', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey,
        treatmentId: selectedSlot.treatmentId,
        professionalId: selectedSlot.professionalId,
        zoneId: selectedSlot.zoneId,
        startAt: selectedSlot.startAt,
        guest: { firstName, lastName, phone, email },
      }),
    })
    setLoading(false)
    if (!result.ok) {
      setError(mapErrorCode(result.error.code, dict))
      return
    }
    setRequestId(result.data.requestId)
    setAccessToken(result.data.accessToken)
    setStep('otp')
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!requestId || !accessToken) return
    setLoading(true)
    setError(null)

    const result = await authFetch(`/api/booking/v1/requests/${requestId}/verify`, {
      method: 'POST',
      headers: { 'x-booking-access-token': accessToken },
      body: JSON.stringify({ code }),
    })
    setLoading(false)
    if (!result.ok) {
      setError(mapErrorCode(result.error.code, dict))
      return
    }
    setStep('success')
  }

  if (step === 'success') {
    return (
      <div className={styles.wrapper}>
        <h1 className={styles.title}>{dict.exitoTitulo}</h1>
        <p className={styles.alertSuccess} role="status">
          {dict.exitoMensaje}
        </p>
      </div>
    )
  }

  if (step === 'otp') {
    return (
      <div className={styles.wrapper}>
        <h1 className={styles.title}>{dict.pasoCodigo}</h1>
        <p>{dict.codigoIntro}</p>
        <form className={styles.form} onSubmit={handleVerify} noValidate>
          {error && (
            <p className={styles.alertError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={codeId}>
              {dict.codigoLabel}
            </label>
            <input
              id={codeId}
              className={styles.input}
              type="text"
              inputMode="numeric"
              required
              minLength={4}
              maxLength={12}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? dict.confirmando : dict.confirmarBoton}
          </button>
        </form>
      </div>
    )
  }

  if (step === 'details' && selectedSlot) {
    return (
      <div className={styles.wrapper}>
        <h1 className={styles.title}>{dict.pasoDatos}</h1>
        {isAuthenticated && (
          <p className={styles.alertSuccess} role="status">
            {dict.sesionAviso}
          </p>
        )}
        <form className={styles.form} onSubmit={handleSubmitDetails} noValidate>
          {error && (
            <p className={styles.alertError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={nameId}>
              {dict.nombreLabel}
            </label>
            <input
              id={nameId}
              className={styles.input}
              type="text"
              required
              maxLength={100}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={lastNameId}>
              {dict.apellidosLabel}
            </label>
            <input
              id={lastNameId}
              className={styles.input}
              type="text"
              required
              maxLength={100}
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={phoneId}>
              {dict.telefonoLabel}
            </label>
            <input
              id={phoneId}
              className={styles.input}
              type="tel"
              required
              maxLength={20}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          {!isAuthenticated && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor={emailId}>
                {dict.correoLabel}
              </label>
              <input
                id={emailId}
                className={styles.input}
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          )}
          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? dict.enviando : dict.enviarSolicitudBoton}
          </button>
        </form>
      </div>
    )
  }

  if (step === 'slots') {
    return (
      <div className={styles.wrapper}>
        <h1 className={styles.title}>{dict.pasoHorario}</h1>
        {error && (
          <p className={styles.alertError} role="alert">
            {error}
          </p>
        )}
        {slots.length === 0 ? (
          <p>{dict.sinHuecos}</p>
        ) : (
          <ul className={styles.links} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', listStyle: 'none', padding: 0 }}>
            {slots.map((slot) => (
              <li key={`${slot.startAt}-${slot.professionalId}-${slot.zoneId}`}>
                <button type="button" className={styles.submit} onClick={() => handleChooseSlot(slot)}>
                  {formatTime(slot.startAt)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.links}>
          <button type="button" className={styles.input} onClick={() => setStep('search')}>
            {dict.volverBoton}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>{dict.titulo}</h1>
      <p>{dict.aviso}</p>
      <form className={styles.form} onSubmit={handleSearch} noValidate>
        {error && (
          <p className={styles.alertError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={treatmentId}>
            {dict.tratamientoLabel}
          </label>
          <select
            id={treatmentId}
            className={styles.input}
            required
            value={selectedTreatmentId}
            onChange={(event) => setSelectedTreatmentId(event.target.value)}
          >
            <option value="" disabled>
              {dict.tratamientoLabel}
            </option>
            {(treatments ?? []).map((treatment) => (
              <option key={treatment.id} value={treatment.id}>
                {treatment.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={dateId}>
            {dict.fechaLabel}
          </label>
          <input
            id={dateId}
            className={styles.input}
            type="date"
            required
            min={todayIso()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <button className={styles.submit} type="submit" disabled={loading || !selectedTreatmentId}>
          {loading ? dict.buscando : dict.buscarBoton}
        </button>
      </form>
    </div>
  )
}
