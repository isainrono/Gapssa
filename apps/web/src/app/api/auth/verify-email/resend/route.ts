import { z } from 'zod'

import { normalizeEmail } from '@gapssa/contracts'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { issueEmailVerificationChallenge } from '@/server/auth/emailVerification'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { findAccountByEmail } from '@/server/auth/repository'
import { serverEnv } from '@/server/env'

export const dynamic = 'force-dynamic'

/**
 * Reenvío del código de verificación de correo — revisión 2 de Fase 3.
 * Recuperación explícita para una cuenta `pending_verification` cuyo
 * primer código nunca llegó (fallo SMTP), caducó, o se perdió (Redis se
 * reinició o se sobrescribió el puntero). Antes de esta revisión no
 * existía ninguna ruta para esto: la única forma "accidental" de
 * conseguirlo era volver a enviar `POST /api/auth/register`, que ahora
 * también reemite (`register/route.ts`) — este endpoint es la vía
 * explícita, pensada para un botón "reenviar código" en la propia pantalla
 * de verificación.
 *
 * Respuesta genérica exista o no la cuenta, y también si existe pero ya
 * está activa o suspendida: solo se emite un reto nuevo para cuentas
 * realmente `pending_verification`, y la respuesta nunca revela en cuál
 * de los casos se está — no se puede usar para enumerar cuentas ni su
 * estado. Limitado por IP aquí; `issueEmailVerificationChallenge` aplica
 * además el límite por sujeto ya existente de `requestOtp`
 * (`OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR`).
 */

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
})

const GENERIC_RESPONSE = {
  message: 'Si la cuenta existe y sigue pendiente de verificación, hemos enviado un nuevo código.',
}

export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(
    `verify-email-resend:ip:${ip}`,
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

  if (account && account.status === 'pending_verification') {
    await issueEmailVerificationChallenge(account.id, normalizedEmail)
  }

  return jsonResponse(GENERIC_RESPONSE, { status: 202 })
}
