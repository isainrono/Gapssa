'use client'

import { useState } from 'react'

/**
 * Componente de cliente (interactivo: usa useState y un manejador de
 * evento, por eso lleva 'use client'). Llama al health check propio de
 * apps/web (`/api/health`), nunca a un sistema interno directamente —
 * esa es la separación que exige la Fase 1: el navegador solo habla con
 * el BFF de Next.js.
 */
export function HealthCheckButton() {
  const [result, setResult] = useState<string | null>(null)

  async function check() {
    setResult('Comprobando…')
    const response = await fetch('/api/health')
    const body = (await response.json()) as { status: string }
    setResult(`${response.status} ${body.status}`)
  }

  return (
    <div>
      <button type="button" onClick={check}>
        Comprobar /api/health
      </button>
      {result ? <p data-testid="health-check-result">{result}</p> : null}
    </div>
  )
}
