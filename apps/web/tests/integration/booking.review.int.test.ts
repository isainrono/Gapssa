import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import {
  expireBookingReviewForTesting,
  findBookingRequestRow,
  findPendingBookingReviewByBookingRequestId,
  findPendingGuestIdentityStatus,
  findSimEspoMeetingByBookingRequestId,
  insertSimEspoContactForTesting,
} from './bookingDb'

/**
 * Ciclo de vida completo de `BookingReviewRecord` — Fase 4B, revisión 2,
 * punto 3/6. Contra el adaptador SIMULADO (`ESPO_BOOKING_ADAPTER=simulated`,
 * por defecto en toda la suite), nunca contra EspoCRM real. Construye el
 * escenario de ambigüedad insertando Contacts simulados directamente
 * (`insertSimEspoContactForTesting`), sin pasar por `findOrCreateContact` —
 * exactamente la situación real que un operador vería.
 */

const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-2'
const PROFESSIONAL_ID = 'professional-owner'
const INTERNAL_SECRET = process.env.BOOKING_INTERNAL_API_SECRET as string

/**
 * Deliberadamente a las 16:00 UTC, no 10:00 — todo el resto de la suite de
 * integración usa `nextBusinessDayAt10Utc` (10:00 UTC) para
 * `professional-owner`; el presupuesto de day-offsets libres por debajo
 * del horizonte de 60 días (`MAX_LEAD_TIME_DAYS`) está prácticamente
 * agotado entre todos los ficheros. Un tratamiento de 60 minutos a una
 * HORA distinta nunca solapa con una reserva a las 10:00 el mismo día,
 * así que esta franja es su propio espacio, libre de colisiones, sin
 * tener que perseguir un offset numérico no usado por nadie más.
 */
