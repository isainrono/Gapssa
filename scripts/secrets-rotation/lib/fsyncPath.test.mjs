#!/usr/bin/env node
// Pruebas de lib/fsyncPath.mjs — directorios/ficheros desechables bajo
// os.tmpdir(), nunca dentro del repositorio.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'fsyncPath.mjs')

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-fsyncpath-test-'))
const filePath = path.join(dir, 'archivo.txt')
writeFileSync(filePath, 'contenido-ficticio', { mode: 0o600 })
const linkPath = path.join(dir, 'enlace')
symlinkSync(filePath, linkPath)

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

{
  const res = run(['file', filePath])
  ok('fsync de fichero regular existente: exit 0', res.status === 0)
}

{
  const res = run(['dir', dir])
  ok('fsync de directorio existente: exit 0', res.status === 0)
}

{
  const res = run(['file', linkPath])
  ok('fsync de un symlink en modo "file": rechazado (no lo sigue)', res.status !== 0)
}

{
  const res = run(['file', path.join(dir, 'no-existe')])
  ok('ruta inexistente: rechazada, nunca crea el fichero', res.status !== 0)
}

{
  const res = run(['dir', filePath])
  ok('fsync en modo "dir" sobre un fichero regular: rechazado', res.status !== 0)
}

{
  const res = run(['bogus', filePath])
  ok('modo de uso inválido: exit 1', res.status === 1)
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
