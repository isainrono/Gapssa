import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildSyntheticServerEnv, installSyntheticServerEnv, SENSITIVE_ENV_KEYS } from './syntheticServerEnv'

/**
 * Comprobaciones deterministas de que la suite unitaria nunca carga el
 * `.env` real, en vez de interceptar globalmente `fs.readFileSync`/`open`
 * durante toda la suite (romperia lecturas legitimas de fixtures y no
 * capturaria bindings ESM ya importados antes de instalar cualquier
 * intercepcion). En su lugar: inspeccion estatica del código fuente de
 * los ficheros de configuración/setup conocidos, y pruebas del propio
 * fixture sintético.
 */

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function readSource(relativePath: string): string {
  return readFileSync(path.join(webRoot, relativePath), 'utf8')
}

/**
 * Los ficheros comprobados abajo documentan en su propia prosa (comentarios
 * de bloque/línea) que NO cargan `.env` ni usan `dotenv`/`readFileSync` —
 * esa prosa contiene las mismas palabras que se buscan. Se despoja el
 * código de comentarios antes de aplicar `FILE_IO_PATTERN`, para que la
 * comprobación recaiga solo sobre código ejecutable real.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function readSourceWithoutComments(relativePath: string): string {
  return stripComments(readSource(relativePath))
}

/**
 * Ninguno de los ficheros comprobados abajo tiene motivo legítimo para
 * leer NINGÚN fichero (ni `.env`, ni ningún otro) — así que, en vez de
 * prohibir la subcadena `.env` (que también aparece en la prosa de los
 * propios comentarios explicando que el fichero NO carga `.env`, dando
 * falsos positivos), se comprueba la ausencia de cualquier mecanismo real
 * de E/S de fichero. Eso cubre `.env`, `.env.local`, `.env.example` y
 * cualquier otra variante por construcción: no hay ninguna llamada capaz
 * de abrir ninguna de ellas.
 */
