import { randomUUID } from 'node:crypto'

import { describe, expect, inject, it } from 'vitest'

import { bookingApi, CookieJar, getLatestOtpCodeForEmail, visitPage } from './bookingClient'
import {
  attemptReplaceBookingReviewWithToken,
  auditRowsForBookingEntity,
  findBookingRequestRow,
  findBookingReviewRowById,
  findPendingGuestIdentityStatus,
  forceBookingReviewProcessing,
  forceBookingRequestLinkedForTesting,
  forceBookingRequestResolvedForTesting,
  insertSimEspoContactForTesting,
  insertSimEspoMeetingForTesting,
  listBookingReviewRowsForRequest,
} from './bookingDb'

/**
 * Revisión 4 de Fase 4B — muy acotada a propiedad del lease y conciliación
 * posterior al éxito (docs/fase4b-revision-4.md):
 *
 *   1. Reemplazo de una revisión (`openBookingReviewAtomic` con `replaces`)
 *      protegido por `claimToken`, nunca solo por `reviewId`.
 *   2. Barrido cierra revisiones huérfanas cuya solicitud ya demuestra un
 *      resultado durable de éxito (Meeting vinculado).
 *   4. Purga segura de PII heredada en solicitudes ya resueltas por otra
 *      vía, incluso dentro del cierre transaccional de rechazo/caducidad.
 *
 * El punto 3 (releer tras `lease_lost` en el cierre final en vez de asumir
 * éxito ciego) y la mitad "A pierde el lease, B reclama" del punto 1 se
 * prueban con mocks puros en `src/server/booking/review.test.ts` — el
 * servidor bajo prueba aquí es un proceso `next dev` aparte (mismo motivo
 * documentado en `bookingDb.ts`), así que no hay forma de pausar una
 * reanudación real a mitad de camino para robarle el lease en el instante
 * exacto.
 */

const TREATMENT_ID = 'treatment-masaje-relajante-60'
const ZONE_ID = 'zone-cabina-2'
const PROFESSIONAL_ID = 'professional-owner'
const INTERNAL_SECRET = process.env.BOOKING_INTERNAL_API_SECRET as string

/** 20:00 UTC — franja propia, libre de colisiones con el resto de la suite (10:00/16:00/18:00 ya en uso, ver otros ficheros de integración). */
function nextBusinessDayAt20Utc(n: number): string {
  const date = new Date()
  date.setUTCHours(20, 0, 0, 0)
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

/** Mismo generador que `booking.reviewTransactional.int.test.ts` — invitado con correo/teléfono apuntando a Contacts distintos, nunca se fusiona. */
async function createAmbiguousGuestRequest(dayOffset: number) {
  const unique = randomUUID()
  const digits = String(Date.now()).slice(-6) + String(dayOffset).padStart(2, '0')
  const emailContactId = await insertSimEspoContactForTesting({
    firstName: 'ContactoCorreo',
    lastName: 'Uno',
    email: `revrec-email-${unique}@example.test`,
    phone: `+3464${digits}1`,
  })
  const phoneContactId = await insertSimEspoContactForTesting({
    firstName: 'ContactoTelefono',
    lastName: 'Dos',
    email: `revrec-other-${unique}@example.test`,
    phone: `+3465${digits}2`,
  })

  const guest = {
    firstName: 'Revision',
    lastName: 'Conciliacion',
    email: `revrec-email-${unique}@example.test`,
    phone: `+3465${digits}2`,
  }

  const jar = await freshJarWithCsrf()
  const startAt = nextBusinessDayAt20Utc(dayOffset)
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

/** Ningún valor de auditoría (previousValue/newValue/reasonCode/etc.) puede contener el claimToken, PII, ni ningún id de candidato ajeno al vocabulario cerrado de enums/ids opacos — mismo principio que `RAW_VALUE_VALIDATORS` (audit.ts), comprobado aquí contra las filas reales insertadas. */
function assertAuditRowNeverLeaks(row: Record<string, unknown>, forbidden: string[]) {
  const serialized = JSON.stringify(row)
  for (const secret of forbidden) {
    expect(serialized.includes(secret)).toBe(false)
  }
}

describe('punto 1 — reemplazo de revisión protegido por claimToken (CAS contra Postgres real)', () => {
  it('token vigente + lease vigente -> reemplaza (1 fila); la revisión queda replaced', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(30)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    const claimToken = randomUUID()
    await forceBookingReviewProcessing(review.id as string, { claimToken, leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) })

    const affected = await attemptReplaceBookingReviewWithToken(review.id as string, claimToken)
    expect(affected).toBe(1)

    const after = await findBookingReviewRowById(review.id as string)
    expect(after?.status).toBe('replaced')
  })

  it('token OBSOLETO (otro worker ya reclamó con uno nuevo) -> lease_lost (0 filas), la revisión ajena no se toca', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(31)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    const staleTokenA = randomUUID()
    const freshTokenB = randomUUID()
    // Worker A reclamó con staleTokenA; su lease venció y worker B reclamó
    // de nuevo con freshTokenB — el estado final observable es "processing
    // con el token de B, lease vigente de B".
    await forceBookingReviewProcessing(review.id as string, { claimToken: freshTokenB, leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) })

    // A intenta reemplazar usando el id correcto pero SU token antiguo.
    const affected = await attemptReplaceBookingReviewWithToken(review.id as string, staleTokenA)
    expect(affected).toBe(0)

    // B conserva su revisión processing intacta — ninguna fila se modificó.
    const after = await findBookingReviewRowById(review.id as string)
    expect(after?.status).toBe('processing')
    expect(after?.claim_token).toBe(freshTokenB)
  })

  it('token correcto pero LEASE VENCIDO -> lease_lost (0 filas) — el lease vencido nunca autoriza un reemplazo directo', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(32)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    const claimToken = randomUUID()
    await forceBookingReviewProcessing(review.id as string, { claimToken, leaseExpiresAt: new Date(Date.now() - 60 * 1000) })

    const affected = await attemptReplaceBookingReviewWithToken(review.id as string, claimToken)
    expect(affected).toBe(0)

    const after = await findBookingReviewRowById(review.id as string)
    expect(after?.status).toBe('processing')
  })
})

