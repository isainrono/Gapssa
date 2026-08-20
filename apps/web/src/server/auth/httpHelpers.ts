import 'server-only'
import { isIP } from 'node:net'
import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'

import { serverEnv } from '../env'

/**
 * Utilidades compartidas por las rutas de `/api/auth/*`: respuestas
 * uniformes, límite de tamaño de entrada
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §15: "límites de tamaño y validación de
 * entradas") y extracción de IP para rate limiting/auditoría.
 */

export const MAX_JSON_BODY_BYTES = 16 * 1024

export function jsonResponse<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) },
  })
}

export function errorResponse(status: number, code: string, message: string): NextResponse {
  return jsonResponse({ error: { code, message } }, { status })
}

export type ParsedBody<T> = { success: true; data: T } | { success: false; response: NextResponse }

/** Lee el cuerpo con un límite de tamaño explícito y lo valida contra `schema` — nunca confía solo en la validación de cliente. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<ParsedBody<T>> {
  const text = await request.text()

  if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) {
    return { success: false, response: errorResponse(413, 'payload_too_large', 'El cuerpo de la petición es demasiado grande.') }
  }

  let raw: unknown
  try {
    raw = text.length > 0 ? JSON.parse(text) : {}
  } catch {
    return { success: false, response: errorResponse(400, 'invalid_json', 'El cuerpo de la petición no es JSON válido.') }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { success: false, response: errorResponse(400, 'invalid_input', 'Los datos enviados no son válidos.') }
  }

  return { success: true, data: parsed.data }
}

/**
 * Sujeto agregado usado cuando no se puede determinar una IP de cliente
 * fiable — nunca `null`/`undefined`, para que las claves de límite de
 * frecuencia y la columna `inet` de `sessions.ip_address` sigan teniendo
 * un valor bien definido (`ipAddress: ip === CLIENT_IP_UNKNOWN ? null : ip`
 * en los llamantes que persisten la IP).
 */
export const CLIENT_IP_UNKNOWN = 'unknown'

// Cabecera realista más larga posible (varios proxies encadenados,
// direcciones IPv6 completas) más margen — cualquier valor por encima de
// esto se descarta sin intentar parsearlo (`PLAN_DESARROLLO_WEB_PORTAL.md`
// §15: "límites de tamaño y validación de entradas" aplica también a
// cabeceras, no solo al cuerpo).
const MAX_FORWARDED_FOR_HEADER_LENGTH = 1024

/**
 * Topología de confianza (`PROJECT_CONTEXT.md` §15: "Plesk actuará como
 * proxy inverso y terminación HTTPS"; documentado también en
 * `server/env.ts`, `TRUSTED_PROXY_HOP_COUNT`): la aplicación de producción
 * solo recibe tráfico a través de ese proxy — nunca expuesta directamente
 * a Internet. `X-Forwarded-For` se construye añadiendo una entrada por
 * cada salto (`cliente, proxyExterno, ..., proxyInmediato`); con exactamente
 * un proxy de confianza inmediatamente delante de Next.js
 * (`TRUSTED_PROXY_HOP_COUNT=1`, valor por defecto), la única entrada que
 * ese proxy pudo escribir de verdad es la ÚLTIMA — todo lo anterior lo
 * aporta quien hace la petición y es falsificable a voluntad sin que un
 * proxy intermedio lo sanee. Contar `TRUSTED_PROXY_HOP_COUNT` saltos desde
 * la derecha generaliza esto a una cadena de varios proxies de confianza
 * (p. ej. un CDN delante de Plesk): la entrada fiable es
 * `entries[entries.length - TRUSTED_PROXY_HOP_COUNT]`.
 *
 * Devuelve `CLIENT_IP_UNKNOWN` (nunca lanza, nunca confía a ciegas) si:
 * `TRUSTED_PROXY_HOP_COUNT` es 0 (ninguna cabecera es de confianza por
 * configuración explícita); la cabecera falta, está vacía o excede el
 * límite de longitud; la cabecera tiene menos entradas de las esperadas
 * para la topología configurada; o la entrada candidata no es una
 * dirección IPv4/IPv6 válida (rechaza también antes de que un valor
 * malformado llegue a una columna `inet`, ver `session.ts`).
 */
export function getClientIp(request: Request): string {
  const hopCount = serverEnv.TRUSTED_PROXY_HOP_COUNT
  if (hopCount <= 0) {
    return CLIENT_IP_UNKNOWN
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  if (!forwardedFor || forwardedFor.length > MAX_FORWARDED_FOR_HEADER_LENGTH) {
    return CLIENT_IP_UNKNOWN
  }

  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (entries.length < hopCount) {
    return CLIENT_IP_UNKNOWN
  }

  const candidate = entries[entries.length - hopCount]
  if (!candidate || isIP(candidate) === 0) {
    return CLIENT_IP_UNKNOWN
  }

  return candidate
}
