#!/usr/bin/env node
// Pruebas de lib/migrateLegacySecretsFileToActive.mjs — conversión del
// esquema legacy-pre-s7 (Bloque 8): función pura (migrateSecretsFileText)
// y el CLI completo (spawnSync, ficheros SINTÉTICOS temporales, nunca
// $SECRETS_FILE/.env reales, nunca S6/S7 real).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { migrateSecretsFileText, LegacyMigrationError } from './migrateLegacySecretsFileToActive.mjs'
import { parseSecretsFile, LEGACY_PRE_S7_KEY_INVENTORY, SECRETS_FILE_KEY_INVENTORY } from './loadSecretsEnv.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.join(__dirname, 'migrateLegacySecretsFileToActive.mjs')

function expectThrow(fn) {
  try {
    fn()
    return null
  } catch (err) {
    return err
  }
}

let tmpDir
function writeSecretsFile(name, content) {
  if (!tmpDir) {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gapssa-migrateLegacy-test-'))
  }
  const filePath = path.join(tmpDir, name)
  writeFileSync(filePath, content, { mode: 0o600 })
  return filePath
}

function fictitiousValueFor(key) {
  if (key.endsWith('_ACTIVE_KEY_VERSION')) return 'v1'
  if (key === 'BOOKING_FIELD_ENCRYPTION_KEYS') return '{"v1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}'
  if (key === 'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS') return '{"v1":"valor-ficticio-de-al-menos-32-caracteres"}'
  if (key === 'DATABASE_URL_AUTH' || key === 'DATABASE_URL_BOOKING' || key === 'DATABASE_URL_CMS') return 'postgres://user:pass@localhost:5432/db'
  if (key === 'REDIS_URL') return 'redis://localhost:6379'
  if (key === 'BOOKING_EMAIL_LOOKUP_HMAC_SECRET' || key === 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET') return `legacy-real-value-${key.toLowerCase()}-de-32-o-mas-caracteres`
  return `valor-ficticio-${key.toLowerCase()}`
}

function fullLegacyBody() {
  return LEGACY_PRE_S7_KEY_INVENTORY.map((k) => `${k}=${fictitiousValueFor(k)}`).join('\n') + '\n'
}
function fullActiveBody() {
  return SECRETS_FILE_KEY_INVENTORY.map((k) => `${k}=${fictitiousValueFor(k)}`).join('\n') + '\n'
}

function runCli(filePath) {
  return spawnSync(process.execPath, [CLI_PATH, filePath], { encoding: 'utf8' })
}

// --- función pura: legacy completo -> migra, preserva el valor bajo "v1" ---
{
  const rawText = `# comentario preservado\n\n${fullLegacyBody()}`
  const entries = Object.fromEntries(LEGACY_PRE_S7_KEY_INVENTORY.map((k) => [k, fictitiousValueFor(k)]))
  const result = migrateSecretsFileText(rawText, entries)
  ok('legacy completo: changed=true', result.changed === true)
  ok('comentario/línea en blanco original preservados verbatim', result.text.startsWith('# comentario preservado\n\n'))
  ok('BOOKING_EMAIL_LOOKUP_HMAC_SECRETS resultante contiene EXACTAMENTE el valor legacy bajo la versión v1 (verificabilidad histórica)', result.text.includes(`BOOKING_EMAIL_LOOKUP_HMAC_SECRETS={"v1":"${fictitiousValueFor('BOOKING_EMAIL_LOOKUP_HMAC_SECRET')}"}`))
  ok('BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION=v1', result.text.includes('BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION=v1'))
  ok('BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS resultante contiene el valor legacy bajo v1', result.text.includes(`BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS={"v1":"${fictitiousValueFor('BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET')}"}`))
  ok('las 2 claves singulares legacy ya NO aparecen en el resultado', !/^BOOKING_EMAIL_LOOKUP_HMAC_SECRET=/m.test(result.text) && !/^BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET=/m.test(result.text))
  ok('el texto resultante vuelve a ser parseable como esquema "active" puro', (() => {
    const outFilePath = writeSecretsFile('reparse-active.env', result.text)
    return !expectThrow(() => parseSecretsFile(outFilePath))
  })())
}

// --- función pura: ya activo -> no-op ---
{
  const rawText = fullActiveBody()
  const entries = Object.fromEntries(SECRETS_FILE_KEY_INVENTORY.map((k) => [k, fictitiousValueFor(k)]))
  const result = migrateSecretsFileText(rawText, entries)
  ok('esquema ya "active": changed=false (idempotente, nunca reescribe)', result.changed === false)
  ok('esquema ya "active": el texto se devuelve sin tocar', result.text === rawText)
}

// --- función pura: falta una de las 2 legacy -> rechazado (nunca migración parcial) ---
{
  const entries = Object.fromEntries(
    LEGACY_PRE_S7_KEY_INVENTORY.filter((k) => k !== 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET').map((k) => [k, fictitiousValueFor(k)]),
  )
  const rawText = Object.entries(entries)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const err = expectThrow(() => migrateSecretsFileText(rawText, entries))
  ok('falta una legacy: rechazado (nunca migra solo la mitad)', err instanceof LegacyMigrationError && /BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET/.test(err.message))
}

// --- función pura: legacy vacía -> rechazado ---
{
  const entries = Object.fromEntries(LEGACY_PRE_S7_KEY_INVENTORY.map((k) => [k, fictitiousValueFor(k)]))
  entries.BOOKING_EMAIL_LOOKUP_HMAC_SECRET = ''
  const rawText = Object.entries(entries)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const err = expectThrow(() => migrateSecretsFileText(rawText, entries))
  ok('valor legacy vacío: rechazado, nunca migrado', err instanceof LegacyMigrationError)
}

// --- CLI completo: legacy -> migra en disco, exit 0 ---
{
  const filePath = writeSecretsFile('cli-legacy.env', fullLegacyBody())
  const before = readFileSync(filePath, 'utf8')
  const result = runCli(filePath)
  const after = readFileSync(filePath, 'utf8')
  ok('CLI sobre legacy completo: exit 0', result.status === 0)
  ok('CLI sobre legacy completo: el archivo SÍ cambió en disco', after !== before)
  ok('CLI sobre legacy completo: el resultado en disco es parseable como "active" puro', !expectThrow(() => parseSecretsFile(filePath)))
  ok('CLI: stderr nunca contiene el valor legacy real', !result.stderr.includes(fictitiousValueFor('BOOKING_EMAIL_LOOKUP_HMAC_SECRET')))
}

// --- CLI completo: ya activo -> no-op, exit 0, archivo BYTE A BYTE intacto ---
{
  const filePath = writeSecretsFile('cli-active.env', fullActiveBody())
  const before = readFileSync(filePath)
  const result = runCli(filePath)
  const after = readFileSync(filePath)
  ok('CLI sobre esquema ya "active": exit 0', result.status === 0)
  ok('CLI sobre esquema ya "active": archivo BYTE A BYTE intacto (no-op real, nunca un truncate+rewrite idéntico)', Buffer.compare(before, after) === 0)
}

// --- CLI: mezcla plural+singular del mismo campo -> exit 2, archivo intacto ---
{
  const body = fullActiveBody() + 'BOOKING_EMAIL_LOOKUP_HMAC_SECRET=valor-legacy-de-mas-de-32-caracteres\n'
  const filePath = writeSecretsFile('cli-mixed.env', body)
  const before = readFileSync(filePath)
  const result = runCli(filePath)
  const after = readFileSync(filePath)
  ok('CLI sobre archivo mezclado: exit 2 (rechazado, nunca escribe)', result.status === 2)
  ok('CLI sobre archivo mezclado: archivo intacto tras el rechazo', Buffer.compare(before, after) === 0)
  ok('CLI: stderr saneado (sin stack trace de Node)', !result.stderr.includes(' at ') && !result.stderr.includes(CLI_PATH))
}

// --- CLI: clave desconocida -> exit 2, archivo intacto ---
{
  const body = fullLegacyBody() + 'CLAVE_DESCONOCIDA=x\n'
  const filePath = writeSecretsFile('cli-unknown.env', body)
  const before = readFileSync(filePath)
  const result = runCli(filePath)
  const after = readFileSync(filePath)
  ok('CLI sobre clave desconocida: exit 2', result.status === 2)
  ok('CLI sobre clave desconocida: archivo intacto', Buffer.compare(before, after) === 0)
}

// --- CLI: uso incorrecto (sin argumento) -> exit 1 ---
{
  const result = spawnSync(process.execPath, [CLI_PATH], { encoding: 'utf8' })
  ok('CLI sin argumento: exit 1 (uso incorrecto, distinto de exit 2 = contenido inválido)', result.status === 1)
}

rmSync(tmpDir, { recursive: true, force: true })

summarizeAndExit()