function nextBusinessDayAt16Utc(n: number): string {
  const date = new Date()
  date.setUTCHours(16, 0, 0, 0)
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

/** Invitado cuyo correo coincide con un Contact y cuyo teléfono coincide con OTRO Contact distinto — señales contradictorias, nunca se fusiona. */
async function createAmbiguousGuestReview(dayOffset: number) {
  const unique = randomUUID()
  const digits = String(Date.now()).slice(-6) + String(dayOffset).padStart(2, '0')
  const emailContactId = await insertSimEspoContactForTesting({
    firstName: 'ContactoCorreo',
    lastName: 'Uno',
    email: `review-email-${unique}@example.test`,
    phone: `+3460${digits}1`,
  })
  const phoneContactId = await insertSimEspoContactForTesting({
    firstName: 'ContactoTelefono',
    lastName: 'Dos',
    email: `review-other-${unique}@example.test`,
    phone: `+3461${digits}2`,
  })

  const guest = {
    firstName: 'Revision',
    lastName: 'Prueba',
    email: `review-email-${unique}@example.test`, // coincide con emailContactId
    phone: `+3461${digits}2`, // coincide con phoneContactId
  }

  const jar = await freshJarWithCsrf()
  const startAt = nextBusinessDayAt16Utc(dayOffset)
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

  const verifyJar = await freshJarWithCsrf()
  const verify = await bookingApi.post(verifyJar, `/api/booking/v1/requests/${requestId}/verify`, { code }, { accessToken })
  expect(verify.status).toBe(200)
  expect(verify.body).toEqual({ status: 'contact_review_pending' })

  return { requestId, guest, emailContactId, phoneContactId }
}

describe('ciclo de vida de BookingReviewRecord', () => {
  it('el matching ambiguo abre una revisión durable, visible solo con campos no sensibles en el listado interno', async () => {
    const { requestId } = await createAmbiguousGuestReview(1)

    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('contact_review_pending')

    const review = await findPendingBookingReviewByBookingRequestId(requestId)
    expect(review).toMatchObject({ conflict_type: 'contact_conflicting_signals', status: 'pending' })

    const list = await internalRequest('GET', '/api/booking/v1/internal/reviews')
    expect(list.status).toBe(200)
    const reviews = list.body.reviews as Record<string, unknown>[]
    const found = reviews.find((r) => r.bookingRequestId === requestId)
    expect(found).toMatchObject({ conflictType: 'contact_conflicting_signals' })
    // Nunca PII, nunca candidateContactIds/candidateMeetingIds en el listado.
    expect(found).not.toHaveProperty('candidateContactIds')
    expect(found).not.toHaveProperty('candidateMeetingIds')
    expect(JSON.stringify(found)).not.toContain('review-email-')
  })

  it('una solicitud en contact_review_pending sigue ocupando su horario — nunca libera el hueco mientras la revisión está abierta', async () => {
    // Revisión 2 de Fase 4B, punto 6: antes de esta revisión,
    // `listUnresolvedOverlapping` (repository.ts) no incluía
    // `contact_review_pending` en su filtro de estados — una solicitud en
    // revisión manual (hasta 72h) dejaba su horario libre para que
    // cualquier otro cliente lo reclamara. Esta prueba demuestra que ya no
    // es así.
    const { requestId: firstRequestId } = await createAmbiguousGuestReview(6)
    const record = await findBookingRequestRow(firstRequestId)
    expect(record?.status).toBe('contact_review_pending')

    const jar = await freshJarWithCsrf()
    const conflicting = await bookingApi.post(jar, '/api/booking/v1/requests', {
      idempotencyKey: randomUUID(),
      treatmentId: TREATMENT_ID,
      professionalId: PROFESSIONAL_ID,
      zoneId: ZONE_ID,
      startAt: nextBusinessDayAt16Utc(6),
      guest: { firstName: 'Otro', lastName: 'Cliente', email: `other-${randomUUID()}@example.test`, phone: '+34600000999' },
    })
    expect(conflicting.status).toBe(409)
    expect(conflicting.body.error).toMatchObject({ code: 'slot_unavailable' })
  })

  it('resolver con un Contact inequívoco reanuda el flujo y crea el Meeting', async () => {
    const { requestId, emailContactId } = await createAmbiguousGuestReview(2)
    const review = await findPendingBookingReviewByBookingRequestId(requestId)
    expect(review).not.toBeNull()

    const resolve = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review!.id as string}/resolve`, {
      resolutionContactId: emailContactId,
      resolvedBy: 'operador-test',
    })
    expect(resolve.status).toBe(200)
    expect(resolve.body.status).toBe('resolved')

    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('pending_approval')
    expect(record?.meeting_id).toBe(resolve.body.meetingId)

    const meeting = await findSimEspoMeetingByBookingRequestId(requestId)
    expect(meeting).toMatchObject({ c_estado_reserva: 'PendingCenterApproval' })

    // La identidad de invitado se purgó tras vincular el Meeting — no antes.
    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()
  })

  it('resolver dos veces la misma revisión responde already_closed, nunca reaplica', async () => {
    const { requestId, emailContactId } = await createAmbiguousGuestReview(3)
    const review = await findPendingBookingReviewByBookingRequestId(requestId)

    const first = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review!.id as string}/resolve`, {
      resolutionContactId: emailContactId,
      resolvedBy: 'operador-test',
    })
    expect(first.status).toBe(200)

    const second = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review!.id as string}/resolve`, {
      resolutionContactId: emailContactId,
      resolvedBy: 'operador-test',
    })
    expect(second.status).toBe(409)
    expect(second.body.error).toMatchObject({ code: 'already_closed' })
  })

  it('rechazar una revisión resuelve la solicitud como contact_review_rejected y purga la identidad', async () => {
    const { requestId } = await createAmbiguousGuestReview(4)
    const review = await findPendingBookingReviewByBookingRequestId(requestId)

    const reject = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review!.id as string}/reject`, {
      rejectedBy: 'operador-test',
    })
    expect(reject.status).toBe(200)
    expect(reject.body.status).toBe('rejected')

    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('resolved')
    expect(record?.resolution).toBe('contact_review_rejected')
    expect(record?.meeting_id).toBeNull()

    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()
  })

  it('el barrido de conciliación caduca una revisión vencida y resuelve la solicitud como contact_review_expired', async () => {
    const { requestId } = await createAmbiguousGuestReview(5)
    const review = await findPendingBookingReviewByBookingRequestId(requestId)
    await expireBookingReviewForTesting(review!.id as string)

    const sweep = await internalRequest('POST', '/api/booking/v1/internal/sweep')
    expect(sweep.status).toBe(200)
    expect((sweep.body as { expiredReviews: number }).expiredReviews).toBeGreaterThanOrEqual(1)

    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('resolved')
    expect(record?.resolution).toBe('contact_review_expired')

    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()
  })
})
