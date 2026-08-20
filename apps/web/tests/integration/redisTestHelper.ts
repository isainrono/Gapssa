import { createClient } from 'redis'
import { inject } from 'vitest'

/**
 * Acceso directo, solo para pruebas, al mismo Redis efímero que usa el
 * servidor de pruebas — mismo principio que `authDb.ts` para Postgres:
 * el servidor de pruebas es un proceso `next dev` aparte (spawn en
 * global-setup.ts), así que no se puede llamar a `otpService.ts`
 * directamente desde aquí (lleva `import 'server-only'`, y aunque no lo
 * llevara, sería un proceso distinto). Prefijo de claves
 * (`integrationRedisKeyPrefix`) idéntico al que usa `withKeyPrefix`
 * (`server/redis.ts`) — nunca el prefijo de un `npm run dev` real.
 */
function prefixedKey(key: string): string {
  return `${inject('integrationRedisKeyPrefix')}${key}`
}

/**
 * Simula que el reto OTP original de una solicitud de independencia ya no
 * es el vigente (caducó y Redis lo purgó, o el propio TTL venció) — borra
 * tanto el puntero "vigente" para propósito+sujeto como el propio reto,
 * sin pasar por ningún módulo `server-only`. Usado para probar que
 * `completeIndependenceRequest` (repository.ts) nunca reconcilia una
 * solicitud `confirmed` heredada con un reto que ya no puede validarse.
 */
export async function expireIndependenceOtpChallenge(accountId: string, challengeId: string): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL as string })
  await client.connect()
  try {
    await client.del(prefixedKey(`otp:current:independence_confirmation:${accountId}`))
    await client.del(prefixedKey(`otp:challenge:${challengeId}`))
  } finally {
    await client.quit()
  }
}

/**
 * Borra TODAS las claves de `BookingLock` (`server/booking/bookingLock.ts`)
 * de una profesional/zona concretas — simula "Redis perdió el bloqueo"
 * (caída, `FLUSHALL` accidental, expiración prematura) para probar que el
 * barrido de conciliación (`server/booking/reconciliation.ts`) lo
 * reconstruye a partir de `BookingRequestRecord`, nunca dependiendo
 * solamente del propio Redis.
 */
export async function deleteBookingLocksFor(professionalId: string, zoneId: string): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL as string })
  await client.connect()
  try {
    const professionalKeys = await client.keys(prefixedKey(`lock:booking:professional:${professionalId}:*`))
    const zoneKeys = await client.keys(prefixedKey(`lock:booking:zone:${zoneId}:*`))
    const allKeys = [...professionalKeys, ...zoneKeys]
    if (allKeys.length > 0) {
      await client.del(allKeys)
    }
  } finally {
    await client.quit()
  }
}

/** true si existe al menos un BookingLock vivo para esa profesional o esa zona. */
export async function hasAnyBookingLock(professionalId: string, zoneId: string): Promise<boolean> {
  const client = createClient({ url: process.env.REDIS_URL as string })
  await client.connect()
  try {
    const professionalKeys = await client.keys(prefixedKey(`lock:booking:professional:${professionalId}:*`))
    const zoneKeys = await client.keys(prefixedKey(`lock:booking:zone:${zoneId}:*`))
    return professionalKeys.length > 0 || zoneKeys.length > 0
  } finally {
    await client.quit()
  }
}
