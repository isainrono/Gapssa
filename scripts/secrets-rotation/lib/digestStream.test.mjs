#!/usr/bin/env node
// Pruebas de lib/digestStream.mjs — nunca usa un secreto real, solo
// cadenas de prueba desechables.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'digestStream.mjs')

function run(input) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })
}

{
  const input = 'contenido-de-prueba-desechable-001'
  const expected = createHash('sha256').update(input).digest('hex')
  const res = run(input)
  ok('digest coincide con node:crypto para una entrada normal', res.status === 0 && res.stdout.trim() === expected)
}

{
  const res = run('')
  const expectedEmpty = createHash('sha256').update('').digest('hex')
  ok('digest de entrada vacía es el SHA-256 de la cadena vacía', res.status === 0 && res.stdout.trim() === expectedEmpty)
}

{
  const res = run('línea 1\nlínea 2\ncon acentos y ñ')
  ok('acepta UTF-8 multilínea sin fallar', res.status === 0 && /^[0-9a-f]{64}$/.test(res.stdout.trim()))
}

{
  const res = run('cualquier cosa')
  ok('nunca imprime nada por stderr en el camino feliz', res.stderr === '')
}

summarizeAndExit()
