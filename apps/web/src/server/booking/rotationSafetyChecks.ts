import 'server-only'
import { and, count, eq, inArray, ne } from 'drizzle-orm'

import type { BookingDbClient } from './db/client'
import { bookingRequestRecords, pendingGuestIdentities } from './db/schema'

/**
 * Consultas de seguridad para la rotación de secretos de `booking`
 * (`scripts/secrets-rotation/rotate-all-interactive.sh`, puerta S7) —
 * nunca invocadas por el flujo de reservas en sí, igual que
 * `fieldEncryptionRotation.ts`. Cada función responde una pregunta
 * objetiva de "¿hay algo vivo que dependa todavía de esta versión de
 * secreto?" para que la puerta S7 decida, con datos reales y no con una
 * suposición, si puede sustituir/retirar un secreto de forma segura.
 */

/**
 * Aborta si el proceso que invoca la rotación se está ejecutando con
 * `NODE_ENV=production`, salvo que el operador establezca explícitamente
 * `ALLOW_PRODUCTION_ROTATION=yes-i-am-sure`. Este repositorio no define
 * todavía un entorno de producción desplegado (Fase 1-4b, solo desarrollo
 * local) — esta guarda es una red de seguridad genérica para cuando lo
 * haya, no una comprobación contra una infraestructura real existente.
 */
export function assertRotationEnvironmentAllowed(): void {
  const nodeEnv = process.env.NODE_ENV
  const override = process.env.ALLOW_PRODUCTION_ROTATION
  if (nodeEnv === 'production' && override !== 'yes-i-am-sure') {
    throw new Error(
      'NODE_ENV=production — la rotación de secretos de booking se ha abortado. ' +
        'Si de verdad quieres ejecutarla contra este entorno, establece ' +
        'ALLOW_PRODUCTION_ROTATION=yes-i-am-sure explícitamente.',
    )
  }
}

/**
 * Solicitudes de reserva NO resueltas (`status <> 'resolved'`) —
 * "tokens vivos" para `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET` (el token
 * se recalcula en cada verificación a partir del secreto ACTIVO, sin
 * versión propia — rotar el secreto invalida de inmediato cualquier token
 * ya emitido para una solicitud todavía no resuelta) y también el
 * denominador relevante para decidir si `BOOKING_INTERNAL_API_SECRET`
 * tiene algo en vuelo que dependa de un barrido en curso.
 */
export async function countLiveBookingRequests(db: BookingDbClient): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(bookingRequestRecords)
    .where(ne(bookingRequestRecords.status, 'resolved'))
  return row?.value ?? 0
}

/**
 * Solicitudes NO resueltas cuya `identityFingerprintKeyVersion` sigue
 * siendo una de las `versions` dadas — mientras este conteo sea mayor que
 * cero, esas versiones de `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS` NO
 * pueden retirarse del mapa (la detección de replay de esa solicitud
 * necesita poder recalcular su huella con la MISMA versión con la que se
 * creó, ver comentario en `db/schema.ts` junto a la columna). A diferencia
 * de `BOOKING_FIELD_ENCRYPTION_KEYS`, aquí NO hay nada que "recifrar": la
 * huella no es un valor cifrado en reposo, es un HMAC de comparación —
 * basta con conservar el secreto de esa versión hasta que la solicitud se
 * resuelva (cota superior: `APPROVAL_HOLD_HOURS`).
 */
export async function countLiveBookingRequestsReferencingFingerprintVersions(
  db: BookingDbClient,
  versions: readonly string[],
): Promise<number> {
  if (versions.length === 0) {
    return 0
  }
  const [row] = await db
    .select({ value: count() })
    .from(bookingRequestRecords)
    .where(and(ne(bookingRequestRecords.status, 'resolved'), inArray(bookingRequestRecords.identityFingerprintKeyVersion, versions)))
  return row?.value ?? 0
}

/**
 * Identidades de invitado ACTIVAS (`status = 'active'`) — mientras este
 * conteo sea mayor que cero, sustituir `BOOKING_EMAIL_LOOKUP_HMAC_SECRET`
 * directamente rompe `countActivePendingRequestsByEmailHmac` para esas
 * filas (el HMAC nuevo, calculado con el secreto nuevo, ya no coincidirá
 * con el `emailLookupHmac` guardado con el secreto anterior) — el límite
 * `MAX_PENDING_REQUESTS_PER_CLIENT` dejaría de contarlas silenciosamente.
 * No hay migración de recifrado posible aquí (no hay nada que descifrar:
 * es un HMAC de un solo sentido) — con filas activas, hace falta la
 * estrategia de columna dual descrita en
 * `docs/incidente-booking-secrets-local-2026-08-13.md` §5.B antes de
 * rotar, fuera del alcance de este script.
 */
export async function countActivePendingGuestIdentities(db: BookingDbClient): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(pendingGuestIdentities)
    .where(eq(pendingGuestIdentities.status, 'active'))
  return row?.value ?? 0
}

/**
 * Solicitudes NO resueltas cuyo `accessTokenKeyVersion` sigue siendo una
 * de las `versions` dadas — criterio real de retirada para
 * `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS` (mismo patrón exacto que
 * `countLiveBookingRequestsReferencingFingerprintVersions`). **Nunca**
 * `countLiveBookingRequests` a secas para esta decisión: ese conteo no
 * distingue qué versión firmó el token que un invitado concreto tiene en
 * la mano — solo esta consulta, por versión exacta, lo demuestra. Filas
 * del flujo autenticado (`accessTokenKeyVersion IS NULL`) nunca
 * coinciden con ningún elemento de `versions`, así que no afectan este
 * conteo.
 */
export async function countLiveBookingRequestsReferencingAccessTokenVersions(
  db: BookingDbClient,
  versions: readonly string[],
): Promise<number> {
  if (versions.length === 0) {
    return 0
  }
  const [row] = await db
    .select({ value: count() })
    .from(bookingRequestRecords)
    .where(and(ne(bookingRequestRecords.status, 'resolved'), inArray(bookingRequestRecords.accessTokenKeyVersion, versions)))
  return row?.value ?? 0
}