describe('punto 1 — propietario vigente reemplaza correctamente (end-to-end HTTP, sin robo de lease)', () => {
  it('la reanudación topa con OTRO conflicto real (meeting_contact_mismatch) -> reemplaza atómicamente con el claimToken propio del claim en curso', async () => {
    const { requestId, accessToken, code, emailContactId } = await createAmbiguousGuestRequest(33)
    await verifyOnce(requestId, accessToken, code)
    const rowsBefore = await listBookingReviewRowsForRequest(requestId)
    const originalReview = rowsBefore.find((row) => row.status === 'pending')!

    // Ya existe un Meeting compatible en horario/tratamiento/profesional/
    // zona para este bookingRequestId, pero vinculado a un Contact AJENO al
    // que el operador va a elegir al resolver — el único conflicto de
    // Meeting alcanzable durante una reanudación sin violar el índice único
    // de sim_espo_meetings (booking_request_id).
    const requestRow = await findBookingRequestRow(requestId)
    const unrelatedContactId = await insertSimEspoContactForTesting({
      firstName: 'Ajeno',
      lastName: 'AlReemplazo',
      email: `revrec-unrelated-${randomUUID()}@example.test`,
      phone: '+34600222333',
    })
    await insertSimEspoMeetingForTesting({
      bookingRequestId: requestId,
      treatmentId: requestRow!.treatment_id as string,
      professionalId: requestRow!.professional_id as string,
      zoneId: requestRow!.zone_id as string,
      startAt: requestRow!.start_at as string,
      endAt: requestRow!.end_at as string,
      contactId: unrelatedContactId,
    })

    const resolve = await internalRequest('POST', `/api/booking/v1/internal/reviews/${originalReview.id as string}/resolve`, {
      resolutionContactId: emailContactId,
      resolvedBy: 'operador-test',
    })
    expect(resolve.status).toBe(200)
    expect(resolve.body).toEqual({ status: 'still_pending_review' })

    const rowsAfter = await listBookingReviewRowsForRequest(requestId)
    const active = rowsAfter.filter((row) => row.status === 'pending' || row.status === 'processing')
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ conflict_type: 'meeting_contact_mismatch', candidate_contact_ids: [unrelatedContactId] })

    const replacedOriginal = rowsAfter.find((row) => row.id === originalReview.id)
    expect(replacedOriginal?.status).toBe('replaced')

    // La solicitud sigue contact_review_pending — nunca flotante ni con dos revisiones activas.
    const record = await findBookingRequestRow(requestId)
    expect(record?.status).toBe('contact_review_pending')

    // Ninguna auditoría de esta secuencia contiene el claimToken usado
    // internamente, ni el correo/teléfono/nombre de ningún Contact.
    const reviewAuditRows = [
      ...(await auditRowsForBookingEntity('BookingReviewRecord', originalReview.id as string)),
      ...(await auditRowsForBookingEntity('BookingReviewRecord', active[0]!.id as string)),
    ]
    expect(reviewAuditRows.length).toBeGreaterThan(0)
    for (const row of reviewAuditRows) {
      assertAuditRowNeverLeaks(row, ['ContactoCorreo', 'ContactoTelefono', 'Ajeno', '@example.test', '+34'])
    }
  })
})

