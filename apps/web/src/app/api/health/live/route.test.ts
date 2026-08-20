import { describe, expect, it } from 'vitest'

import { GET } from './route'

describe('GET /api/health/live', () => {
  it('always returns 200 "ok" without checking any dependency', async () => {
    const response = GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toEqual({ status: 'ok' })
  })
})
