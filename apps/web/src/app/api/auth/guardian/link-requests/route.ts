import { z } from 'zod'

import { normalizeEmail } from '@gapssa/contracts'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { listGuardianLinksForGuardian, listGuardianLinksForMinor, requestGuardianLink } from '@/server/auth/guardian'
import { errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { sendMail } from '@/server/auth/mailer'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { getActiveSessionFromCookies } from '@/server/auth/session'
import { serverEnv } from '@/server/env'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  minorEmail: z.string().trim().toLowerCase().email().max(254),
})

/** Vínculos donde la cuenta autenticada es tutor o menor — para mostrarlos en `/mi-cuenta`. */
export async function GET() {
  const session = await getActiveSessionFromCookies()
  if (!session) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const [asGuardian, asMinor] = await Promise.all([
    listGuardianLinksForGuardian(session.accountId),
    listGuardianLinksForMinor(session.accountId),
  ])

  const toDto = (link: Awaited<ReturnType<typeof listGuardianLinksForGuardian>>[number]) => ({
    id: link.id,
    guardianAccountId: link.guardianAccountId,
    minorAccountId: link.minorAccountId,
    status: link.status,
    createdAt: link.createdAt.toISOString(),
    confirmedAt: link.confirmedAt ? link.confirmedAt.toISOString() : null,
  })

  return jsonResponse({
    asGuardian: asGuardian.map(toDto),
    asMinor: asMinor.map(toDto),
  })
}

/**
 * Un tutor autenticado solicita vincularse a la cuenta de un menor por su
 * correo. Nunca vincula automáticamente — el menor debe confirmar desde
 * su propia cuenta (`PLAN_DESARROLLO_WEB_PORTAL.md` §10). A diferencia de
 * registro/login, esta ruta exige sesión ya autenticada: la protección
 * contra enumeración de registro/login existe para proteger a
 * desconocidos anónimos, no aplica de la misma forma a una acción que ya
 * exige identidad probada — aun así, limitada por frecuencia para evitar
 * abuso de barrido de correos, y `requestGuardianLink` (guardian.ts)
 * colapsa "no existe", "no es menor" y "no está activo/verificado" en un
 * único resultado genérico (`invalid_target`) para no dejar que un tutor
 * ya autenticado use este endpoint como oráculo de edad/estado de un
 * correo cualquiera (revisión 2 de Fase 3).
 */
export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const guardianSession = await getActiveSessionFromCookies()
  if (!guardianSession) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(`guardian-link:ip:${ip}`, serverEnv.OTP_REQUEST_MAX_PER_IP_PER_HOUR, 3600)
  if (!ipLimit.allowed) {
    return errorResponse(429, 'rate_limited', 'Demasiadas solicitudes desde este origen. Inténtalo más tarde.')
  }

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const minorEmail = normalizeEmail(parsed.data.minorEmail)
  const outcome = await requestGuardianLink(guardianSession.accountId, minorEmail, new Date())

  switch (outcome.outcome) {
    case 'created':
      // La auditoría ya se confirmó atómicamente con la creación del
      // vínculo dentro de requestGuardianLink (guardian.ts, revisión 4 de
      // Fase 3) — el envío del correo se queda aquí, fuera de esa
      // transacción: un fallo de SMTP no debe revertir un vínculo ya
      // persistido.
      await sendMail({
        to: minorEmail,
        subject: 'Solicitud de vínculo con un tutor — GAPSSA',
        text: 'Alguien ha solicitado vincularse como tutor/a de tu cuenta en el portal de GAPSSA. Inicia sesión en tu cuenta para revisar y confirmar (o ignorar) esta solicitud.',
      })
      return jsonResponse({ status: 'pending_minor_confirmation' }, { status: 201 })
    case 'max_guardians_reached':
      return errorResponse(409, 'max_guardians_reached', 'Este menor ya tiene el máximo de dos tutores.')
    case 'duplicate_link':
      return errorResponse(409, 'duplicate_link', 'Ya existe una solicitud o vínculo activo con este menor.')
    case 'self_link_not_allowed':
      return errorResponse(400, 'self_link_not_allowed', 'No puedes vincularte a tu propia cuenta.')
    case 'requester_not_eligible':
      return errorResponse(
        403,
        'requester_not_eligible',
        'Tu cuenta debe ser adulta, estar activa y con el correo verificado para solicitar un vínculo de tutela.',
      )
    case 'invalid_target':
      return errorResponse(
        400,
        'invalid_guardian_link_request',
        'No se puede completar la solicitud de vínculo con esa cuenta.',
      )
  }
}
