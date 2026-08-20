import 'server-only'

import { serverEnv } from '../env'
import { sendMail } from './mailer'
import { requestOtp } from './otpService'
import { replacePendingEmailVerificationRequest } from './repository'

/**
 * Emite (o reemite) un código de verificación de correo para una cuenta
 * `pending_verification` — compartido por el registro inicial (cuando la
 * cuenta acaba de crearse, o cuando se reintenta registrar un correo que
 * ya está `pending_verification`) y por el reenvío explícito
 * (`POST /api/auth/verify-email/resend`). Antes de esta revisión, ninguna
 * ruta permitía reemitir un código para una cuenta que ya existía: un
 * fallo de SMTP, un TTL vencido o una pérdida de Redis dejaban la cuenta
 * sin forma de avanzar.
 */

export type IssueEmailVerificationOutcome = 'issued' | 'rate_limited'

export async function issueEmailVerificationChallenge(
  accountId: string,
  email: string,
): Promise<IssueEmailVerificationOutcome> {
  const otpResult = await requestOtp('account_email_verification', accountId)
  if (otpResult.outcome === 'rate_limited') {
    return 'rate_limited'
  }

  await replacePendingEmailVerificationRequest({
    accountId,
    otpChallengeId: otpResult.challengeId,
    expiresAt: new Date(otpResult.expiresAt),
  })

  await sendMail({
    to: email,
    subject: 'Verifica tu correo — GAPSSA',
    text: `Tu código de verificación es: ${otpResult.code}\n\nCaduca en ${serverEnv.OTP_TTL_MINUTES} minutos.`,
  })

  return 'issued'
}
