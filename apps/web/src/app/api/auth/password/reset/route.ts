import { z } from 'zod'
import { NextResponse } from 'next/server'

import { normalizeEmail, PASSWORD_MIN_LENGTH } from '@gapssa/contracts'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { verifyOtp } from '@/server/auth/otpService'
import { hashPassword, isPasswordStrongEnough } from '@/server/auth/password'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { completePasswordReset, findAccountByEmail } from '@/server/auth/repository'
import { serverEnv } from '@/server/env'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  code: z.string().min(4).max(12),
  newPassword: z.string().min(1).max(256),
})

/**
 * Completa el restablecimiento de forma idempotente. Desde la revisión 5
 * de Fase 3, `completePasswordReset` (repository.ts) hace todo en una
 * única transacción — rotación de credencial, consumo de la solicitud
 * exacta (`otpChallengeId`), revocación de TODAS las sesiones existentes
 * (no hay "sesión desde la que se hizo el cambio" que conservar, este
 * flujo nunca requiere sesión previa) y la auditoría de cada paso — nunca
 * pasos sueltos después del commit.
 *
 * Revisión de cierre de Fase 3: antes, esta función ignoraba el resultado
 * de `completePasswordReset` y devolvía `{status:'ok'}` sin condición
 * alguna — un `'request_not_found'` (o el nuevo `'credential_missing'`,
 * ver repository.ts) respondía exactamente igual que una rotación real.
 * Ahora solo `'completed'`/`'already_completed'` (idempotente, la
 * contraseña sí quedó rotada en algún intento) responden éxito; cualquier
 * otro resultado devuelve el mismo error genérico que ya usa el resto de
 * este endpoint para un código caducado — ni confirma un cambio que no
 * ocurrió, ni revela el motivo exacto.
 */
async function finishPasswordReset(accountId: string, otpChallengeId: string, newSecretHash: string): Promise<NextResponse> {
  const outcome = await completePasswordReset(accountId, otpChallengeId, newSecretHash)

  switch (outcome) {
    case 'completed':
    case 'already_completed':
      return jsonResponse({ status: 'ok' })
    case 'request_not_found':
    case 'credential_missing':
    default:
      return errorResponse(400, 'expired', 'El código ha caducado. Solicita uno nuevo.')
  }
}

export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(
    `password-reset:ip:${ip}`,
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

  if (!isPasswordStrongEnough(parsed.data.newPassword)) {
    return errorResponse(
      400,
      'weak_password',
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres e incluir letras, números y un símbolo.`,
    )
  }

  const normalizedEmail = normalizeEmail(parsed.data.email)
  const account = await findAccountByEmail(normalizedEmail)

  if (!account) {
    // Mismo código/mensaje que una cuenta real sin ninguna solicitud de
    // recuperación activa (verifyOtp -> "expired") — ver el mismo
    // razonamiento en verify-email/route.ts.
    return errorResponse(400, 'expired', 'El código ha caducado. Solicita uno nuevo.')
  }

  const result = await verifyOtp('password_reset', account.id, parsed.data.code)

  switch (result.outcome) {
    case 'verified':
      return finishPasswordReset(account.id, result.challengeId, await hashPassword(parsed.data.newPassword))
    case 'already_consumed': {
      if (!result.codeMatchesConsumedChallenge) {
        return errorResponse(400, 'already_consumed', 'Este código ya se utilizó. Solicita uno nuevo.')
      }
      // Recuperación (revisión 2 de Fase 3): el código correcto ya se
      // consumió en Redis en un intento anterior que pudo no haber
      // completado la rotación de la contraseña en Postgres (fallo de
      // infraestructura entre ambos pasos). Repetir aquí es seguro e
      // idempotente (completePasswordReset).
      return finishPasswordReset(account.id, result.challengeId, await hashPassword(parsed.data.newPassword))
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
