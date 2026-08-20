import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Revisión 4 de Fase 4B — pruebas unitarias puras (mocks) de
 * `resolveBookingReview` para los dos escenarios de `lease_lost` que no se
 * pueden reproducir de forma determinista contra Postgres real sin pausar
 * una petición HTTP a mitad de camino (el servidor de pruebas de integración
 * es un proceso `next dev` aparte, sin memoria compartida —
 * `tests/integration/bookingDb.ts`, cabecera): punto 1 (reemplazo de
 * revisión durante una reanudación que perdió su `claimToken` vigente) y
 * punto 3 (releer tras `lease_lost` en el cierre final, en vez de asumir
 * éxito ciego). El resto del ciclo de vida de `BookingReviewRecord` sigue
 * probado end-to-end contra Postgres real en
 * `tests/integration/booking.reviewTransactional.int.test.ts`.
 */

vi.mock('server-only', () => ({}))
vi.mock('../env', () => ({ serverEnv: { BOOKING_CONTACT_REVIEW_HOLD_HOURS: 5 } }))

const repositoryMock = vi.hoisted(() => ({
  claimBookingReview: vi.fn(),
  findBookingRequestById: vi.fn(),
  releaseBookingReviewToPending: vi.fn(async () => 'released' as const),
  closeBookingReviewResolved: vi.fn(),
  openBookingReviewAtomic: vi.fn(),
  findBookingReviewById: vi.fn(),
  closeBookingReviewAndResolveRequestTransactionally: vi.fn(),
  closeOrphanedBookingReviewAfterLinkedRequest: vi.fn(),
  countPendingBookingReviews: vi.fn(async () => 0),
  listActiveBookingReviewsForLinkedRequests: vi.fn(async () => []),
  listContactReviewPendingRequestsWithoutActiveReview: vi.fn(async () => []),
  listDuplicateActiveBookingReviewGroups: vi.fn(async () => []),
  listExpiredBookingReviews: vi.fn(async () => []),
  listOrphanedActiveBookingReviews: vi.fn(async () => []),
  listPendingBookingReviews: vi.fn(async () => []),
  listRequestsWithOrphanedActivePii: vi.fn(async () => []),
  listStaleProcessingBookingReviews: vi.fn(async () => []),
  purgePendingAuthenticatedContactDetails: vi.fn(async () => {}),
  purgePendingGuestIdentity: vi.fn(async () => {}),
}))
vi.mock('./repository', () => repositoryMock)

const verificationStepsMock = vi.hoisted(() => {
  class IncompatibleMeetingError extends Error {
    constructor(
      readonly bookingRequestId: string,
      readonly meetingId: string,
    ) {
      super('incompatible meeting (mock)')
      this.name = 'IncompatibleMeetingError'
    }
  }
  class ReviewLeaseLostError extends Error {
    constructor(readonly bookingRequestId: string) {
      super('review lease lost (mock)')
      this.name = 'ReviewLeaseLostError'
    }
  }
  return {
    IncompatibleMeetingError,
    ReviewLeaseLostError,
    completeBookingToMeeting: vi.fn(),
    decryptGuestIdentity: vi.fn(async () => ({ firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: '+34600000001' })),
    reconstructAuthenticatedContactDetails: vi.fn(async () => null),
  }
})
vi.mock('./verificationSteps', () => verificationStepsMock)

const { resolveBookingReview } = await import('./review')

const adapter = {
  getContactById: vi.fn(async () => ({ id: 'contact-1', gapssaAccountId: null, firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: '+34600000001' })),
} as never

const REVIEW = {
  id: 'review-1',
  bookingRequestId: 'req-1',
  conflictType: 'contact_multiple_matches' as const,
  candidateContactIds: ['contact-1'],
  candidateMeetingIds: null,
  status: 'processing' as const,
  claimToken: 'token-a',
}

const REQUEST = {
  id: 'req-1',
  status: 'contact_review_pending' as const,
  clientAccountId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  repositoryMock.claimBookingReview.mockResolvedValue({ outcome: 'claimed', review: REVIEW } as never)
  repositoryMock.findBookingRequestById.mockResolvedValue(REQUEST as never)
  repositoryMock.releaseBookingReviewToPending.mockResolvedValue('released' as never)
})

