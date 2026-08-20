import 'server-only'

import type { BookingLockPhase } from '@gapssa/contracts'

import { getRedisClient, withKeyPrefix } from '../redis'

/**
 * `BookingLock` (packages/contracts/src/booking.ts) — exclusión mutua REAL
 * mientras no existe Meeting (docs/contratos-portal-v1.md §3.2: "mientras
 * no existe Meeting, el BookingLock de Redis es la única protección real
 * contra una doble reserva concurrente"). Dos recursos distintos, cada uno
 * con su propia clave por solicitud:
 *
 * - `lock:booking:professional:<professionalId>:<requestId>` — exclusividad
 *   de la profesional (capacidad implícita 1: nunca dos citas a la vez,
 *   con independencia de `capacidadSimultanea` de la zona).
 * - `lock:booking:zone:<zoneId>:<requestId>` — capacidad de la zona
 *   (`capacidadSimultanea`, CZonaAtencion).
 *
 * Adquisición atómica vía script Lua (mismo patrón que
 * `otpService.ts`/`VERIFY_TRANSITION_SCRIPT`): lee todas las claves vivas
 * de la profesional/zona con `KEYS <patrón>` y decide solapes+capacidad
 * dentro del propio script — Redis ejecuta Lua de forma monohilo, así que
 * "leer todo, decidir, escribir" es una única operación atómica de verdad,
 * no una carrera entre varias peticiones a Redis. `KEYS` (no `SCAN`) es
 * aceptable aquí porque el volumen de claves vivas de este negocio es
 * mínimo (un centro, un puñado de profesionales/zonas, TTL corto) — un
 * volumen mayor exigiría rediseñar esto con un espacio de claves acotado
 * por franja horaria en vez de `KEYS` sin límite.
 *
 * TTL real: `GUEST_VERIFICATION_HOLD_MINUTES` en fase "verification",
 * `APPROVAL_HOLD_HOURS` en fase "approval" — el llamante decide cuál pasar.
 * Nunca lleva datos personales del invitado (revisión 4 del contrato).
 */

export interface BookingLockInput {
  requestId: string
  phase: BookingLockPhase
  treatmentId: string
  professionalId: string
  zoneId: string
  startAt: Date
  endAt: Date
  zoneCapacity: number
  ttlSeconds: number
}

export type AcquireBookingLockOutcome = 'acquired' | 'professional_busy' | 'zone_full'

const PROFESSIONAL_LOCK_PREFIX = 'lock:booking:professional:'
const ZONE_LOCK_PREFIX = 'lock:booking:zone:'

function professionalLockKey(professionalId: string, requestId: string): string {
  return withKeyPrefix(`${PROFESSIONAL_LOCK_PREFIX}${professionalId}:${requestId}`)
}

function professionalLockPattern(professionalId: string): string {
  return withKeyPrefix(`${PROFESSIONAL_LOCK_PREFIX}${professionalId}:*`)
}

function zoneLockKey(zoneId: string, requestId: string): string {
  return withKeyPrefix(`${ZONE_LOCK_PREFIX}${zoneId}:${requestId}`)
}

function zoneLockPattern(zoneId: string): string {
  return withKeyPrefix(`${ZONE_LOCK_PREFIX}${zoneId}:*`)
}

/**
 * KEYS[1] = clave exacta de la profesional a escribir; KEYS[2] = clave
 * exacta de la zona a escribir. ARGV: [patrónProfesional, patrónZona,
 * startMs, endMs, capacidadZona, ttlMs, payloadJson]. Se excluye siempre la
 * propia clave (KEYS[1]/KEYS[2]) de la comprobación de solape/capacidad —
 * así renovar el propio lock (cambio de fase verification -> approval) o
 * reconstruirlo tras perder Redis nunca choca consigo mismo.
 */
const ACQUIRE_LOCK_SCRIPT = `
local profKeys = redis.call('KEYS', ARGV[1])
for _, k in ipairs(profKeys) do
  if k ~= KEYS[1] then
    local raw = redis.call('GET', k)
    if raw then
      local data = cjson.decode(raw)
      if tonumber(data.startAtMs) < tonumber(ARGV[4]) and tonumber(data.endAtMs) > tonumber(ARGV[3]) then
        return 'professional_busy'
      end
    end
  end
end

local zoneKeys = redis.call('KEYS', ARGV[2])
local count = 0
for _, k in ipairs(zoneKeys) do
  if k ~= KEYS[2] then
    local raw = redis.call('GET', k)
    if raw then
      local data = cjson.decode(raw)
      if tonumber(data.startAtMs) < tonumber(ARGV[4]) and tonumber(data.endAtMs) > tonumber(ARGV[3]) then
        count = count + 1
      end
    end
  end
end
if count >= tonumber(ARGV[5]) then
  return 'zone_full'
end

redis.call('SET', KEYS[1], ARGV[7], 'PX', ARGV[6])
redis.call('SET', KEYS[2], ARGV[7], 'PX', ARGV[6])
return 'ok'
`

/**
 * Adquiere (o renueva, si `requestId` ya tenía el lock — se excluye de la
 * comprobación de solape/capacidad) el hueco para `requestId`. Misma
 * función para adquisición inicial, renovación de fase y reconstrucción
 * tras perder Redis (`reconciliation.ts`) — todas son, en esencia,
 * "vuelve a comprobar contra lo que hay vivo ahora mismo y escribe".
 */
export async function acquireOrRenewBookingLock(input: BookingLockInput): Promise<AcquireBookingLockOutcome> {
  const client = await getRedisClient()
  const startMs = input.startAt.getTime()
  const endMs = input.endAt.getTime()
  const ttlMs = input.ttlSeconds * 1000

  const payload = JSON.stringify({
    requestId: input.requestId,
    phase: input.phase,
    treatmentId: input.treatmentId,
    professionalId: input.professionalId,
    zoneId: input.zoneId,
    startAtMs: startMs,
    endAtMs: endMs,
  })

  const profKey = professionalLockKey(input.professionalId, input.requestId)
  const zoneKey = zoneLockKey(input.zoneId, input.requestId)

  const result = (await client.eval(ACQUIRE_LOCK_SCRIPT, {
    keys: [profKey, zoneKey],
    arguments: [
      professionalLockPattern(input.professionalId),
      zoneLockPattern(input.zoneId),
      String(startMs),
      String(endMs),
      String(input.zoneCapacity),
      String(ttlMs),
      payload,
    ],
  })) as string

  if (result === 'professional_busy' || result === 'zone_full') {
    return result
  }
  if (result === 'ok') {
    return 'acquired'
  }
  throw new Error(`Resultado inesperado del script de bloqueo de reserva: ${result}`)
}

export async function releaseBookingLock(input: {
  requestId: string
  professionalId: string
  zoneId: string
}): Promise<void> {
  const client = await getRedisClient()
  await client.del([
    professionalLockKey(input.professionalId, input.requestId),
    zoneLockKey(input.zoneId, input.requestId),
  ])
}
