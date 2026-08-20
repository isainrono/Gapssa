import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { bodySchema as guestBodySchema } from './route'
import { bodySchema as authenticatedBodySchema } from './authenticated/route'

/**
 * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas: confirma que
 * un campo homónimo enviado por el navegador
 * (`cExcluirGoogleCalendarSync`/`controlledTestExcludeGcs`, el nombre real
 * en EspoCRM y el nombre del campo interno de `CreateMeetingInput`) queda
 * eliminado por el propio `z.object()` de la ruta pública — sin
 * `.passthrough()`, Zod descarta cualquier clave no declarada en el
 * esquema — antes de que el resultado llegue a `guestFlow.ts`/
 * `authenticatedFlow.ts`. El cliente NUNCA puede influir en la decisión de
 * exclusión de GCS por esta vía ni por ninguna otra (`controlledTestMode.ts`
 * la decide exclusivamente a partir de `serverEnv`).
 */

const validGuestBody = {
  idempotencyKey: randomUUID(),
  treatmentId: 'treatment-1',
  professionalId: 'professional-1',
  zoneId: 'zone-1',
  startAt: '2026-09-01T09:00:00.000Z',
  guest: { firstName: 'Ana', lastName: 'Ruiz', phone: '+34600000001', email: 'ana@example.com' },
}

const validAuthenticatedBody = {
  idempotencyKey: randomUUID(),
  treatmentId: 'treatment-1',
  professionalId: 'professional-1',
  zoneId: 'zone-1',
  startAt: '2026-09-01T09:00:00.000Z',
  contact: { firstName: 'Ana', lastName: 'Ruiz', phone: '+34600000001' },
}

describe('Puerta 5B-2A — el navegador nunca puede influir en cExcluirGoogleCalendarSync vía el body público', () => {
  it('guest bodySchema descarta cExcluirGoogleCalendarSync/controlledTestExcludeGcs homónimos sin fallar', () => {
    const parsed = guestBodySchema.parse({
      ...validGuestBody,
      cExcluirGoogleCalendarSync: true,
      controlledTestExcludeGcs: true,
    })
    expect(parsed).not.toHaveProperty('cExcluirGoogleCalendarSync')
    expect(parsed).not.toHaveProperty('controlledTestExcludeGcs')
    expect(parsed).toEqual(validGuestBody)
  })

  it('authenticated bodySchema descarta cExcluirGoogleCalendarSync/controlledTestExcludeGcs homónimos sin fallar', () => {
    const parsed = authenticatedBodySchema.parse({
      ...validAuthenticatedBody,
      cExcluirGoogleCalendarSync: true,
      controlledTestExcludeGcs: true,
    })
    expect(parsed).not.toHaveProperty('cExcluirGoogleCalendarSync')
    expect(parsed).not.toHaveProperty('controlledTestExcludeGcs')
    expect(parsed).toEqual(validAuthenticatedBody)
  })
})
