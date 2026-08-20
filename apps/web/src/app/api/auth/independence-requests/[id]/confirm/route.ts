import { z } from 'zod'

import { verifyCsrfToken } from '@/server/auth/csrf'
import { errorResponse, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { verifyOtp } from '@/server/auth/otpService'
import { completeIndependenceRequest, findIndependenceRequestById } from '@/server/auth/repository'
import { getActiveSessionFromCookies } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  code: z.string().min(4).max(12),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const session = await getActiveSessionFromCookies()
  if (!session) {
    return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.')
  }

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.success) {
    return parsed.response
  }

  const { id } = await params
  const independenceRequest = await findIndependenceRequestById(id)

  if (!independenceRequest || independenceRequest.minorAccountId !== session.accountId) {
    return errorResponse(404, 'not_found', 'Solicitud no encontrada.')
  }
  // Revisión 3 de Fase 3: ya no se rechaza aquí una solicitud que no esté
  // `pending` — `completeIndependenceRequest` (repository.ts) reconcilia de
  // forma segura una solicitud `confirmed` cuya cuenta quedó `pending` por
  // un fallo de infraestructura de la versión anterior (dos transacciones
  // separadas), y sigue siendo idempotente si ya se concedió del todo.

  const result = await verifyOtp('independence_confirmation', session.accountId, parsed.data.code)

  if (result.outcome === 'invalid_code') {
    return errorResponse(400, 'invalid_code', 'Código incorrecto, caducado o ya utilizado.')
  }
  if (result.outcome === 'locked') {
    return errorResponse(429, 'locked', 'Demasiados intentos. Solicita un código nuevo más tarde.')
  }
  if (result.outcome === 'already_consumed' && !result.codeMatchesConsumedChallenge) {
    return errorResponse(400, 'already_consumed', 'Este código ya se utilizó. Solicita uno nuevo.')
  }
  if (result.outcome !== 'verified' && result.outcome !== 'already_consumed') {
    return errorResponse(400, 'expired', 'El código ha caducado. Solicita uno nuevo.')
  }

  // Aquí `result.outcome` es 'verified', o 'already_consumed' con el código
  // correcto (recuperación tras un fallo de infraestructura entre consumir
  // el OTP y completar la transacción) — en ambos casos `result.challengeId`
  // identifica el reto exacto que se validó.
  const outcome = await completeIndependenceRequest(id, session.accountId, result.challengeId, new Date())

  // La auditoría (`ClientAccount.independenceStatus` + `IndependenceRequest`
  // event) ya se confirmó atómicamente con la concesión dentro de
  // completeIndependenceRequest (repository.ts, revisión 4 de Fase 3) — no
  // se audita aquí, después del commit, ni en la rama 'already_granted'
  // (idempotente, no hay nada nuevo que auditar).
  switch (outcome) {
    case 'granted':
    case 'already_granted':
      return jsonResponse({ status: 'granted' })
    case 'not_eligible':
      return errorResponse(
        403,
        'not_eligible',
        'No cumples las condiciones para completar la independencia de la cuenta.',
      )
    case 'challenge_mismatch':
      return errorResponse(400, 'invalid_code', 'Código incorrecto, caducado o ya utilizado.')
    case 'request_not_found':
    default:
      return errorResponse(404, 'not_found', 'Solicitud no encontrada.')
  }
}
