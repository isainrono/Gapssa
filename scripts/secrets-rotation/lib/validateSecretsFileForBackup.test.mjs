#!/usr/bin/env node
// Pruebas de lib/validateSecretsFileForBackup.mjs — validación del
// $SECRETS_FILE PLANO contra una versión de esquema EXPLÍCITA, ANTES de
// cifrar cualquier backup nuevo.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'
import { MANDATORY_KEYS_ACTIVE, MANDATORY_KEYS_LEGACY_PRE_S7 } from './backupSchema.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'validateSecretsFileForBackup.mjs')

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-validatebackup-test-'))

function writeFixture(name, keys) {
  const p = path.join(dir, name)
  writeFileSync(p, keys.map((k) => `${k}=valor-ficticio-${k.toLowerCase()}`).join('\n') + '\n')
  return p
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

// --- fichero "active" completo: válido para "active" ---
{
  const p = writeFixture('active-complete.env', MANDATORY_KEYS_ACTIVE)
  const res = run([p, 'active'])
  ok('fichero active completo: exit 0 para "active"', res.status === 0)
}

// --- mismo fichero, validado contra "legacy-pre-s7": rechazado (mezcla) ---
{
  const p = writeFixture('active-complete2.env', MANDATORY_KEYS_ACTIVE)
  const res = run([p, 'legacy-pre-s7'])
  ok('un fichero "active" es rechazado si se valida como "legacy-pre-s7" (etiqueta equivocada)', res.status === 2)
}

// --- fichero "legacy-pre-s7" completo: válido para "legacy-pre-s7" ---
{
  const p = writeFixture('legacy-complete.env', MANDATORY_KEYS_LEGACY_PRE_S7)
  const res = run([p, 'legacy-pre-s7'])
  ok('fichero legacy-pre-s7 completo: exit 0 para "legacy-pre-s7"', res.status === 0)
}

// --- mismo fichero, validado contra "active": rechazado (mezcla) ---
{
  const p = writeFixture('legacy-complete2.env', MANDATORY_KEYS_LEGACY_PRE_S7)
  const res = run([p, 'active'])
  ok('un fichero "legacy-pre-s7" es rechazado si se valida como "active" (etiqueta equivocada)', res.status === 2)
}

// --- fichero incompleto: rechazado ---
{
  const p = writeFixture('incomplete.env', MANDATORY_KEYS_ACTIVE.slice(0, 3))
  const res = run([p, 'active'])
  ok('fichero incompleto: rechazado', res.status === 2)
}

// --- fichero vacío: rechazado ---
{
  const p = path.join(dir, 'empty.env')
  writeFileSync(p, '')
  const res = run([p, 'active'])
  ok('fichero vacío: rechazado', res.status === 2)
}

// --- versión desconocida como argv: uso incorrecto ---
{
  const p = writeFixture('whatever.env', MANDATORY_KEYS_ACTIVE)
  const res = run([p, 'no-existe'])
  ok('versión desconocida en argv: exit 1', res.status === 1)
}

// --- fichero inexistente ---
{
  const res = run([path.join(dir, 'no-existe.env'), 'active'])
  ok('fichero inexistente: rechazado (no exit 0)', res.status !== 0)
}

// --- cero contenido de valores en stderr ---
{
  const p = writeFixture('withvalue.env', MANDATORY_KEYS_ACTIVE)
  const res = run([p, 'legacy-pre-s7'])
  ok('cero valores en stderr', !res.stderr.includes('valor-ficticio'))
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
