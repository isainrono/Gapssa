import { isEligibleForIndependenceRequest } from '@gapssa/contracts'
import { recordEventAuditEvent, recordRawAuditEvent } from '@/server/auth/audit'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { listGuardianLinksForMinor } from '@/server/auth/guardian'
import { errorResponse, getClientIp, jsonResponse } from '@/server/auth/httpHelpers'
import { sendMail } from '@/server/auth/mailer'
import { requestOtp } from '@/server/auth/otpService'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { createIndependenceRequest, findAccountById, setAccountIndependenceStatusIf } from '@/server/auth/repository'
import { getActiveSessionFromCookies } from '@/server/auth/session'
import { serverEnv } from '@/server/env'

export const dynamic = 'force-dynamic'

/**
 * Solo el propio joven puede solicitar su independencia — nunca el tutor
 * ni un tercero (`PLAN_DESARROLLO_WEB_PORTAL.md` §10: "requiere
 * confirmación e identidad verificada" del propio joven).
 */
export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const session = await getActiveSessionFromCookies()
  if (!session) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(`independence-request:ip:${ip}`, serverEnv.OTP_REQUEST_MAX_PER_IP_PER_HOUR, 3600)
  if (!ipLimit.allowed) {
    return errorResponse(429, 'rate_limited', 'Demasiadas solicitudes desde este origen. Inténtalo más tarde.')
  }

  const account = await findAccountById(session.accountId)
  if (!account) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const guardianLinks = await listGuardianLinksForMinor(account.id)
  const eligible = isEligibleForIndependenceRequest(
    {
      dateOfBirth: account.dateOfBirth,
      hasAnyGuardianLink: guardianLinks.length > 0,
      independenceStatus: account.independenceStatus,
    },
    new Date(),
  )

  if (!eligible) {
    return errorResponse(403, 'not_eligible', 'No cumples las condiciones para solicitar la independencia de la cuenta.')
  }

  const otpResult = await requestOtp('independence_confirmation', account.id)
  if (otpResult.outcome === 'rate_limited') {
    return errorResponse(429, 'rate_limited', 'Demasiadas solicitudes. Inténtalo más tarde.')
  }

  const request_ = await createIndependenceRequest({
    minorAccountId: account.id,
    otpChallengeId: otpResult.challengeId,
  })

  const transitioned = await setAccountIndependenceStatusIf(account.id, 'not_applicable', 'pending')
  if (transitioned) {
    await recordRawAuditEvent({
      entity: 'ClientAccount',
      entityId: account.id,
      field: 'independenceStatus',
      previousValue: 'not_applicable',
      newValue: 'pending',
      actor: { type: 'user', id: account.id },
      channel: 'web',
      occurredAt: new Date().toISOString(),
      reasonCode: 'IndependenceRequested',
    })
  }

  await recordEventAuditEvent({
    entity: 'IndependenceRequest',
    entityId: request_.id,
    actor: { type: 'user', id: account.id },
    channel: 'web',
    occurredAt: new Date().toISOString(),
    reasonCode: 'IndependenceRequested',
  })

  await sendMail({
    to: account.email,
    subject: 'Confirma tu independencia de cuenta — GAPSSA',
    text: `Tu código de confirmación es: ${otpResult.code}\n\nCaduca en ${serverEnv.OTP_TTL_MINUTES} minutos.`,
  })

  return jsonResponse({ requestId: request_.id }, { status: 202 })
}
