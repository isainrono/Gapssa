import { describe, expect, it, vi } from 'vitest'

vi.mock('@payload-config', () => ({ default: {} }))

const countMock = vi.fn()
vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ count: countMock })),
}))

const pingRedisMock = vi.fn()
vi.mock('@/server/redis', () => ({
  pingRedis: pingRedisMock,
}))

describe('GET /api/health', () => {
  it('returns 200 "ok" with Cache-Control: no-store when both dependencies respond', async () => {
    countMock.mockResolvedValueOnce({ totalDocs: 0 })
    pingRedisMock.mockResolvedValueOnce(true)

    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toEqual({
      checks: { app: 'ok', postgresCms: 'ok', redis: 'ok' },
      status: 'ok',
    })
  })

  it('returns 503 "degraded" when Postgres fails, without leaking the error', async () => {
    countMock.mockRejectedValueOnce(new Error('connection refused to 10.0.0.5:5432 user=gapssa_apps'))
    pingRedisMock.mockResolvedValueOnce(true)

    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.json()
    const rawBody = JSON.stringify(body)

    expect(response.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks.postgresCms).toBe('error')
    expect(rawBody).not.toContain('10.0.0.5')
    expect(rawBody).not.toContain('gapssa_apps')
  })

  it('returns 503 "degraded" when Redis does not respond PONG', async () => {
    countMock.mockResolvedValueOnce({ totalDocs: 0 })
    pingRedisMock.mockResolvedValueOnce(false)

    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks.redis).toBe('error')
  })

  it('returns 503 "degraded" when Redis throws', async () => {
    countMock.mockResolvedValueOnce({ totalDocs: 0 })
    pingRedisMock.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:6380'))

    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.json()
    const rawBody = JSON.stringify(body)

    expect(response.status).toBe(503)
    expect(body.checks.redis).toBe('error')
    expect(rawBody).not.toContain('6380')
  })
})
