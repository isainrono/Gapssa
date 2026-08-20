import { describe, expect, it } from 'vitest'

import { parseServerEnv } from './env'

const validEnv = {
  PAYLOAD_SECRET: 'a'.repeat(32),
  DATABASE_URL_CMS: 'postgresql://user:pass@localhost:5433/gapssa_cms',
  DATABASE_URL_AUTH: 'postgresql://user:pass@localhost:5433/gapssa_auth',
  DATABASE_URL_BOOKING: 'postgresql://user:pass@localhost:5433/gapssa_booking',
  REDIS_URL: 'redis://:pass@localhost:6380',
  REDIS_KEY_PREFIX: 'gapssa:test:',
  OTP_HMAC_SECRET: 'b'.repeat(32),
  AUTH_RATE_LIMIT_HMAC_SECRET: 'c'.repeat(32),
  BOOKING_FIELD_ENCRYPTION_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }),
  BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
  BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: JSON.stringify({ v1: 'd'.repeat(32) }),
  BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION: 'v1',
  BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: JSON.stringify({ v1: 'e'.repeat(32) }),
  BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION: 'v1',
  BOOKING_INTERNAL_API_SECRET: 'f'.repeat(32),
  BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: JSON.stringify({ v1: 'g'.repeat(32) }),
  BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION: 'v1',
}

const FASE3_DEFAULTS = {
  OTP_TTL_MINUTES: 10,
  OTP_MAX_ATTEMPTS: 5,
  OTP_LOCKOUT_MINUTES: 15,
  OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR: 5,
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: 20,
  AUTH_SESSION_ABSOLUTE_TTL_DAYS: 30,
  AUTH_PASSWORD_RESET_SESSION_MINUTES: 10,
  AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR: 10,
  AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR: 30,
  AUTH_LOGIN_LOCKOUT_MINUTES: 15,
  ARGON2_MEMORY_COST_KIB: 19_456,
  ARGON2_TIME_COST: 2,
  ARGON2_PARALLELISM: 1,
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM_EMAIL: 'reservas@gapssa.es',
  TRUSTED_PROXY_HOP_COUNT: 1,
}

const FASE4A_DEFAULTS = {
  BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES: 30,
  BOOKING_BUSINESS_DAYS: [1, 2, 3, 4, 5, 6],
  BOOKING_OPEN_TIME: '09:00',
  BOOKING_CLOSE_TIME: '21:00',
  BOOKING_SLOT_GRANULARITY_MINUTES: 15,
  BOOKING_MAX_SLOTS_PER_QUERY: 40,
  BOOKING_REQUEST_MAX_PER_IP_PER_HOUR: 20,
  BOOKING_VERIFY_MAX_PER_IP_PER_HOUR: 30,
  BOOKING_AVAILABILITY_MAX_PER_IP_PER_HOUR: 120,
}

const FASE4B_DEFAULTS = {
  ESPO_BOOKING_ADAPTER: 'simulated',
  ESPOCRM_API_TIMEOUT_MS: 8000,
  ESPOCRM_API_MAX_RETRIES: 2,
  ESPOCRM_API_RETRY_BASE_DELAY_MS: 200,
  ESPOCRM_API_MAX_RESPONSE_BYTES: 2_000_000,
  ESPOCRM_PROFESSIONAL_USER_IDS: [],
  // Revisión 3 de Fase 4B, punto 7: 5h, no 72h — ver env.ts.
  BOOKING_CONTACT_REVIEW_HOLD_HOURS: 5,
}

const PUERTA5B2A_DEFAULTS = {
  ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: false,
}

