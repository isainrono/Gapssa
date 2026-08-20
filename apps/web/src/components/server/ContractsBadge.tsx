import { GUEST_VERIFICATION_HOLD_MINUTES, APPROVAL_HOLD_HOURS } from '@gapssa/contracts'

/**
 * Componente de servidor (sin 'use client'): demuestra la importación real
 * de @gapssa/contracts desde apps/web (Fase 1, punto 8). No representa
 * ningún flujo de reserva real todavía — solo prueba que el workspace se
 * resuelve y transpila correctamente desde Next.js.
 */
export function ContractsBadge() {
  return (
    <p data-testid="contracts-badge">
      @gapssa/contracts cargado: retención de invitado {GUEST_VERIFICATION_HOLD_MINUTES} min,
      bloqueo de aprobación {APPROVAL_HOLD_HOURS} h.
    </p>
  )
}