describe('resolveBookingReview — revisión 4, punto 3: lease_lost en el cierre nunca es éxito ciego', () => {
  it('closeBookingReviewResolved lease_lost + revisión releída ya resolved -> éxito real', async () => {
    verificationStepsMock.completeBookingToMeeting.mockResolvedValue({ outcome: 'meeting_created', meetingId: 'meeting-1' } as never)
    repositoryMock.findBookingRequestById
      .mockResolvedValueOnce(REQUEST as never) // primera lectura, antes de reanudar
      .mockResolvedValueOnce({ ...REQUEST, status: 'pending_approval' } as never) // confirmación tras completeBookingToMeeting
    repositoryMock.closeBookingReviewResolved.mockResolvedValue('lease_lost' as never)
    repositoryMock.findBookingReviewById.mockResolvedValue({ ...REVIEW, status: 'resolved' } as never)

    const outcome = await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(outcome).toEqual({ outcome: 'resolved', meetingId: 'meeting-1' })
  })

  it('closeBookingReviewResolved lease_lost + revisión releída replaced -> éxito real', async () => {
    verificationStepsMock.completeBookingToMeeting.mockResolvedValue({ outcome: 'meeting_created', meetingId: 'meeting-1' } as never)
    repositoryMock.findBookingRequestById.mockResolvedValueOnce(REQUEST as never).mockResolvedValueOnce({ ...REQUEST, status: 'pending_approval' } as never)
    repositoryMock.closeBookingReviewResolved.mockResolvedValue('lease_lost' as never)
    repositoryMock.findBookingReviewById.mockResolvedValue({ ...REVIEW, status: 'replaced' } as never)

    const outcome = await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(outcome).toEqual({ outcome: 'resolved', meetingId: 'meeting-1' })
  })

  it('closeBookingReviewResolved lease_lost + revisión releída sigue processing bajo otro dueño -> conciliación pendiente, nunca éxito ciego', async () => {
    verificationStepsMock.completeBookingToMeeting.mockResolvedValue({ outcome: 'meeting_created', meetingId: 'meeting-1' } as never)
    repositoryMock.findBookingRequestById.mockResolvedValueOnce(REQUEST as never).mockResolvedValueOnce({ ...REQUEST, status: 'pending_approval' } as never)
    repositoryMock.closeBookingReviewResolved.mockResolvedValue('lease_lost' as never)
    repositoryMock.findBookingReviewById.mockResolvedValue({ ...REVIEW, status: 'processing', claimToken: 'token-b' } as never)

    const outcome = await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(outcome).toEqual({ outcome: 'resolved_review_reconciliation_pending', meetingId: 'meeting-1' })
  })

  it('closeBookingReviewResolved closed -> éxito directo, sin releer', async () => {
    verificationStepsMock.completeBookingToMeeting.mockResolvedValue({ outcome: 'meeting_created', meetingId: 'meeting-1' } as never)
    repositoryMock.findBookingRequestById.mockResolvedValueOnce(REQUEST as never).mockResolvedValueOnce({ ...REQUEST, status: 'pending_approval' } as never)
    repositoryMock.closeBookingReviewResolved.mockResolvedValue('closed' as never)

    const outcome = await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(outcome).toEqual({ outcome: 'resolved', meetingId: 'meeting-1' })
    expect(repositoryMock.findBookingReviewById).not.toHaveBeenCalled()
  })
})

describe('resolveBookingReview — revisión 4, punto 1: reemplazo protegido por claimToken', () => {
  it('IncompatibleMeetingError + openBookingReviewAtomic lease_lost -> review_lease_lost, nunca libera un claim que ya no es suyo', async () => {
    verificationStepsMock.completeBookingToMeeting.mockRejectedValue(new verificationStepsMock.IncompatibleMeetingError('req-1', 'meeting-x'))
    repositoryMock.openBookingReviewAtomic.mockResolvedValue({ outcome: 'lease_lost' } as never)

    const outcome = await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(outcome).toEqual({ outcome: 'review_lease_lost' })
    expect(repositoryMock.releaseBookingReviewToPending).not.toHaveBeenCalled()
    expect(repositoryMock.openBookingReviewAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ replaces: { reviewId: 'review-1', claimToken: 'token-a' } }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  it('IncompatibleMeetingError + reemplazo válido (claimToken vigente) -> incompatible_meeting, propagando el claimToken', async () => {
    verificationStepsMock.completeBookingToMeeting.mockRejectedValue(new verificationStepsMock.IncompatibleMeetingError('req-1', 'meeting-x'))
    repositoryMock.openBookingReviewAtomic.mockResolvedValue({ outcome: 'opened', review: { id: 'review-2' } } as never)

    const outcome = await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(outcome).toEqual({ outcome: 'incompatible_meeting' })
    expect(repositoryMock.releaseBookingReviewToPending).not.toHaveBeenCalled()
  })

  it('ReviewLeaseLostError propagada desde completeBookingToMeeting (otro conflicto durante la reanudación, claim ya ajeno) -> review_lease_lost', async () => {
    verificationStepsMock.completeBookingToMeeting.mockRejectedValue(new verificationStepsMock.ReviewLeaseLostError('req-1'))

    const outcome = await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(outcome).toEqual({ outcome: 'review_lease_lost' })
    expect(repositoryMock.releaseBookingReviewToPending).not.toHaveBeenCalled()
  })

  it('completeBookingToMeeting recibe el claimToken exacto del claim propio, nunca solo el reviewId', async () => {
    verificationStepsMock.completeBookingToMeeting.mockResolvedValue({ outcome: 'meeting_created', meetingId: 'meeting-1' } as never)
    repositoryMock.findBookingRequestById.mockResolvedValueOnce(REQUEST as never).mockResolvedValueOnce({ ...REQUEST, status: 'pending_approval' } as never)
    repositoryMock.closeBookingReviewResolved.mockResolvedValue('closed' as never)

    await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(verificationStepsMock.completeBookingToMeeting).toHaveBeenCalledWith(
      adapter,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ replaces: { reviewId: 'review-1', claimToken: 'token-a' } }),
    )
  })

  it('fallo transitorio genérico (ni IncompatibleMeetingError ni ReviewLeaseLostError) sigue liberando el claim a pending', async () => {
    verificationStepsMock.completeBookingToMeeting.mockRejectedValue(new Error('EspoCRM caído'))

    const outcome = await resolveBookingReview(adapter, 'review-1', 'contact-1', 'operador-1')

    expect(outcome).toEqual({ outcome: 'transient_failure' })
    expect(repositoryMock.releaseBookingReviewToPending).toHaveBeenCalledWith('review-1', 'token-a')
  })
})
