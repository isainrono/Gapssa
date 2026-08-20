import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { normalizeEmail } from '@gapssa/contracts'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { sendMail } from '@/server/auth/mailer'
import { requestOtp } from '@/server/auth/otpService'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { findAccountByEmail, replacePendingPasswordResetRequest } from '@/server/auth/repository'
import { serverEnv } from '@/server/env'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
})

const GENERIC_RESPONSE = {
  message: 'Si el correo está registrado, te hemos enviado instrucciones para recuperar el acceso.',
}

/**
 * Recuperación de contraseña — misma respuesta exista o no la cuenta
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6.2). Revisión 2 de Fase 3:
 * `replacePendingPasswordResetRequest` sustituye de forma explícita
 * cualquier solicitud `pending` anterior por la nueva (antes se
 * acumulaban filas `pending` indistinguibles cada vez que se pedía
 * recuperar sin completar el flujo) — puede llamarse tantas veces como
 * haga falta (p. ej. si el primer correo nunca llegó) sin dejar rastro
 * ambiguo de cuál es la solicitud vigente.
 */
export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(
    `password-forgot:ip:${ip}`,
    serverEnv.OTP_REQUEST_MAX_PER_IP_PER_HOUR,
    3600,
  )
  if (!ipLimit.allowed) {
    return errorResponse(429, 'rate_limited', 'Demasiadas solicitudes desde este origen. Inténtalo más tarde.')
  }

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const normalizedEmail = normalizeEmail(parsed.data.email)
  const account = await findAccountByEmail(normalizedEmail)

  if (account) {
    const otpResult = await requestOtp('password_reset', account.id)
    if (otpResult.outcome === 'issued') {
      await replacePendingPasswordResetRequest({
        accountId: account.id,
        otpChallengeId: otpResult.challengeId,
        expiresAt: new Date(otpResult.expiresAt),
        idempotencyKey: randomUUID(),
      })
      await sendMail({
        to: normalizedEmail,
        subject: 'Recupera tu acceso — GAPSSA',
        text: `Tu código para restablecer la contraseña es: ${otpResult.code}\n\nCaduca en ${serverEnv.OTP_TTL_MINUTES} minutos. Si no has solicitado esto, ignora este correo.`,
      })
    }
  }

  return jsonResponse(GENERIC_RESPONSE, { status: 202 })
}
