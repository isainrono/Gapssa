import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { evaluateContactAdoption, SimulatedEspoBookingAdapter } = await import('./espoAdapter')

/**
 * Fase 4B, revisión 2, punto 2 — decisión pura de si un Meeting
 * PREEXISTENTE puede adoptarse para el Contact esperado de una solicitud.
 * Nunca indexa `contactIds[0]` — estas pruebas cubren exactamente la
 * matriz exigida: Contact correcto / ausente / dos Contacts / distinto.
 */
describe('evaluateContactAdoption', () => {
  it('Meeting con exactamente el Contact esperado -> compatible', () => {
    const result = evaluateContactAdoption({ contactIds: ['contact-1'], expectedContactId: 'contact-1' })
    expect(result).toEqual({ outcome: 'compatible' })
  })

  it('Meeting sin ningún Contact relacionado -> missing (revisión manual, nunca se inventa la relación)', () => {
    const result = evaluateContactAdoption({ contactIds: [], expectedContactId: 'contact-1' })
    expect(result).toEqual({ outcome: 'missing' })
  })

  it('Meeting con dos Contacts relacionados -> multiple (revisión manual, nunca se elige el primero)', () => {
    const result = evaluateContactAdoption({ contactIds: ['contact-1', 'contact-2'], expectedContactId: 'contact-1' })
    expect(result).toEqual({ outcome: 'multiple' })
  })

  it('Meeting con dos Contacts relacionados sigue siendo multiple aunque uno de ellos sea el esperado', () => {
    // La multiplicidad en sí ya es el conflicto — nunca se "acepta" porque
    // el esperado esté entre los candidatos.
    const result = evaluateContactAdoption({ contactIds: ['contact-2', 'contact-1'], expectedContactId: 'contact-1' })
    expect(result).toEqual({ outcome: 'multiple' })
  })

  it('Meeting con exactamente un Contact, pero distinto del esperado -> mismatch, con el id real', () => {
    const result = evaluateContactAdoption({ contactIds: ['contact-9'], expectedContactId: 'contact-1' })
    expect(result).toEqual({ outcome: 'mismatch', actualContactId: 'contact-9' })
  })
})

/**
 * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas: defensa en
 * profundidad. `serverEnv` ya impide, al arrancar el proceso, que
 * `ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true` conviva con
 * `ESPO_BOOKING_ADAPTER=simulated` (`env.test.ts`) — esta prueba confirma
 * que, aun así, `SimulatedEspoBookingAdapter` nunca fabrica un
 * `cExcluirGoogleCalendarSync=true` que no significaría nada real (no
 * habla con GCS). El guardia corre ANTES de tocar la base de datos — un
 * `db` nunca usado es suficiente para esta prueba.
 */
describe('SimulatedEspoBookingAdapter.createMeeting — Puerta 5B-2A, defensa en profundidad', () => {
  it('lanza si se le pide controlledTestExcludeGcs=true, sin tocar la base de datos', async () => {
    const untouchedDb = {} as never
    const adapter = new SimulatedEspoBookingAdapter(untouchedDb)
    await expect(
      adapter.createMeeting({
        bookingRequestId: 'req-1',
        contactId: 'contact-1',
        treatmentId: 'treatment-1',
        professionalId: 'professional-1',
        zoneId: 'zone-1',
        startAt: new Date('2026-09-01T09:00:00.000Z'),
        endAt: new Date('2026-09-01T10:00:00.000Z'),
        controlledTestExcludeGcs: true,
      }),
    ).rejects.toThrow(/controlledTestExcludeGcs/)
  })
})