describe('parseServerEnv', () => {
  it('accepts a valid configuration, including the Payload-specific variables', () => {
    const result = parseServerEnv(validEnv)
    expect(result).toEqual({
      ...validEnv,
      SITE_NOINDEX: false,
      ...FASE3_DEFAULTS,
      ...FASE4A_DEFAULTS,
      ...FASE4B_DEFAULTS,
      ...PUERTA5B2A_DEFAULTS,
      BOOKING_FIELD_ENCRYPTION_KEYS: { v1: Buffer.alloc(32, 7).toString('base64') },
      BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: { v1: 'd'.repeat(32) },
      BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: { v1: 'e'.repeat(32) },
      BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: { v1: 'g'.repeat(32) },
    })
  })

  it('SITE_NOINDEX defaults to false and only "true" turns it on', () => {
    expect(parseServerEnv(validEnv).SITE_NOINDEX).toBe(false)
    expect(parseServerEnv({ ...validEnv, SITE_NOINDEX: 'true' }).SITE_NOINDEX).toBe(true)
    expect(parseServerEnv({ ...validEnv, SITE_NOINDEX: 'yes' }).SITE_NOINDEX).toBe(false)
  })

  it('rejects a missing REDIS_URL', () => {
    const { REDIS_URL: _omit, ...rest } = validEnv
    expect(() => parseServerEnv(rest)).toThrow()
  })

  it('rejects an empty REDIS_KEY_PREFIX', () => {
    expect(() => parseServerEnv({ ...validEnv, REDIS_KEY_PREFIX: '' })).toThrow()
  })

  it('rejects an invalid DATABASE_URL_BOOKING', () => {
    expect(() => parseServerEnv({ ...validEnv, DATABASE_URL_BOOKING: 'not-a-url' })).toThrow()
  })

  it('still enforces the Payload-specific validation (missing PAYLOAD_SECRET)', () => {
    const { PAYLOAD_SECRET: _omit, ...rest } = validEnv
    expect(() => parseServerEnv(rest)).toThrow()
  })

  it('rejects a missing OTP_HMAC_SECRET (no development fallback allowed)', () => {
    const { OTP_HMAC_SECRET: _omit, ...rest } = validEnv
    expect(() => parseServerEnv(rest)).toThrow()
  })

  it('rejects an OTP_HMAC_SECRET shorter than 32 characters', () => {
    expect(() => parseServerEnv({ ...validEnv, OTP_HMAC_SECRET: 'too-short' })).toThrow()
  })

  it('rejects a missing AUTH_RATE_LIMIT_HMAC_SECRET (no development fallback allowed, and no fallback to OTP_HMAC_SECRET)', () => {
    const { AUTH_RATE_LIMIT_HMAC_SECRET: _omit, ...rest } = validEnv
    expect(() => parseServerEnv(rest)).toThrow()
  })

  it('rejects an AUTH_RATE_LIMIT_HMAC_SECRET shorter than 32 characters', () => {
    expect(() => parseServerEnv({ ...validEnv, AUTH_RATE_LIMIT_HMAC_SECRET: 'too-short' })).toThrow()
  })

  it('TRUSTED_PROXY_HOP_COUNT defaults to 1 and is overridable, but rejects a negative value', () => {
    expect(parseServerEnv(validEnv).TRUSTED_PROXY_HOP_COUNT).toBe(1)
    expect(parseServerEnv({ ...validEnv, TRUSTED_PROXY_HOP_COUNT: '2' }).TRUSTED_PROXY_HOP_COUNT).toBe(2)
    expect(parseServerEnv({ ...validEnv, TRUSTED_PROXY_HOP_COUNT: '0' }).TRUSTED_PROXY_HOP_COUNT).toBe(0)
    expect(() => parseServerEnv({ ...validEnv, TRUSTED_PROXY_HOP_COUNT: '-1' })).toThrow()
  })

  it('all Fase 3 tuning values fall back to the documented technical defaults when unset', () => {
    const result = parseServerEnv(validEnv)
    for (const [key, value] of Object.entries(FASE3_DEFAULTS)) {
      expect(result[key as keyof typeof result]).toBe(value)
    }
  })

  it('Fase 3 tuning values are overridable via environment variables', () => {
    const result = parseServerEnv({
      ...validEnv,
      OTP_TTL_MINUTES: '15',
      AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR: '50',
      SMTP_HOST: 'smtp.gapssa.es',
      SMTP_SECURE: 'true',
      SMTP_FROM_EMAIL: 'hola@gapssa.es',
    })
    expect(result.OTP_TTL_MINUTES).toBe(15)
    expect(result.AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR).toBe(50)
    expect(result.SMTP_HOST).toBe('smtp.gapssa.es')
    expect(result.SMTP_SECURE).toBe(true)
    expect(result.SMTP_FROM_EMAIL).toBe('hola@gapssa.es')
  })

  it('SMTP_SECURE only "true" turns it on, same rule as SITE_NOINDEX', () => {
    expect(parseServerEnv({ ...validEnv, SMTP_SECURE: 'yes' }).SMTP_SECURE).toBe(false)
  })

  it('all Fase 4A tuning values fall back to the documented technical defaults when unset', () => {
    const result = parseServerEnv(validEnv)
    for (const [key, value] of Object.entries(FASE4A_DEFAULTS)) {
      expect(result[key as keyof typeof result]).toEqual(value)
    }
  })

  it('Fase 4A tuning values are overridable via environment variables', () => {
    const result = parseServerEnv({
      ...validEnv,
      BOOKING_BUSINESS_DAYS: '1,2,3',
      BOOKING_OPEN_TIME: '10:00',
      BOOKING_CLOSE_TIME: '18:00',
      BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES: '45',
    })
    expect(result.BOOKING_BUSINESS_DAYS).toEqual([1, 2, 3])
    expect(result.BOOKING_OPEN_TIME).toBe('10:00')
    expect(result.BOOKING_CLOSE_TIME).toBe('18:00')
    expect(result.BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES).toBe(45)
  })

  it('BOOKING_CONTACT_REVIEW_HOLD_HOURS defaults to 5h and is overridable within the APPROVAL_HOLD_HOURS cap', () => {
    expect(parseServerEnv(validEnv).BOOKING_CONTACT_REVIEW_HOLD_HOURS).toBe(5)
    expect(parseServerEnv({ ...validEnv, BOOKING_CONTACT_REVIEW_HOLD_HOURS: '3' }).BOOKING_CONTACT_REVIEW_HOLD_HOURS).toBe(3)
    expect(parseServerEnv({ ...validEnv, BOOKING_CONTACT_REVIEW_HOLD_HOURS: '5' }).BOOKING_CONTACT_REVIEW_HOLD_HOURS).toBe(5)
  })

  it('revisión 3 de Fase 4B, punto 7: BOOKING_CONTACT_REVIEW_HOLD_HOURS nunca puede superar APPROVAL_HOLD_HOURS (5h) sin una decisión de negocio explícita', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_CONTACT_REVIEW_HOLD_HOURS: '6' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_CONTACT_REVIEW_HOLD_HOURS: '72' })).toThrow()
  })

  it('rejects a missing BOOKING_FIELD_ENCRYPTION_KEYS / BOOKING_EMAIL_LOOKUP_HMAC_SECRETS(+ACTIVE_KEY_VERSION) / BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS(+ACTIVE_KEY_VERSION) / BOOKING_INTERNAL_API_SECRET / BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS(+ACTIVE_KEY_VERSION) (no development fallback allowed)', () => {
    for (const key of [
      'BOOKING_FIELD_ENCRYPTION_KEYS',
      'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS',
      'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION',
      'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS',
      'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION',
      'BOOKING_INTERNAL_API_SECRET',
      'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS',
      'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION',
    ] as const) {
      const rest = { ...validEnv }
      delete rest[key]
      expect(() => parseServerEnv(rest)).toThrow()
    }
  })

  it('rejects a BOOKING_INTERNAL_API_SECRET shorter than 32 characters (no silent fallback)', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_INTERNAL_API_SECRET: 'too-short' })).toThrow()
  })

  it('the old singular BOOKING_EMAIL_LOOKUP_HMAC_SECRET / BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET names are not recognized by the schema — presence alone never satisfies the plural/versioned requirement', () => {
    const rest = { ...validEnv } as Record<string, string>
    delete rest.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS
    delete rest.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS
    rest.BOOKING_EMAIL_LOOKUP_HMAC_SECRET = 'd'.repeat(32)
    rest.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET = 'e'.repeat(32)
    expect(() => parseServerEnv(rest)).toThrow()
  })

  it('rejects BOOKING_FIELD_ENCRYPTION_KEYS that is not valid JSON, not an object, empty, or whose value is not base64-encoded 32 bytes', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_FIELD_ENCRYPTION_KEYS: 'not-json' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_FIELD_ENCRYPTION_KEYS: '[]' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_FIELD_ENCRYPTION_KEYS: '{}' })).toThrow()
    expect(() =>
      parseServerEnv({ ...validEnv, BOOKING_FIELD_ENCRYPTION_KEYS: JSON.stringify({ v1: 'too-short' }) }),
    ).toThrow()
  })

  it('rejects a BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION not present in BOOKING_FIELD_ENCRYPTION_KEYS', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: 'v2' })).toThrow()
  })

  it('rejects BOOKING_EMAIL_LOOKUP_HMAC_SECRETS that is not valid JSON, not an object, empty, or whose value is under 32 chars', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: 'not-json' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: '[]' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: '{}' })).toThrow()
    expect(() =>
      parseServerEnv({ ...validEnv, BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: JSON.stringify({ v1: 'too-short' }) }),
    ).toThrow()
  })

  it('rejects a BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION not present in BOOKING_EMAIL_LOOKUP_HMAC_SECRETS', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION: 'v2' })).toThrow()
  })

  it('supports rotating the email lookup hmac secret: multiple versions can coexist, only the active one hashes new lookups', () => {
    const result = parseServerEnv({
      ...validEnv,
      BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: JSON.stringify({ v1: 'd'.repeat(32), v2: 'i'.repeat(32) }),
      BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION: 'v2',
    })
    expect(result.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS).toEqual({ v1: 'd'.repeat(32), v2: 'i'.repeat(32) })
    expect(result.BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION).toBe('v2')
  })

  it('rejects BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS that is not valid JSON, not an object, empty, or whose value is under 32 chars', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: 'not-json' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: '[]' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: '{}' })).toThrow()
    expect(() =>
      parseServerEnv({ ...validEnv, BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: JSON.stringify({ v1: 'too-short' }) }),
    ).toThrow()
  })

  it('rejects a BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION not present in BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS', () => {
    expect(() =>
      parseServerEnv({ ...validEnv, BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION: 'v2' }),
    ).toThrow()
  })

  it('supports rotating the access token hmac secret: multiple versions can coexist, only the active one signs new tokens', () => {
    const result = parseServerEnv({
      ...validEnv,
      BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: JSON.stringify({ v1: 'e'.repeat(32), v2: 'j'.repeat(32) }),
      BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION: 'v2',
    })
    expect(result.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS).toEqual({ v1: 'e'.repeat(32), v2: 'j'.repeat(32) })
    expect(result.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION).toBe('v2')
  })

  it('rejects BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS that is not valid JSON, not an object, empty, or whose value is under 32 chars', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: 'not-json' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: '[]' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: '{}' })).toThrow()
    expect(() =>
      parseServerEnv({ ...validEnv, BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: JSON.stringify({ v1: 'too-short' }) }),
    ).toThrow()
  })

  it('rejects a BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION not present in BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS', () => {
    expect(() => parseServerEnv({ ...validEnv, BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION: 'v2' })).toThrow()
  })

  it('supports rotating the identity fingerprint secret: multiple versions can coexist, only the active one signs new fingerprints', () => {
    const result = parseServerEnv({
      ...validEnv,
      BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: JSON.stringify({ v1: 'g'.repeat(32), v2: 'h'.repeat(32) }),
      BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION: 'v2',
    })
    expect(result.BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS).toEqual({ v1: 'g'.repeat(32), v2: 'h'.repeat(32) })
    expect(result.BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION).toBe('v2')
  })

  it('rejects a BOOKING_CLOSE_TIME that is not after BOOKING_OPEN_TIME', () => {
    expect(() =>
      parseServerEnv({ ...validEnv, BOOKING_OPEN_TIME: '21:00', BOOKING_CLOSE_TIME: '09:00' }),
    ).toThrow()
    expect(() =>
      parseServerEnv({ ...validEnv, BOOKING_OPEN_TIME: '09:00', BOOKING_CLOSE_TIME: '09:00' }),
    ).toThrow()
  })

  // --- Fase 4B: selector explícito del adaptador de reservas ---

  it('ESPO_BOOKING_ADAPTER defaults to "simulated" when unset — no environment, including test suites, ever picks the real adapter by accident', () => {
    const result = parseServerEnv(validEnv)
    expect(result.ESPO_BOOKING_ADAPTER).toBe('simulated')
  })

  it('the http adapter tuning values fall back to documented defaults when unset', () => {
    const result = parseServerEnv(validEnv)
    expect(result.ESPOCRM_API_TIMEOUT_MS).toBe(8000)
    expect(result.ESPOCRM_API_MAX_RETRIES).toBe(2)
    expect(result.ESPOCRM_API_RETRY_BASE_DELAY_MS).toBe(200)
    expect(result.ESPOCRM_API_MAX_RESPONSE_BYTES).toBe(2_000_000)
  })

  it('rejects ESPO_BOOKING_ADAPTER=http without ESPOCRM_API_BASE_URL/ESPOCRM_API_KEY/ESPOCRM_PROFESSIONAL_USER_IDS — fails safe instead of silently falling back to simulated', () => {
    expect(() => parseServerEnv({ ...validEnv, ESPO_BOOKING_ADAPTER: 'http' })).toThrow()
    expect(() =>
      parseServerEnv({ ...validEnv, ESPO_BOOKING_ADAPTER: 'http', ESPOCRM_API_BASE_URL: 'http://localhost:8081' }),
    ).toThrow()
    expect(() =>
      parseServerEnv({ ...validEnv, ESPO_BOOKING_ADAPTER: 'http', ESPOCRM_API_KEY: 'k'.repeat(32) }),
    ).toThrow()
    expect(() =>
      parseServerEnv({
        ...validEnv,
        ESPO_BOOKING_ADAPTER: 'http',
        ESPOCRM_API_BASE_URL: 'http://localhost:8081',
        ESPOCRM_API_KEY: 'k'.repeat(32),
      }),
    ).toThrow()
  })

  it('accepts ESPO_BOOKING_ADAPTER=http with a complete configuration', () => {
    const result = parseServerEnv({
      ...validEnv,
      ESPO_BOOKING_ADAPTER: 'http',
      ESPOCRM_API_BASE_URL: 'http://localhost:8081',
      ESPOCRM_API_KEY: 'k'.repeat(32),
      ESPOCRM_PROFESSIONAL_USER_IDS: '6a71e26f5a32d9575',
    })
    expect(result.ESPO_BOOKING_ADAPTER).toBe('http')
    expect(result.ESPOCRM_API_BASE_URL).toBe('http://localhost:8081')
    expect(result.ESPOCRM_PROFESSIONAL_USER_IDS).toEqual(['6a71e26f5a32d9575'])
  })

  it('rejects an invalid ESPOCRM_API_BASE_URL even outside the http adapter (fails fast on malformed config rather than deferring the error)', () => {
    expect(() => parseServerEnv({ ...validEnv, ESPOCRM_API_BASE_URL: 'not-a-url' })).toThrow()
  })

  it('rejects an unknown ESPO_BOOKING_ADAPTER value', () => {
    expect(() => parseServerEnv({ ...validEnv, ESPO_BOOKING_ADAPTER: 'real' })).toThrow()
  })

  // --- Puerta 5B-2A: modo de ensayo controlado (mecanismo TEMPORAL, no productivo) ---

  const httpAdapterEnv = {
    ESPO_BOOKING_ADAPTER: 'http',
    ESPOCRM_API_BASE_URL: 'http://localhost:8081',
    ESPOCRM_API_KEY: 'k'.repeat(32),
    ESPOCRM_PROFESSIONAL_USER_IDS: '6a71e26f5a32d9575',
  } as const
  const validRunId = `puerta5b2a-${'a'.repeat(32)}`

  it('ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS defaults to false, and only "true" turns it on, same rule as SITE_NOINDEX/SMTP_SECURE', () => {
    expect(parseServerEnv(validEnv).ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS).toBe(false)
    expect(parseServerEnv({ ...validEnv, ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: 'yes' }).ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS).toBe(false)
  })

  it('a normal configuration (mode absent) is accepted untouched — no regression from Puerta 5B-2A', () => {
    const result = parseServerEnv(validEnv)
    expect(result.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS).toBe(false)
    expect(result.ESPOCRM_CONTROLLED_TEST_RUN_ID).toBeUndefined()
  })

  it('ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true with the http adapter, non-production, and a well-formed run id is accepted', () => {
    const result = parseServerEnv({
      ...validEnv,
      ...httpAdapterEnv,
      NODE_ENV: 'development',
      ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: 'true',
      ESPOCRM_CONTROLLED_TEST_RUN_ID: validRunId,
    })
    expect(result.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS).toBe(true)
    expect(result.ESPOCRM_CONTROLLED_TEST_RUN_ID).toBe(validRunId)
  })

  it('rejects ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true when NODE_ENV=production — fails the process, never activates silently', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        ...httpAdapterEnv,
        NODE_ENV: 'production',
        ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: 'true',
        ESPOCRM_CONTROLLED_TEST_RUN_ID: validRunId,
      }),
    ).toThrow()
  })

  it('rejects ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true with ESPO_BOOKING_ADAPTER=simulated — never confuses a simulated rehearsal with a real GCS test', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        NODE_ENV: 'development',
        ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: 'true',
        ESPOCRM_CONTROLLED_TEST_RUN_ID: validRunId,
      }),
    ).toThrow()
  })

  it('rejects ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true without ESPOCRM_CONTROLLED_TEST_RUN_ID', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        ...httpAdapterEnv,
        NODE_ENV: 'development',
        ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: 'true',
      }),
    ).toThrow()
  })

  it('rejects a malformed ESPOCRM_CONTROLLED_TEST_RUN_ID, even outside test mode — fails fast on malformed config', () => {
    expect(() => parseServerEnv({ ...validEnv, ESPOCRM_CONTROLLED_TEST_RUN_ID: 'not-the-right-shape' })).toThrow()
    expect(() => parseServerEnv({ ...validEnv, ESPOCRM_CONTROLLED_TEST_RUN_ID: 'puerta5b2a-tooshort' })).toThrow()
  })

  it('the normal process (mode absent/false) keeps behaving exactly as before Puerta 5B-2A', () => {
    expect(parseServerEnv(validEnv)).toEqual(parseServerEnv({ ...validEnv, ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: 'false' }))
  })
})
