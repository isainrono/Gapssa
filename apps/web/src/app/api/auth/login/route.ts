import { z } from 'zod'

import { hmacSubjectId, normalizeEmail } from '@gapssa/contracts'
import { recordEventAuditEvent } from '@/server/auth/audit'
import { verifyCsrfToken } from '@/server/auth/csrf'
import { CLIENT_IP_UNKNOWN, errorResponse, getClientIp, jsonResponse, parseJsonBody } from '@/server/auth/httpHelpers'
import { getDecoyPasswordHash, verifyPassword } from '@/server/auth/password'
import { consumeRateLimit } from '@/server/auth/rateLimit'
import { findAccountByEmail, findPasswordCredential } from '@/server/auth/repository'
import { createSession } from '@/server/auth/session'
import { serverEnv } from '@/server/env'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
})

/**
 * Función, no una constante a nivel de módulo: un `Response`/`NextResponse`
 * solo puede consumirse una vez — reutilizar la misma instancia entre
 * peticiones concurrentes rompería la segunda petición.
 */
function invalidCredentialsResponse() {
  return errorResponse(401, 'invalid_credentials', 'Correo o contraseña incorrectos.')
}

/**
 * Revisión 2 de Fase 3: un `sha256(email)` sin secreto es un objetivo de
 * diccionario (cualquiera puede precalcular el hash de una lista de
 * correos candidatos) — sustituido por un HMAC con secreto de servidor
 * dedicado (`AUTH_RATE_LIMIT_HMAC_SECRET`, distinto de `OTP_HMAC_SECRET`),
 * dominio propio `"login-subject"` (`packages/contracts/src/security.ts`).
 * El correo en claro nunca es material de la clave de Redis.
 */
async function emailRateLimitKey(email: string): Promise<string> {
  return `login:subject:${await hmacSubjectId('login-subject', email, serverEnv.AUTH_RATE_LIMIT_HMAC_SECRET)}`
}

export async function POST(request: Request) {
  if (!(await verifyCsrfToken(request))) {
    return errorResponse(403, 'csrf_invalid', 'Token CSRF inválido o ausente.')
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(
    `login:ip:${ip}`,
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

  // Límite por correo (existente o no) con la MISMA clave/ventana en
  // ambos casos — si solo se aplicara cuando la cuenta existe, la propia
  // presencia o ausencia del límite delataría si el correo está
  // registrado. `PLAN_DESARROLLO_WEB_PORTAL.md` §6.2: "no revelar si una
  // dirección existe".
  const accountLimit = await consumeRateLimit(
    await emailRateLimitKey(normalizedEmail),
    serverEnv.AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR,
    serverEnv.AUTH_LOGIN_LOCKOUT_MINUTES * 60,
  )
  if (!accountLimit.allowed) {
    // Consulta adicional solo en esta ruta poco frecuente, únicamente
    // para poder auditar contra una cuenta real si existe — no cambia la
    // respuesta (idéntica exista o no la cuenta).
    const accountForAudit = await findAccountByEmail(normalizedEmail)
    if (accountForAudit) {
      await recordEventAuditEvent({
        entity: 'ClientAccount',
        entityId: accountForAudit.id,
        actor: { type: 'system', name: 'bff' },
        channel: 'web',
        occurredAt: new Date().toISOString(),
        reasonCode: 'LoginRateLimited',
      })
    }
    return errorResponse(429, 'rate_limited', 'Demasiados intentos. Inténtalo de nuevo más tarde.')
  }

  const account = await findAccountByEmail(normalizedEmail)
  const credential = account ? await findPasswordCredential(account.id) : null

  // Se verifica siempre una contraseña (real o señuelo, con el mismo
  // coste de Argon2id) para que "cuenta inexistente" y "contraseña
  // incorrecta" tarden aproximadamente lo mismo — defensa ante ataques de
  // temporización, no solo de contenido de la respuesta.
  const hashToCompare = credential?.secretHash ?? (await getDecoyPasswordHash())
  const passwordMatches = await verifyPassword(parsed.data.password, hashToCompare)

  if (!account || !credential || !passwordMatches) {
    if (account) {
      await recordEventAuditEvent({
        entity: 'ClientAccount',
        entityId: account.id,
        actor: { type: 'system', name: 'bff' },
        channel: 'web',
        occurredAt: new Date().toISOString(),
        reasonCode: 'LoginFailedInvalidCredentials',
      })
    }
    return invalidCredentialsResponse()
  }

  // A partir de aquí la contraseña ya es correcta: revelar el estado de
  // la cuenta ya no ayuda a un atacante que solo prueba contraseñas al
  // azar, y sí es información legítima para el dueño real.
  if (account.status === 'pending_verification') {
    await recordEventAuditEvent({
      entity: 'ClientAccount',
      entityId: account.id,
      actor: { type: 'user', id: account.id },
      channel: 'web',
      occurredAt: new Date().toISOString(),
      reasonCode: 'LoginFailedAccountNotVerified',
    })
    return errorResponse(403, 'account_not_verified', 'Verifica tu correo antes de iniciar sesión.')
  }
  if (account.status === 'suspended' || account.status === 'pending_deletion') {
    await recordEventAuditEvent({
      entity: 'ClientAccount',
      entityId: account.id,
      actor: { type: 'user', id: account.id },
      channel: 'web',
      occurredAt: new Date().toISOString(),
      reasonCode: 'LoginFailedAccountSuspended',
    })
    return errorResponse(403, 'account_suspended', 'Esta cuenta no puede iniciar sesión ahora mismo.')
  }

  const userAgent = request.headers.get('user-agent')
  await createSession(account.id, { ipAddress: ip === CLIENT_IP_UNKNOWN ? null : ip, userAgent })

  await recordEventAuditEvent({
    entity: 'ClientAccount',
    entityId: account.id,
    actor: { type: 'user', id: account.id },
    channel: 'web',
    occurredAt: new Date().toISOString(),
    reasonCode: 'LoginSucceeded',
  })

  return jsonResponse({ status: 'ok' })
}