describe('punto 2 — barrido cierra revisiones huérfanas tras un resultado durable de éxito', () => {
  it('meetingId vinculado + pending_approval, revisión sigue pending (crash antes de cerrarla) -> el barrido la resuelve y purga la PII pendiente', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(34)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    // Simula: completeBookingToMeeting ya escribió meetingId + pending_approval
    // (resultado durable), pero el proceso cayó ANTES de purgar la PII y
    // ANTES de cerrar la revisión — exactamente la ventana que los puntos 2
    // y 4 cubren juntos en la misma pasada del barrido.
    expect(await findPendingGuestIdentityStatus(requestId)).toBe('active')
    const fakeMeetingId = randomUUID()
    await forceBookingRequestLinkedForTesting(requestId, { meetingId: fakeMeetingId, status: 'pending_approval' })

    const sweep = await internalRequest('POST', '/api/booking/v1/internal/sweep')
    expect(sweep.status).toBe(200)
    expect((sweep.body as { reconciledCompletedReviews: number }).reconciledCompletedReviews).toBeGreaterThanOrEqual(1)
    expect((sweep.body as { purgedGuestIdentities: Record<string, number> }).purgedGuestIdentities.meeting_linked).toBeGreaterThanOrEqual(1)

    const reviewAfter = await findBookingReviewRowById(review.id as string)
    expect(reviewAfter?.status).toBe('resolved')
    expect(reviewAfter?.resolution_contact_id).toBeNull()

    // Ninguna revisión activa queda indefinidamente tras el Meeting vinculado.
    const activeAfter = (await listBookingReviewRowsForRequest(requestId)).filter((row) => row.status === 'pending' || row.status === 'processing')
    expect(activeAfter).toHaveLength(0)

    // La PII, huérfana tras el resultado durable, también quedó purgada en la misma pasada.
    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()

    const auditRows = await auditRowsForBookingEntity('BookingReviewRecord', review.id as string)
    const reconciledEntry = auditRows.find((row) => row.new_value === 'resolved')
    expect(reconciledEntry).toMatchObject({ reason_code: 'ContactReviewReconciledAfterBookingLinked' })
    for (const row of auditRows) {
      assertAuditRowNeverLeaks(row, [fakeMeetingId])
    }
  })

  it('meetingId vinculado + status resolved (crash tras la decisión final, antes de cerrar la revisión) -> el barrido igual cierra la revisión, sin requerir que la PII ya esté purgada', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(35)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    const fakeMeetingId = randomUUID()
    await forceBookingRequestLinkedForTesting(requestId, { meetingId: fakeMeetingId, status: 'resolved' })
    // La PII se deja `active` a propósito en este caso concreto no importa —
    // lo que este test aísla es que el cierre de la revisión NUNCA depende
    // de que la PII ya esté purgada (puede haberlo estado, o no).

    const sweep = await internalRequest('POST', '/api/booking/v1/internal/sweep')
    expect(sweep.status).toBe(200)

    const reviewAfter = await findBookingReviewRowById(review.id as string)
    expect(reviewAfter?.status).toBe('resolved')
  })

  it('revisión processing con lease VIGENTE -> el barrido nunca se la arrebata a un worker activo, aunque el meeting ya esté vinculado', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(36)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    const claimToken = randomUUID()
    await forceBookingReviewProcessing(review.id as string, { claimToken, leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) })
    await forceBookingRequestLinkedForTesting(requestId, { meetingId: randomUUID(), status: 'pending_approval' })

    await internalRequest('POST', '/api/booking/v1/internal/sweep')

    const reviewAfter = await findBookingReviewRowById(review.id as string)
    expect(reviewAfter?.status).toBe('processing')
    expect(reviewAfter?.claim_token).toBe(claimToken)
  })

  it('barridos concurrentes convergen — nunca duplica el cierre ni la auditoría', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(37)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    await forceBookingRequestLinkedForTesting(requestId, { meetingId: randomUUID(), status: 'pending_approval' })

    const [sweepA, sweepB] = await Promise.all([internalRequest('POST', '/api/booking/v1/internal/sweep'), internalRequest('POST', '/api/booking/v1/internal/sweep')])
    expect(sweepA.status).toBe(200)
    expect(sweepB.status).toBe(200)

    const reviewAfter = await findBookingReviewRowById(review.id as string)
    expect(reviewAfter?.status).toBe('resolved')

    const auditRows = await auditRowsForBookingEntity('BookingReviewRecord', review.id as string)
    const reconciledEntries = auditRows.filter((row) => row.new_value === 'resolved' && row.reason_code === 'ContactReviewReconciledAfterBookingLinked')
    expect(reconciledEntries).toHaveLength(1)
  })
})

