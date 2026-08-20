import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import {
  disableBookingAuditFailureFor,
  enableBookingAuditFailureFor,
  findBookingRequestRow,
  findPendingGuestIdentityStatus,
  forceBookingReviewProcessing,
  insertSimEspoContactForTesting,
  installBookingAuditFailureInjection,
  listBookingReviewRowsForRequest,
} from './bookingDb'

/**
 * Revisión 3 de Fase 4B — consistencia transaccional y operativa de
 * `BookingReviewRecord`: apertura atómica bajo concurrencia (punto 1),
 * workflow durable con lease (punto 2), rechazo/caducidad transaccionales
 * con rollback demostrado (punto 3), validación real de
 * `resolutionContactId` (punto 4), endpoint de detalle (punto 5), ventana
 * de 5h (punto 7) y recuperación de reclamos abandonados (punto 9). Contra
 * el adaptador SIMULADO, nunca EspoCRM real — mismo principio que
 * `booking.review.int.test.ts` (ciclo básico, sin repetir aquí).
 */

const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-2'
const PROFESSIONAL_ID = 'professional-owner'
const INTERNAL_SECRET = process.env.BOOKING_INTERNAL_API_SECRET as string

/** 18:00 UTC — franja propia, libre de colisiones con el resto de la suite (ver mismo razonamiento en booking.review.int.test.ts, que usa 16:00). */
function nextBusinessDayAt18Utc(n: number): string {
  const date = new Date()
  date.setUTCHours(18, 0, 0, 0)
  let remaining = n
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    if (date.getUTCDay() !== 0) {
      remaining -= 1
    }
  }
  return date.toISOString()
}

async function freshJarWithCsrf(): Promise<CookieJar> {
  const jar = new CookieJar()
  await visitPage(jar, '/es')
  return jar
}

async function internalRequest(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) {
  const baseUrl = inject('integrationBaseUrl')
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-internal-api-secret': INTERNAL_SECRET },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const responseBody = await response.json().catch(() => ({}))
  return { status: response.status, body: responseBody as Record<string, unknown> }
}

/** Invitado cuyo correo coincide con un Contact y cuyo teléfono coincide con OTRO Contact distinto — señales contradictorias, nunca se fusiona. Devuelve también accessToken/code para poder verificar dos veces concurrentemente. */
async function createAmbiguousGuestRequest(dayOffset: number) {
  const unique = randomUUID()
  const digits = String(Date.now()).slice(-6) + String(dayOffset).padStart(2, '0')
  const emailContactId = await insertSimEspoContactForTesting({
    firstName: 'ContactoCorreo',
    lastName: 'Uno',
    email: `revtx-email-${unique}@example.test`,
    phone: `+3462${digits}1`,
  })
  const phoneContactId = await insertSimEspoContactForTesting({
    firstName: 'ContactoTelefono',
    lastName: 'Dos',
    email: `revtx-other-${unique}@example.test`,
    phone: `+3463${digits}2`,
  })

  const guest = {
    firstName: 'Revision',
    lastName: 'Transaccional',
    email: `revtx-email-${unique}@example.test`, // coincide con emailContactId
    phone: `+3463${digits}2`, // coincide con phoneContactId
  }

  const jar = await freshJarWithCsrf()
  const startAt = nextBusinessDayAt18Utc(dayOffset)
  const create = await bookingApi.post(jar, '/api/booking/v1/requests', {
    idempotencyKey: randomUUID(),
    treatmentId: TREATMENT_ID,
    professionalId: PROFESSIONAL_ID,
    zoneId: ZONE_ID,
    startAt,
    guest,
  })
  expect(create.status).toBe(202)
  const requestId = create.body.requestId as string
  const accessToken = create.body.accessToken as string
  const code = await getLatestOtpCodeForEmail(guest.email)

  return { requestId, accessToken, code, guest, emailContactId, phoneContactId }
}

async function verifyOnce(requestId: string, accessToken: string, code: string | null) {
  const jar = await freshJarWithCsrf()
  return bookingApi.post(jar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
}

describe('punto 1 — apertura atómica bajo concurrencia', () => {
  it('dos verificaciones simultáneas del mismo invitado ambiguo convergen en UNA sola revisión activa, nunca dos', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(10)

    const [verify1, verify2] = await Promise.all([verifyOnce(requestId, accessToken, code), verifyOnce(requestId, accessToken, code)])

    // Ambas responden con éxito — ninguna ve un error de servidor por la
    // carrera; la revisión activa (`pending`) resultante es la MISMA para
    // las dos, aunque solo una de las dos llamadas la haya creado de
    // verdad (`opened` vs. `idempotent_existing`, indistinguible desde
    // fuera — ver repository.ts::openBookingReviewAtomic).
    expect([verify1.status, verify2.status]).toEqual([200, 200])
    expect(verify1.body).toEqual({ status: 'contact_review_pending' })
    expect(verify2.body).toEqual({ status: 'contact_review_pending' })

    const rows = await listBookingReviewRowsForRequest(requestId)
    const active = rows.filter((row) => row.status === 'pending' || row.status === 'processing')
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ conflict_type: 'contact_conflicting_signals' })

    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('contact_review_pending')
  })
})

