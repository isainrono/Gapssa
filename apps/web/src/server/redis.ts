import 'server-only'
import { createClient, type RedisClientType } from 'redis'

import { serverEnv } from './env'
import { withTimeout } from './withTimeout'

/**
 * Fase 1: solo se usa para el health check (`/api/health`). Los
 * namespaces de claves reales (`lock:`, `otp:`, `idempotency:`,
 * `rate-limit:`) son diseño de Fase 4
 * (docs/contratos-portal-v1.md §9) — no se implementan todavía.
 * `REDIS_KEY_PREFIX` ya queda disponible para cuando se necesiten.
 */
export function withKeyPrefix(key: string): string {
  return `${serverEnv.REDIS_KEY_PREFIX}${key}`
}

const CONNECT_TIMEOUT_MS = 2_000

// Cliente reutilizado (módulo cacheado por Node entre peticiones), en vez
// de abrir una conexión TCP + autenticar en cada llamada a /api/health:
// endurecimiento explícito de la revisión de Fase 1 sobre la versión
// anterior, que conectaba y cerraba por petición. El listener de 'error'
// es obligatorio con node-redis: sin él, un fallo de conexión en segundo
// plano se propaga como excepción no capturada del proceso, no solo como
// un valor de retorno.
let client: null | RedisClientType = null

function getClient(): RedisClientType {
  if (!client) {
    client = createClient({
      socket: { connectTimeout: CONNECT_TIMEOUT_MS },
      url: serverEnv.REDIS_URL,
    })
    client.on('error', () => {
      // Silenciado a propósito: pingRedis() ya refleja el estado real en
      // su valor de retorno en cada llamada; no hay nada más que hacer
      // aquí salvo evitar que el proceso trate esto como no capturado.
    })
  }
  return client
}

export async function pingRedis(timeoutMs = CONNECT_TIMEOUT_MS): Promise<boolean> {
  const redisClient = getClient()

  if (!redisClient.isOpen) {
    await withTimeout(redisClient.connect(), timeoutMs, 'Redis connect')
  }

  const reply = await withTimeout(redisClient.ping(), timeoutMs, 'Redis ping')
  return reply === 'PONG'
}

/**
 * Fase 3: cliente Redis de propósito general para OTP (`otpService.ts`),
 * límites de frecuencia (`rateLimit.ts`) y bloqueos formales del futuro
 * flujo de reservas (Fase 4). Mismo cliente singleton que `pingRedis`
 * (reutiliza `getClient()`), conectado de forma perezosa en la primera
 * llamada real, nunca una conexión nueva por operación.
 */
export async function getRedisClient(timeoutMs = CONNECT_TIMEOUT_MS): Promise<RedisClientType> {
  const redisClient = getClient()

  if (!redisClient.isOpen) {
    await withTimeout(redisClient.connect(), timeoutMs, 'Redis connect')
  }

  return redisClient
}