describe('punto 4 — purga segura de PII heredada de una solicitud ya resuelta', () => {
  it('solicitud resolved (contact_review_rejected) heredada, sin meetingId, con PII activa -> el barrido la purga con el disparador real (review_rejected), audita PendingGuestIdentity', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(38)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    // Simula una solicitud resuelta como `contact_review_rejected` por una
    // vía heredada/ajena que olvidó purgar la PII — la revisión sigue
    // activa (huérfana, cubierta por separado en `countReviewInconsistencies`),
    // aquí se aísla solo la purga de PII.
    await forceBookingRequestResolvedForTesting(requestId, { resolution: 'contact_review_rejected' })
    expect(await findPendingGuestIdentityStatus(requestId)).toBe('active')

    const sweep = await internalRequest('POST', '/api/booking/v1/internal/sweep')
    expect(sweep.status).toBe(200)
    const purged = (sweep.body as { purgedGuestIdentities: Record<string, number> }).purgedGuestIdentities
    expect(purged.review_rejected).toBeGreaterThanOrEqual(1)

    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()

    const auditRows = await auditRowsForBookingEntity('PendingGuestIdentity', requestId)
    const purgeEntry = auditRows.find((row) => row.new_value === 'discarded')
    expect(purgeEntry).toMatchObject({ reason_code: 'ContactReviewRejectedByStaff' })
    for (const row of auditRows) {
      assertAuditRowNeverLeaks(row, ['ContactoCorreo', 'ContactoTelefono'])
    }

    // La revisión, huérfana pero sin meetingId ni resultado de éxito, no la
    // toca este barrido (fuera del alcance de `reconcileReviewsForLinkedBookings`)
    // — solo se reporta como inconsistencia, nunca se decide por su cuenta.
    const reviewAfter = await findBookingReviewRowById(review.id as string)
    expect(reviewAfter?.status).toBe('pending')
  })

  it('rechazo manual de una revisión cuya solicitud YA estaba resuelta por otra vía (verification_expired) -> purga con el disparador REAL, nunca el que el rechazo pedía', async () => {
    const { requestId, accessToken, code } = await createAmbiguousGuestRequest(39)
    await verifyOnce(requestId, accessToken, code)
    const rows = await listBookingReviewRowsForRequest(requestId)
    const review = rows.find((row) => row.status === 'pending')!

    // La solicitud ya quedó `resolved` como `verification_expired` por una
    // vía ajena (p. ej. el barrido de expiración de verificación de otra
    // pasada) mientras la revisión seguía `pending` — un estado heredado
    // inconsistente, nunca alcanzable por el propio flujo de este módulo.
    await forceBookingRequestResolvedForTesting(requestId, { resolution: 'verification_expired' })

    const reject = await internalRequest('POST', `/api/booking/v1/internal/reviews/${review.id as string}/reject`, { rejectedBy: 'operador-test' })
    expect(reject.status).toBe(200)
    expect(reject.body).toEqual({ status: 'rejected' })

    // La revisión SÍ se cierra (rejected) — nunca queda sin salida.
    const reviewAfter = await findBookingReviewRowById(review.id as string)
    expect(reviewAfter?.status).toBe('rejected')

    // La solicitud SIGUE con su resolución REAL (verification_expired) —
    // resolveBookingRequestWithinTx nunca la sobrescribe con contact_review_rejected.
    const record = await findBookingRequestRow(requestId)
    expect(record?.resolution).toBe('verification_expired')

    // La PII se purgó con el disparador que corresponde al estado REAL
    // (verification_expired), nunca al que el rechazo manual pedía
    // (review_rejected) — decidePendingGuestIdentityPurgeTrigger decide,
    // nunca se asume a ciegas.
    expect(await findPendingGuestIdentityStatus(requestId)).toBeNull()
    const auditRows = await auditRowsForBookingEntity('PendingGuestIdentity', requestId)
    const purgeEntry = auditRows.find((row) => row.new_value === 'discarded')
    expect(purgeEntry).toMatchObject({ reason_code: 'VerificationExpired' })
  })
})
