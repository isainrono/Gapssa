import { z } from 'zod'
import { NextResponse } from 'next/server'

import { normalizeEmail } from '@gapssa/contracts'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { SimulatedEspoLinkAdapter } from '@/server/auth/espoLink'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { processEvaluateEspoLinkJobForAccount } from '@/server/auth/outbox'
import { verifyOtp } from '@/server/auth/otpService'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { completeEmailVerification, findAccountByEmail } from '@/server/auth/repository'
import { serverEnv } from '@/server/env'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  code: z.string().min(4).max(12),
})

/**
 * Procesa (best-effort) el trabajo `evaluate_espo_link` pendiente de la
 * cuenta — nunca dentro de la transacción que activa la cuenta
 * (`completeEmailVerification`, repository.ts, ya lo encoló ahí de forma
 * atómica). Un fallo aquí no debe hacer fallar la respuesta de
 * verificación, que ya tuvo éxito y ya se confirmó en Postgres: el job
 * queda `pending`/`failed_retryable` en `outbox_jobs`, recuperable en la
 * siguiente llamada a esta misma ruta (tanto tras una activación nueva como
 * tras la rama idempotente `already_active` — ver más abajo).
 */
async function processPendingEspoLinkJobBestEffort(accountId: string): Promise<void> {
  try {
    await processEvaluateEspoLinkJobForAccount(new SimulatedEspoLinkAdapter(), accountId)
  } catch {
    // No hay nada más que hacer aquí: el job ya persiste su propio estado
    // de reintento en Postgres (outbox.ts). No se registra el error (podría
    // filtrar detalles internos); un reintento posterior lo recoge.
  }
}

/**
 * Activa la cuenta de forma idempotente (`completeEmailVerification` ya es
 * idempotente en sí misma, y desde la revisión 4 también audita y encola el
 * trabajo posterior de vinculación con EspoCRM de forma atómica con la
 * propia activación — ver repository.ts). Se invoca tanto tras un
 * `'verified'` normal como tras la recuperación de un `'already_consumed'`
 * con el código correcto (ver más abajo).
 *
 * Revisión 3 de Fase 3: `invalid_account_state` (cuenta `suspended`/
 * `pending_deletion`/cualquier otro estado no verificable) y
 * `verification_request_not_found` nunca auditan — la transición no ganó.
 * La respuesta HTTP es la misma que "código caducado" en ambos casos: no
 * debe revelar a un tercero que probó un código válido contra una cuenta
 * suspendida o pendiente de eliminación que esa cuenta existe en ese
 * estado.
 */
async function finishVerification(accountId: string, otpChallengeId: string): Promise<NextResponse> {
  const outcome = await completeEmailVerification(accountId, otpChallengeId)

  if (outcome === 'activated' || outcome === 'already_active') {
    await processPendingEspoLinkJobBestEffort(accountId)
    return jsonResponse({ status: 'verified' })
  }

  // invalid_account_state | verification_request_not_found: mismo código y
  // mensaje que un reto caducado — no enumeración del estado real de la
  // cuenta.
  return errorResponse(400, 'expired', 'El código ha caducado. Solicita uno nuevo.')
}

export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(
    `otp-verify:ip:${ip}`,
    serverEnv.AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR,
    3600,
  )
  if (!ipLimit.allowed) {
    return errorResponse(429, 'rate_limited', 'Demasiados intentos desde este origen. Inténtalo más tarde.')
  }

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const normalizedEmail = normalizeEmail(parsed.data.email)
  const account = await findAccountByEmail(normalizedEmail)

  if (!account) {
    // Mismo código/mensaje que devolvería una cuenta real sin ningún reto
    // activo (verifyOtp -> "expired" cuando no hay puntero en Redis) — la
    // vía más común al probar un correo desconocido. Usar aquí un código
    // distinto (p. ej. "invalid_code") sería, en sí mismo, una forma de
    // enumeración: permitiría distinguir "no existe la cuenta" de "existe
    // pero no hay verificación en curso" por el propio código de error.
    return errorResponse(400, 'expired', 'El código ha caducado. Solicita uno nuevo.')
  }

  const result = await verifyOtp('account_email_verification', account.id, parsed.data.code)

  switch (result.outcome) {
    case 'verified':
      return finishVerification(account.id, result.challengeId)
    case 'already_consumed': {
      if (!result.codeMatchesConsumedChallenge) {
        // Alguien prueba un código cualquiera contra un reto ya gastado —
        // no demuestra conocer el código real, nunca autoriza nada.
        return errorResponse(400, 'already_consumed', 'Este código ya se utilizó. Solicita uno nuevo.')
      }
      // Recuperación (revisión 2 de Fase 3): el código correcto ya se
      // consumió en Redis en un intento anterior — posiblemente uno que
      // falló al completar la activación en Postgres por un problema de
      // infraestructura entre ambos pasos. Repetir la activación aquí es
      // seguro e idempotente (completeEmailVerification), tanto si ya
      // había terminado (no hace nada) como si se había quedado a medias
      // (la termina ahora). `result.challengeId` (revisión 3) ata la
      // recuperación a la fila concreta de `email_verification_requests`,
      // nunca a "la última solicitud pendiente" de la cuenta.
      return finishVerification(account.id, result.challengeId)
    }
    case 'invalid_code':
      return errorResponse(400, 'invalid_code', 'Código incorrecto, caducado o ya utilizado.')
    case 'locked':
      return errorResponse(429, 'locked', 'Demasiados intentos. Solicita un código nuevo más tarde.')
    case 'expired':
    default:
      return errorResponse(400, 'expired', 'El código ha caducado. Solicita uno nuevo.')
  }
}
