import { type ChildProcess, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from 'redis'
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'

import { runAuthMigrations } from '../../src/server/auth/db/migrate'
import { runBookingMigrations } from '../../src/server/booking/db/migrate'
import { assertEphemeralTestDatabaseUrl } from './ephemeralDatabaseGuard'
import { startTestMailbox, type TestMailbox } from './mailbox'

/**
 * Arranca, para toda la suite de integración, un `next dev` real contra
 * bases de datos Postgres aisladas — `gapssa_cms_test_<random>` (nunca
 * `gapssa_cms`), `gapssa_auth_test_<random>` (nunca `gapssa_auth`, desde
 * Fase 3) y, desde Fase 4A, también `gapssa_booking_test_<random>` (nunca
 * `gapssa_booking`) — y lo apaga al terminar, borrando las tres bases
 * incluso si algún test falla. `next dev`, no `next start`: solo en modo
 * dev Payload sincroniza el esquema automáticamente al arrancar
 * (`apps/web/README.md`, "Migraciones") — una base de CMS recién creada
 * necesita eso para tener tablas sin ejecutar migraciones aparte;
 * `gapssa_auth_test_*`/`gapssa_booking_test_*` sí requieren migraciones
 * explícitas (`runAuthMigrations`/`runBookingMigrations`, Drizzle no
 * sincroniza el esquema automáticamente).
 *
 * Redis: en vez de una base aislada (Redis no las tiene igual que
 * Postgres), cada ejecución usa un `REDIS_KEY_PREFIX` aleatorio propio —
 * nunca el prefijo del `.env` de desarrollo — y el teardown borra
 * únicamente las claves bajo ese prefijo (`SCAN` + `DEL`), nunca
 * `FLUSHALL`, para no interferir con un `npm run dev` real compartiendo el
 * mismo Redis.
 *
 * Requiere: `apps-db` (Postgres) y `redis` ya levantados
 * (`docker compose up -d apps-db redis`) y las variables de entorno de la
 * raíz cargadas (`npm run test:integration` desde la raíz las carga vía
 * `dotenv-cli`, igual que el resto de scripts — ver README.md).
 */

const appsWebDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

const REQUIRED_ENV_VARS = [
  'DATABASE_URL_CMS',
  'DATABASE_URL_AUTH',
  'DATABASE_URL_BOOKING',
  'REDIS_URL',
  'REDIS_KEY_PREFIX',
  'PAYLOAD_SECRET',
  'NEXT_PUBLIC_SITE_URL',
] as const

function requireEnv(): Record<(typeof REQUIRED_ENV_VARS)[number], string> {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno para la suite de integración: ${missing.join(', ')}.\n` +
        'Ejecuta "npm run test:integration" desde la raíz del monorepo (carga .env vía dotenv-cli), ' +
        'con "docker compose up -d apps-db redis" ya levantado.',
    )
  }
  return Object.fromEntries(REQUIRED_ENV_VARS.map((key) => [key, process.env[key] as string])) as Record<
    (typeof REQUIRED_ENV_VARS)[number],
    string
  >
}

function generateTestDatabaseName(
  prefix: 'gapssa_auth_test' | 'gapssa_cms_test' | 'gapssa_booking_test',
): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`
}

function generateTestRedisKeyPrefix(): string {
  return `gapssa:inttest:${randomBytes(6).toString('hex')}:`
}

/** Borra únicamente las claves bajo `prefix` — nunca FLUSHALL, Redis puede compartirse con un `npm run dev` real. */
async function purgeRedisKeysWithPrefix(redisUrl: string, prefix: string): Promise<void> {
  const client = createClient({ url: redisUrl })
  await client.connect()
  try {
    let cursor = '0'
    do {
      const result = await client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 200 })
      cursor = result.cursor
      if (result.keys.length > 0) {
        await client.del(result.keys)
      }
    } while (cursor !== '0')
  } finally {
    await client.quit()
  }
}

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const { port } = address
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('No se pudo reservar un puerto libre para el servidor de pruebas.')))
      }
    })
  })
}