describe('punto 7 — ventana de revisión de 5 horas, no 72', () => {
  it('BookingReviewRecord.expiresAt queda a ~5h de createdAt, nunca 72h', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(11)
    await verifyOnce(requestId, accessToken, code)

    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')
    expect(review).toBeDefined()

    const createdAt = new Date(review!.created_at as string).getTime()
    const expiresAt = new Date(review!.expires_at as string).getTime()
    const hours = (expiresAt - createdAt) / (60 * 60 * 1000)
    expect(hours).toBeGreaterThan(4.9)
    expect(hours).toBeLessThan(5.1)
  })
})

describe('punto 5 — endpoint interno de detalle y paginación del listado', () => {
  it('el detalle expone candidateContactIds/candidateMeetingIds; el listado sigue sin exponerlos; la paginación funciona', async () => {
    const { requestId, accessToken, code, emailContactId, phoneContactId } = await createAmbiguousGuestRequest(12)
    await verifyOnce(requestId, accessToken, code)

    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')
    expect(review).toBeDefined()

    const detail = await internalRequest('GET', `/api/booking/v1/internal/reviews/${review!.id as string}`)
    expect(detail.status).toBe(200)
    const detailReview = detail.body.review as Record<string, unknown>
    expect(detailReview).toMatchObject({ reviewId: review!.id, bookingRequestId: requestId, conflictType: 'contact_conflicting_signals' })
    expect((detailReview.candidateContactIds as string[]).sort()).toEqual([emailContactId, phoneContactId].sort())

    const list = await internalRequest('GET', '/api/booking/v1/internal/reviews?limit=1&offset=0')
    expect(list.status).toBe(200)
    expect(list.body).toMatchObject({ limit: 1 })
    expect((list.body.reviews as unknown[]).length).toBeLessThanOrEqual(1)
    expect(typeof list.body.total).toBe('number')
    const anyReview = (list.body.reviews as Record<string, unknown>[])[0]
    if (anyReview) {
      expect(anyReview).not.toHaveProperty('candidateContactIds')
      expect(anyReview).not.toHaveProperty('candidateMeetingIds')
    }
  })

  it('detalle de un id inexistente responde 404', async () => {
    const detail = await internalRequest('GET', `/api/booking/v1/internal/reviews/${randomUUID()}`)
    expect(detail.status).toBe(404)
  })
})

describe('punto 4 — validación real de resolutionContactId', () => {
  it('formato inválido se rechaza sin llegar a consultar EspoCRM', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(13)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    const resolve = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/resolve`, {
      resolutionContactId: 'not a valid id !!',
      resolvedBy: 'operador-test',
    })
    expect(resolve.status).toBe(400)
    expect(resolve.body.error).toMatchObject({ code: 'invalid_contact_id_format' })

    // La revisión sigue disponible — el intento inválido no la consumió.
    const after = await listBookingReviewRowsForRequest(requestId)
    expect(after.find((row) => row.id === review.id)?.status).toBe('pending')
  })

  it('un id con buen formato pero inexistente en EspoCRM se rechaza', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(14)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    const resolve = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/resolve`, {
      resolutionContactId: randomUUID(),
      resolvedBy: 'operador-test',
    })
    expect(resolve.status).toBe(409)
    expect(resolve.body.error).toMatchObject({ code: 'contact_not_found' })
  })

  it('un Contact real pero AJENO a los candidatos detectados se rechaza — nunca se acepta un id arbitrario', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(15)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    const unrelatedContactId = await insertSimEspoContactForTesting({
      firstName: 'Ajeno',
      lastName: 'AlConflicto',
      email: `revtx-unrelated-${randomUUID()}@example.test`,
      phone: '+34600111222',
    })

    const resolve = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/resolve`, {
      resolutionContactId: unrelatedContactId,
      resolvedBy: 'operador-test',
    })
    expect(resolve.status).toBe(409)
    expect(resolve.body.error).toMatchObject({ code: 'contact_not_a_candidate' })
  })
})

describe('punto 2 — workflow durable con lease', () => {
  it('una revisión con un claim vigente (processing) no puede resolverse ni rechazarse por otra petición — responde in_progress', async () => {
    const { requestId, accessToken, code, emailContactId } = await createAmbiguousGuestRequest(16)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    await forceBookingReviewProcessing(review.id as string, {
      claimToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // lease vigente, propiedad de "otra" reanudación
    })

    const resolve = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/resolve`, {
      resolutionContactId: emailContactId,
      resolvedBy: 'operador-test',
    })
    expect(resolve.status).toBe(409)
    expect(resolve.body.error).toMatchObject({ code: 'in_progress' })

    const reject = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/reject`, { rejectedBy: 'operador-test' })
    expect(reject.status).toBe(409)
    expect(reject.body.error).toMatchObject({ code: 'in_progress' })
  })

  it('un claim con el lease VENCIDO sí puede reclamarse de nuevo — la resolución converge con normalidad', async () => {
    const { requestId, accessToken, code, emailContactId } = await createAmbiguousGuestRequest(17)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    await forceBookingReviewProcessing(review.id as string, {
      claimToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60 * 1000), // lease vencido — reanudación abandonada
    })

    const resolve = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/resolve`, {
      resolutionContactId: emailContactId,
      resolvedBy: 'operador-test',
    })
    expect(resolve.status).toBe(200)
    expect(resolve.body.status).toBe('resolved')
  })
})

