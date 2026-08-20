#!/usr/bin/env node
// Pruebas de lib/recoverOldSecretValue.mjs — el valor recuperado NUNCA
// pasa por un fichero regular; se cifra un backup de verdad con openssl
// (secretos y frase ficticios) y se comprueba que el helper lo descifra
// coordinando openssl+parseo en un único proceso.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'
import { MANDATORY_KEYS_ACTIVE } from './backupSchema.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'recoverOldSecretValue.mjs')
const TAG = '__GAPSSA_BACKUP_SCHEMA_VERSION__=active'
const PASSPHRASE = 'frase-de-prueba-desechable-000000AB'

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-recoverold-test-'))
const passfile = path.join(dir, 'passfile')
writeFileSync(passfile, PASSPHRASE, { mode: 0o600 })

const body = MANDATORY_KEYS_ACTIVE.map((k) => `${k}=valor-ficticio-${k.toLowerCase()}`).join('\n') + '\n'

function makeBackup(name, plaintext) {
  const out = path.join(dir, name)
  const res = spawnSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-out', out, '-pass', `file:${passfile}`], {
    input: plaintext,
  })
  if (res.status !== 0) throw new Error(`no se pudo crear el backup de prueba: ${res.stderr}`)
  return out
}

const goodBackup = makeBackup('good.enc', `${TAG}\n${body}`)

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

// --- camino feliz ---
{
  const res = run([goodBackup, passfile, 'POSTGRES_PASSWORD'])
  ok('camino feliz: exit 0', res.status === 0)
  ok('camino feliz: valor exacto en stdout', res.stdout === 'valor-ficticio-postgres_password')
  ok('camino feliz: stderr vacío', res.stderr === '')
}

// --- frase incorrecta ---
{
  const badPassfile = path.join(dir, 'badpass')
  writeFileSync(badPassfile, 'una-frase-completamente-distinta-000', { mode: 0o600 })
  const res = run([goodBackup, badPassfile, 'POSTGRES_PASSWORD'])
  ok('frase incorrecta: exit 4 (openssl falla)', res.status === 4)
  ok('frase incorrecta: nunca imprime un valor', res.stdout === '')
}

// --- backup corrupto ---
{
  const corrupt = path.join(dir, 'corrupt.enc')
  writeFileSync(corrupt, 'esto-no-es-un-backup-cifrado-valido')
  const res = run([corrupt, passfile, 'POSTGRES_PASSWORD'])
  ok('backup corrupto: exit distinto de 0, nunca imprime valor', res.status !== 0 && res.stdout === '')
}

// --- variable ausente ---
{
  const res = run([goodBackup, passfile, 'VARIABLE_QUE_NO_EXISTE'])
  ok('variable ausente: nunca 0, nunca imprime valor', res.status !== 0 && res.stdout === '')
}

// --- clave duplicada en el backup ---
{
  const dupBackup = makeBackup('dup.enc', `${TAG}\nFOO=uno\nFOO=dos\n`)
  const res = run([dupBackup, passfile, 'FOO'])
  ok('clave duplicada: exit 2, sin valor', res.status === 2 && res.stdout === '')
  ok('clave duplicada: ningún valor ("uno"/"dos") en stderr', !res.stderr.includes('uno') && !res.stderr.includes('dos'))
}

// --- NUNCA se crea ningún fichero regular nuevo durante toda la ejecución ---
{
  const before = new Set(readdirSync(dir))
  run([goodBackup, passfile, 'POSTGRES_PASSWORD'])
  const after = new Set(readdirSync(dir))
  const newFiles = [...after].filter((f) => !before.has(f))
  ok('el helper nunca crea ningún fichero regular nuevo (el valor solo viaja por stdout)', newFiles.length === 0)
}

// --- uso incorrecto ---
{
  const res = spawnSync(process.execPath, [SCRIPT, goodBackup, passfile], { encoding: 'utf8' })
  ok('argv incompleto: exit 1', res.status === 1)
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
