import { describe, expect, it } from 'vitest'

import { getZonedWeekday, zonedTimeToUtc } from './timezone'

describe('zonedTimeToUtc', () => {
  it('converts 09:00 Madrid local time to UTC correctly in summer (CEST, UTC+2)', () => {
    expect(zonedTimeToUtc(2026, 9, 7, 9, 0, 'Europe/Madrid').toISOString()).toBe('2026-09-07T07:00:00.000Z')
  })

  it('converts 21:00 Madrid local time to UTC correctly in summer (CEST, UTC+2)', () => {
    expect(zonedTimeToUtc(2026, 9, 7, 21, 0, 'Europe/Madrid').toISOString()).toBe('2026-09-07T19:00:00.000Z')
  })

  it('converts 09:00 Madrid local time to UTC correctly in winter (CET, UTC+1)', () => {
    expect(zonedTimeToUtc(2027, 1, 15, 9, 0, 'Europe/Madrid').toISOString()).toBe('2027-01-15T08:00:00.000Z')
  })

  it('converts 21:00 Madrid local time to UTC correctly in winter (CET, UTC+1)', () => {
    expect(zonedTimeToUtc(2027, 1, 15, 21, 0, 'Europe/Madrid').toISOString()).toBe('2027-01-15T20:00:00.000Z')
  })

  it('round-trips through getZonedWeekday: a UTC instant for 09:00 Madrid on a known Monday reports weekday 1', () => {
    // 2026-09-07 es lunes.
    const instant = zonedTimeToUtc(2026, 9, 7, 9, 0, 'Europe/Madrid')
    expect(getZonedWeekday(instant, 'Europe/Madrid')).toBe(1)
  })
})
