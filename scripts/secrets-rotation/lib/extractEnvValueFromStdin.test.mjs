#!/usr/bin/env node
// Pruebas de lib/extractEnvValueFromStdin.mjs — sustituto de la tubería
// `grep|tail|cut`. Todos los valores son ficticios/desechables, nunca un
// secreto real.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'extractEnvValueFromStdin.mjs')
const TAG = '__GAPSSA_BACKUP_SCHEMA_VERSION__=active'

function run(varName, input) {
  return spawnSync(process.execPath, [SCRIPT, varName], { input, encoding: 'utf8' })
}

{
  const res = run('POSTGRES_PASSWORD', `${TAG}\nFOO=bar\nPOSTGRES_PASSWORD=valor-ficticio-000\n`)
  ok('valor normal: exit 0 y valor exacto en stdout', res.status === 0 && res.stdout === 'valor-ficticio-000')
  ok('valor normal: stderr vacío', res.stderr === '')
}

{
  const raw = 'con espacios, "comillas", $variable, `backtick`, y un = extra'
  const res = run('WEIRD', `${TAG}\nWEIRD=${raw}\n`)
  ok('espacios/comillas/$/backticks se devuelven literales, sin interpolar', res.status === 0 && res.stdout === raw)
}

{
  const res = run('FOO', `${TAG}\nFOO=uno\nFOO=dos\n`)
  ok('clave duplicada: exit 2', res.status === 2)
  ok('clave duplicada: ningún valor ("uno"/"dos") en stderr', !res.stderr.includes('uno') && !res.stderr.includes('dos'))
}

{
  const res = run('AUSENTE', `${TAG}\nFOO=bar\n`)
  ok('clave ausente: exit 3', res.status === 3)
}

{
  const res = run('FOO', `${TAG}\nesto no es KEY=VALUE\nFOO=bar\n`)
  ok('línea mal formada: exit 2', res.status === 2)
}

{
  const res = run('FOO', 'FOO=bar\n') // sin etiqueta de esquema
  ok('sin etiqueta de esquema: exit 2 (metadata ausente)', res.status === 2)
}

{
  const res = run('FOO', `${TAG}\nFOO=algo-secreto-de-prueba\n`)
  ok('caso de éxito: cero contenido de valor en stderr', res.status === 0 && res.stderr === '')
}

{
  const res = run('', `${TAG}\nFOO=bar\n`)
  ok('argv vacío: error de uso, exit 1', res.status === 1)
}

{
  const res = run('foo_lowercase', `${TAG}\nfoo_lowercase=bar\n`)
  ok('nombre de variable en minúsculas rechazado por validación de argv (exit 1)', res.status === 1)
}

summarizeAndExit()
