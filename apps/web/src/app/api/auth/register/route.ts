import { z } from 'zod'

import { isValidDateOfBirth, normalizeEmail, PASSWORD_MIN_LENGTH } from '@gapssa/contracts'
import { isLocale } from '@/lib/i18n/locales'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { isUniqueViolation } from '@/server/auth/dbErrors'
import { issueEmailVerificationChallenge } from '@/server/auth/emailVerification'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { sendMail } from '@/server/auth/mailer'
import { hashPassword, isPasswordStrongEnough } from '@/server/auth/password'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { createAccountWithPasswordCredential, findAccountByEmail } from '@/server/auth/repository'
import { serverEnv } from '@/server/env'

export const dynamic = 'force-dynamic'

/**
 * Registro con correo (`PLAN_DESARROLLO_WEB_PORTAL.md` §6.1). Respuesta
 * **idéntica** exista o no ya una cuenta con ese correo — no permite
 * enumerar cuentas registradas (§6.2). Si ya existe y está activa, se
 * envía un aviso a esa dirección (nunca a quien hizo la petición, que
 * puede no ser el dueño del correo). Si ya existe pero sigue
 * `pending_verification` (revisión 2 de Fase 3: máquina de estados
 * recuperable), se trata como la ruta natural de recuperación y se
 * reemite un código de verificación — antes de esta revisión no existía
 * ninguna forma de recuperar una cuenta atascada en ese estado.
 */

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD'),
  locale: z.string(),
})

const GENERIC_RESPONSE = {
  message: 'Si los datos son válidos, hemos enviado un correo con instrucciones para continuar.',
}

export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(
    `register:ip:${ip}`,
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
  const { email, password, dateOfBirth, locale } = parsed.data

  if (!isLocale(locale)) {
    return errorResponse(400, 'invalid_locale', 'Idioma no soportado.')
  }

  if (!isPasswordStrongEnough(password)) {
    return errorResponse(
      400,
      'weak_password',
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres e incluir letras, números y un símbolo.`,
    )
  }

  if (!isValidDateOfBirth(dateOfBirth, new Date())) {
    return errorResponse(400, 'invalid_date_of_birth', 'Fecha de nacimiento no válida.')
  }

  const normalizedEmail = normalizeEmail(email)

  const existing = await findAccountByEmail(normalizedEmail)
  if (existing) {
    if (existing.status === 'pending_verification') {
      await issueEmailVerificationChallenge(existing.id, normalizedEmail)
    } else {
      await sendMail({
        to: normalizedEmail,
        subject: 'Ya existe una cuenta con este correo — GAPSSA',
        text: 'Alguien ha intentado registrar una cuenta en el portal de GAPSSA con este correo. Si has sido tú y ya tienes cuenta, inicia sesión o recupera tu acceso desde la web. Si no has sido tú, puedes ignorar este mensaje con tranquilidad.',
      })
    }
    return jsonResponse(GENERIC_RESPONSE, { status: 202 })
  }

  let account
  try {
    account = await createAccountWithPasswordCredential(
      { email: normalizedEmail, dateOfBirth, locale },
      await hashPassword(password),
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Carrera: otra petición concurrente creó la cuenta con el mismo
      // correo entre la comprobación anterior y este insert — se trata
      // igual que "ya existe", sin crear una segunda cuenta ni filtrar
      // que hubo una colisión real. La cuenta y su credencial se crean
      // atómicamente en la otra petición (createAccountWithPasswordCredential),
      // así que no hay riesgo de que esta rama encuentre una cuenta a medias.
      return jsonResponse(GENERIC_RESPONSE, { status: 202 })
    }
    throw error
  }

  await issueEmailVerificationChallenge(account.id, normalizedEmail)

  return jsonResponse(GENERIC_RESPONSE, { status: 202 })
}