async function createDatabase(adminConnectionString: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString: adminConnectionString })
  await client.connect()
  try {
    // CREATE DATABASE no admite parámetros bindeados; el nombre viene de
    // generateTestDatabaseName() (hex generado aquí mismo, nunca de una
    // entrada externa), así que interpolarlo entre comillas dobles es
    // seguro — no hay superficie de inyección SQL.
    await client.query(`CREATE DATABASE "${databaseName}"`)
  } finally {
    await client.end()
  }
}

async function dropDatabase(adminConnectionString: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString: adminConnectionString })
  await client.connect()
  try {
    // FORCE (Postgres >= 13) corta cualquier conexión residual del `next
    // dev` recién detenido antes de borrar — evita el error típico
    // "database is being accessed by other users" en un DROP normal.
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  } finally {
    await client.end()
  }
}

async function waitForServerReady(baseUrl: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`El servidor de pruebas terminó antes de arrancar (código ${child.exitCode}).`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `El servidor de pruebas (${baseUrl}) no respondió "ok" en /api/health tras ${timeoutMs}ms.` +
      (lastError ? ` Último error: ${String(lastError)}` : ''),
  )
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await new Promise<void>((resolve) => {
    const forceKill = setTimeout(() => {
      child.kill('SIGKILL')
    }, 10_000)
    child.once('exit', () => {
      clearTimeout(forceKill)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const env = requireEnv()
  const require = createRequire(import.meta.url)

  const cmsAdminConnectionString = withDatabaseName(env.DATABASE_URL_CMS, 'postgres')
  const testDatabaseName = generateTestDatabaseName('gapssa_cms_test')
  const testDatabaseUrl = withDatabaseName(env.DATABASE_URL_CMS, testDatabaseName)

  const authAdminConnectionString = withDatabaseName(env.DATABASE_URL_AUTH, 'postgres')
  const testAuthDatabaseName = generateTestDatabaseName('gapssa_auth_test')
  const testAuthDatabaseUrl = withDatabaseName(env.DATABASE_URL_AUTH, testAuthDatabaseName)

  const bookingAdminConnectionString = withDatabaseName(env.DATABASE_URL_BOOKING, 'postgres')
  const testBookingDatabaseName = generateTestDatabaseName('gapssa_booking_test')
  const testBookingDatabaseUrl = withDatabaseName(env.DATABASE_URL_BOOKING, testBookingDatabaseName)

  // Corrección de puerta 4, auditoría de migraciones: única puerta de
  // seguridad antes de crear/migrar/destruir NADA — aborta si alguna de
  // las tres URLs recién construidas apuntara (por un bug en
  // `generateTestDatabaseName()`/`withDatabaseName()`, o una variable de
  // entorno mal puesta) a `gapssa_cms`/`gapssa_auth`/`gapssa_booking`
  // reales o a cualquier nombre sin el prefijo efímero aprobado. Nunca se
  // construyen estas URLs de otra forma (sed, concatenación libre) en
  // ningún punto de la suite.
  assertEphemeralTestDatabaseUrl(testDatabaseUrl)
  assertEphemeralTestDatabaseUrl(testAuthDatabaseUrl)
  assertEphemeralTestDatabaseUrl(testBookingDatabaseUrl)

  const testRedisKeyPrefix = generateTestRedisKeyPrefix()
  const mailbox: TestMailbox = await startTestMailbox()

  await createDatabase(cmsAdminConnectionString, testDatabaseName)
  await createDatabase(authAdminConnectionString, testAuthDatabaseName)
  await createDatabase(bookingAdminConnectionString, testBookingDatabaseName)
  // Drizzle no sincroniza el esquema automáticamente como sí hace Payload
  // en modo dev (ver comentario superior) — hay que aplicar las
  // migraciones explícitamente antes de que el servidor de pruebas
  // arranque, para que las rutas /api/auth/* y /api/booking/* tengan
  // tablas desde la primera petición.
  await runAuthMigrations(testAuthDatabaseUrl)
  await runBookingMigrations(testBookingDatabaseUrl)

  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const nextBin = require.resolve('next/dist/bin/next')

  const cleanupDatabases = async (): Promise<void> => {
    // Repite la misma guardia justo antes de la operación DESTRUCTIVA
    // (`DROP DATABASE`) — defensa en profundidad: aunque ya se comprobó
    // arriba al construir las URLs, un `DROP` nunca debe depender
    // únicamente de una comprobación hecha minutos antes en otro punto del
    // código.
    assertEphemeralTestDatabaseUrl(testDatabaseUrl)
    assertEphemeralTestDatabaseUrl(testAuthDatabaseUrl)
    assertEphemeralTestDatabaseUrl(testBookingDatabaseUrl)
    await dropDatabase(cmsAdminConnectionString, testDatabaseName)
    await dropDatabase(authAdminConnectionString, testAuthDatabaseName)
    await dropDatabase(bookingAdminConnectionString, testBookingDatabaseName)
  }

  const child = spawn(process.execPath, [nextBin, 'dev', '--port', String(port)], {
    cwd: appsWebDir,
    env: {
      ...process.env,
      DATABASE_URL_CMS: testDatabaseUrl,
      DATABASE_URL_AUTH: testAuthDatabaseUrl,
      DATABASE_URL_BOOKING: testBookingDatabaseUrl,
      REDIS_KEY_PREFIX: testRedisKeyPrefix,
      // Buzón SMTP efímero y aislado (mailbox.ts) — mailer.ts entrega el
      // correo real por SMTP a este puerto, exactamente igual que
      // entregaría a un SMTP de producción. Nunca DEV_MAILER_LOG_FILE
      // (retirado, revisión 2 de Fase 3: ese mecanismo dejaba el OTP en un
      // fichero de log).
      SMTP_HOST: mailbox.smtpHost,
      SMTP_PORT: String(mailbox.smtpPort),
      SMTP_SECURE: 'false',
      // Límites por IP muy por encima de lo normal: toda la suite de
      // integración comparte un único origen (127.0.0.1), así que un
      // límite por IP realista (pensado para tráfico real) se dispararía
      // por la simple acumulación de peticiones de tests sin relación
      // entre sí. Los límites por cuenta/correo (`AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR`,
      // `OTP_MAX_ATTEMPTS`) se dejan en su valor real: cada test usa un
      // correo aislado (UUID), así que sí se pueden probar de verdad sin
      // este problema de agregación.
      OTP_REQUEST_MAX_PER_IP_PER_HOUR: '5000',
      AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR: '5000',
      // Mismo motivo que los dos límites de arriba (Fase 3), aplicado a
      // Fase 4A: toda la suite de reservas comparte un único origen
      // (127.0.0.1) repartido entre varios ficheros de prueba.
      BOOKING_REQUEST_MAX_PER_IP_PER_HOUR: '5000',
      BOOKING_VERIFY_MAX_PER_IP_PER_HOUR: '5000',
      BOOKING_AVAILABILITY_MAX_PER_IP_PER_HOUR: '5000',
      // Carpeta de build separada de la del `next dev` de desarrollo
      // habitual (mismo mecanismo, ver next.config.ts) — evita que dos
      // procesos escriban a la vez sobre `.next`.
      NEXT_DIST_DIR: '.next-integration-test',
      NODE_OPTIONS: '--no-deprecation',
    },
    stdio: 'pipe',
  })

  let serverLog = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString()
  })

  try {
    await waitForServerReady(baseUrl, child, 90_000)
  } catch (error) {
    await stopServer(child)
    await cleanupDatabases()
    await mailbox.close()
    throw error instanceof Error
      ? new Error(`${error.message}\n\n--- Salida del servidor de pruebas ---\n${serverLog.slice(-4000)}`)
      : error
  }

  project.provide('integrationBaseUrl', baseUrl)
  project.provide('integrationTestDatabaseName', testDatabaseName)
  project.provide('integrationAuthDatabaseUrl', testAuthDatabaseUrl)
  project.provide('integrationBookingDatabaseUrl', testBookingDatabaseUrl)
  project.provide('integrationRedisKeyPrefix', testRedisKeyPrefix)
  project.provide('integrationMailboxHttpPort', mailbox.httpPort)

  return async () => {
    await stopServer(child)
    await cleanupDatabases()
    await purgeRedisKeysWithPrefix(env.REDIS_URL, testRedisKeyPrefix)
    // Destruye el buzón y todos los mensajes en memoria — nunca se
    // persiste a disco en ningún momento de la ejecución.
    await mailbox.close()
  }
}