describe('punto 9 — conciliación de reclamos abandonados', () => {
  it('el barrido devuelve a pending una revisión processing con lease vencido, reportado en recoveredStaleReviewClaims', async () => {
    const { requestId, accessToken, code, emailContactId } = await createAmbiguousGuestRequest(18)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    await forceBookingReviewProcessing(review.id as string, {
      claimToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60 * 1000),
    })

    const sweep = await internalRequest('POST', '/api/booking/v1/internal/sweep')
    expect(sweep.status).toBe(200)
    expect((sweep.body as { recoveredStaleReviewClaims: number }).recoveredStaleReviewClaims).toBeGreaterThanOrEqual(1)

    const after = await listBookingReviewRowsForRequest(requestId)
    expect(after.find((row) => row.id === review.id)?.status).toBe('pending')

    // Ya reclamable con normalidad tras la recuperación del barrido.
    const resolve = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/resolve`, {
      resolutionContactId: emailContactId,
      resolvedBy: 'operador-test',
    })
    expect(resolve.status).toBe(200)
  })
})

describe('punto 3 — rechazo/caducidad transaccionales, con rollback demostrado', () => {
  it('un fallo inyectado en la auditoría de resolución de la solicitud revierte TODO — la revisión sigue pending, la solicitud sigue contact_review_pending, la identidad sigue activa', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(19)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    await installBookingAuditFailureInjection()
    // La auditoría de `resolveBookingRequestWithinTx` para esta solicitud
    // (entidad `BookingRequestRecord`, mismo `entity_id` = requestId) se
    // fuerza a fallar — ocurre DESPUÉS de que la propia revisión ya se
    // marcó `rejected` (y su auditoría insertada) dentro de la MISMA
    // transacción, así que un rollback correcto debe deshacer también ESE
    // primer paso.
    await enableBookingAuditFailureFor('BookingRequestRecord', requestId)
    try {
      const reject = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/reject`, { rejectedBy: 'operador-test' })
      expect(reject.status).toBe(500)
    } finally {
      await disableBookingAuditFailureFor('BookingRequestRecord', requestId)
    }

    // Rollback completo: nada quedó a medias.
    const reviewAfter = await listBookingReviewRowsForRequest(requestId)
    expect(reviewAfter.find((row) => row.id === review.id)?.status).toBe('pending')

    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('contact_review_pending')

    expect(await findPendingGuestIdentityStatus(requestId)).toBe('active')

    // Reintentar sin el fallo inyectado converge con normalidad — nunca queda atascado.
    const retry = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/reject`, { rejectedBy: 'operador-test' })
    expect(retry.status).toBe(200)
    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()
  })

  it('un fallo inyectado en la purga de PII revierte también el cierre de la revisión y la resolución de la solicitud', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(20)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    await installBookingAuditFailureInjection()
    // Esta vez el fallo se inyecta en el ÚLTIMO paso de la transacción — la
    // auditoría de la purga de `PendingGuestIdentity` (mismo entity_id).
    // Como ambas auditorías (`BookingRequestRecord` y `PendingGuestIdentity`)
    // comparten `entity_id` = requestId pero difieren en `entity`, activar
    // solo esta última demuestra que el rollback también deshace los pasos
    // anteriores de la MISMA transacción (cierre de la revisión, resolución
    // de la solicitud), no solo el paso que falló.
    await enableBookingAuditFailureFor('PendingGuestIdentity', requestId)
    try {
      const reject = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/reject`, { rejectedBy: 'operador-test' })
      expect(reject.status).toBe(500)
    } finally {
      await disableBookingAuditFailureFor('PendingGuestIdentity', requestId)
    }

    const reviewAfter = await listBookingReviewRowsForRequest(requestId)
    expect(reviewAfter.find((row) => row.id === review.id)?.status).toBe('pending')

    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('contact_review_pending')
    expect(await findPendingGuestIdentityStatus(requestId)).toBe('active')
  })
})
