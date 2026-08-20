import 'server-only'

import { getRedisClient, withKeyPrefix } from '../redis'

/**
 * Límite de frecuencia fijo por ventana, en Redis, por sujeto/IP/propósito
 * independientes (`PLAN_DESARROLLO_WEB_PORTAL.md` §6.2: "límites de
 * intentos por IP, cuenta y operación"). Cada llamada consume una unidad;
 * el propio Redis expira la ventana con `EXPIRE`, así que no hace falta un
 * job de limpieza aparte.
 *
 * Ventana fija (no deslizante): más simple y suficiente para este umbral
 * de riesgo — un atacante puede, como mucho, duplicar su tasa efectiva
 * alrededor del borde de la ventana, no evadir el límite por completo.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Cuántas unidades quedan en la ventana actual tras esta llamada (0 si se ha superado). */
  remaining: number;
  /** Segundos hasta que la ventana actual expira. */
  resetInSeconds: number;
}

/**
 * `key` ya debe incluir el propósito y el sujeto/IP (p. ej.
 * `login:account:<accountId>` o `login:ip:<ip>`) — este módulo no impone
 * una convención de nombres, solo aplica el conteo.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  const client = await getRedisClient()
  const prefixedKey = withKeyPrefix(`rate-limit:${key}`)

  const count = await client.incr(prefixedKey)
  if (count === 1) {
    await client.expire(prefixedKey, windowSeconds)
  }

  const ttl = await client.ttl(prefixedKey)
  const resetInSeconds = ttl > 0 ? ttl : windowSeconds

  if (count > limit) {
    return { allowed: false, remaining: 0, resetInSeconds }
  }

  return { allowed: true, remaining: limit - count, resetInSeconds }
}

/** Deshace el conteo de una llamada a consumeRateLimit — para operaciones que se validan antes de saber si de verdad deben contar (p. ej. una petición malformada que nunca debió consumir cupo). */
export async function releaseRateLimit(key: string): Promise<void> {
  const client = await getRedisClient()
  const prefixedKey = withKeyPrefix(`rate-limit:${key}`)
  await client.decr(prefixedKey)
}