const FILE_IO_PATTERN = /dotenv|readFileSync|readFile\(|createReadStream|openSync|open\(|require\(|import\(/

describe('vitest.setup.ts nunca carga el .env real', () => {
  it('no contiene ningún mecanismo de E/S de fichero (dotenv, fs, require/import dinámico) en su código ejecutable', () => {
    const source = readSourceWithoutComments('vitest.setup.ts')
    expect(source).not.toMatch(FILE_IO_PATTERN)
  })

  it('instala el fixture sintético de forma síncrona en el ámbito del módulo (no diferida)', () => {
    const source = readSource('vitest.setup.ts')
    expect(source).toMatch(/installSyntheticServerEnv\(\)/)
  })
})

describe('src/test/syntheticServerEnv.ts nunca lee ficheros', () => {
  it('no contiene ningún mecanismo de E/S de fichero (dotenv, fs, require/import dinámico) en su código ejecutable', () => {
    const source = readSourceWithoutComments('src/test/syntheticServerEnv.ts')
    expect(source).not.toMatch(FILE_IO_PATTERN)
  })
})

describe('vitest.config.ts: el único setupFile de la suite unitaria es vitest.setup.ts', () => {
  it('declara exactamente ese setupFile, sin ningún mecanismo de E/S de fichero propio en su código ejecutable', () => {
    const rawSource = readSource('vitest.config.ts')
    expect(rawSource).toMatch(/setupFiles:\s*\[\s*['"]\.\/vitest\.setup\.ts['"]\s*\]/)
    expect(readSourceWithoutComments('vitest.config.ts')).not.toMatch(FILE_IO_PATTERN)
  })
})

describe('buildSyntheticServerEnv', () => {
  it('es una función pura: no toca process.env ni hace E/S, solo devuelve el mapa', () => {
    const before = { ...process.env }
    buildSyntheticServerEnv()
    expect(process.env).toEqual(before)
  })

  it('cubre las 4 variables HMAC de booking pedidas explícitamente por punto 1', () => {
    const env = buildSyntheticServerEnv()
    expect(env).toHaveProperty('BOOKING_EMAIL_LOOKUP_HMAC_SECRETS')
    expect(env).toHaveProperty('BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION')
    expect(env).toHaveProperty('BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS')
    expect(env).toHaveProperty('BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION')
  })

  it('los mapas HMAC/AES son JSON válido, con la versión activa presente como clave', () => {
    const env = buildSyntheticServerEnv()
    function mustGet(key: string): string {
      const value = env[key]
      if (value === undefined) {
        throw new Error(`buildSyntheticServerEnv() no incluye la clave esperada: ${key}`)
      }
      return value
    }
    for (const [mapKey, versionKey] of [
      ['BOOKING_FIELD_ENCRYPTION_KEYS', 'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION'],
      ['BOOKING_EMAIL_LOOKUP_HMAC_SECRETS', 'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION'],
      ['BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS', 'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION'],
      ['BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS', 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION'],
    ] as const) {
      const parsed = JSON.parse(mustGet(mapKey))
      expect(Object.keys(parsed).length).toBeGreaterThan(0)
      expect(parsed).toHaveProperty(mustGet(versionKey))
    }
  })

  it('genera valores distintos en cada llamada (nunca el mismo secreto persistido entre ejecuciones)', () => {
    const first = buildSyntheticServerEnv()
    const second = buildSyntheticServerEnv()
    expect(first.PAYLOAD_SECRET).not.toBe(second.PAYLOAD_SECRET)
    expect(first.BOOKING_INTERNAL_API_SECRET).not.toBe(second.BOOKING_INTERNAL_API_SECRET)
  })

  it('fija ESPO_BOOKING_ADAPTER=simulated explícitamente — ningún test unitario activa el adaptador HTTP real por accidente', () => {
    expect(buildSyntheticServerEnv().ESPO_BOOKING_ADAPTER).toBe('simulated')
  })
})

/**
 * Cualquier test de este fichero que mute `process.env` debe restaurar
 * exactamente su preimagen al terminar — nunca `delete` sin más (dejaría
 * el proceso en un estado distinto al que tenía antes del test, afectando
 * a tests posteriores que compartan el mismo worker) ni una sobrescritura
 * que no se deshaga.
 */
function snapshotEnv(): Record<string, string | undefined> {
  return { ...process.env }
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('installSyntheticServerEnv', () => {
  it('sobrescribe cualquier valor sensible heredado del proceso antes de instalar el fixture', () => {
    const key = 'BOOKING_INTERNAL_API_SECRET'
    const before = snapshotEnv()
    const previousSynthetic = process.env[key]
    const inherited = 'valor-heredado-del-shell-del-desarrollador'
    process.env[key] = inherited
    try {
      installSyntheticServerEnv()
      expect(process.env[key]).not.toBe(inherited)
      expect(process.env[key]).not.toBe(previousSynthetic)
      expect(process.env[key]?.length).toBeGreaterThanOrEqual(32)
    } finally {
      restoreEnv(before)
    }
  })

  it('solo instala claves del fixture sintético — no introduce valores para claves fuera de SENSITIVE_ENV_KEYS/buildSyntheticServerEnv', () => {
    const before = snapshotEnv()
    try {
      const expectedKeys = new Set(Object.keys(buildSyntheticServerEnv()))
      const beforeKeys = new Set(Object.keys(process.env))
      installSyntheticServerEnv()
      const introduced = Object.keys(process.env).filter((k) => !beforeKeys.has(k))
      for (const key of introduced) {
        expect(expectedKeys.has(key)).toBe(true)
      }
    } finally {
      restoreEnv(before)
    }
  })

  it('SENSITIVE_ENV_KEYS incluye las 4 variables HMAC de booking pedidas explícitamente por punto 1', () => {
    expect(SENSITIVE_ENV_KEYS).toContain('BOOKING_EMAIL_LOOKUP_HMAC_SECRETS')
    expect(SENSITIVE_ENV_KEYS).toContain('BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION')
    expect(SENSITIVE_ENV_KEYS).toContain('BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS')
    expect(SENSITIVE_ENV_KEYS).toContain('BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION')
  })
})
