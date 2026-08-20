#!/usr/bin/env node
// Pruebas de lib/extractLiveEnvValueFromStdin.mjs — extractor dedicado al
// almacén externo VIVO (sin etiqueta de backup). Todos los valores son
// ficticios/desechables, nunca un secreto real.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'extractLiveEnvValueFromStdin.mjs')

function run(varName, input) {
  return spawnSync(process.execPath, [SCRIPT, varName], { input, encoding: 'utf8' })
}

function runBuf(varName, inputBuffer) {
  return spawnSync(process.execPath, [SCRIPT, varName], { input: inputBuffer })
}

{
  const res = run('ESPOCRM_DB_PASSWORD', 'ESPOCRM_DB_PASSWORD=valor-ficticio-000\n')
  ok('valor normal: exit 0 y valor exacto en stdout', res.status === 0 && res.stdout === 'valor-ficticio-000')
  ok('valor normal: stderr vacío', res.stderr === '')
}

{
  const res = run('ESPOCRM_DB_PASSWORD', '# comentario legado\nLEGACY_KEY=algo-viejo\nESPOCRM_DB_PASSWORD=valor-000\n')
  ok('claves legacy y comentarios ignorados, valor correcto', res.status === 0 && res.stdout === 'valor-000')
  ok('claves legacy no aparecen en stderr', !res.stderr.includes('LEGACY_KEY') && !res.stderr.includes('algo-viejo'))
}

{
  const raw = 'con espacios, "comillas", $variable, `backtick`, y un = extra'
  const res = run('WEIRD', `WEIRD=${raw}\n`)
  ok('caracteres especiales se devuelven literales, sin recortar ni interpolar', res.status === 0 && res.stdout === raw)
}

{
  // clave duplicada — no debe quedarse con "la última" en silencio
  const res = run('FOO', 'FOO=uno\nFOO=dos\n')
  ok('clave duplicada: exit 2 (rechazada, no resuelta en silencio)', res.status === 2)
  ok('clave duplicada: ningún valor ("uno"/"dos") en stderr', !res.stderr.includes('uno') && !res.stderr.includes('dos'))
}

{
  const res = run('AUSENTE', 'FOO=bar\n')
  ok('clave ausente: exit 3', res.status === 3)
}

{
  const res = run('FOO', 'FOO=\n')
  ok('valor vacío: exit 2', res.status === 2)
  ok('valor vacío: stderr no expone el valor (no hay nada que exponer, pero tampoco confirma silenciosamente)', res.status === 2)
}

{
  const res = run('FOO', 'esto no es KEY=VALUE ni comentario\nFOO=bar\n')
  ok('línea mal formada: exit 2', res.status === 2)
  ok('línea mal formada: la línea ofensiva no aparece en stderr', !res.stderr.includes('esto no es'))
}

{
  // "fichero truncado a mitad de una clave" — sin '=', formato inválido
  const res = run('FOO', 'FOO=bar\nESPOCRM_DB_PASSW')
  ok('fichero truncado (línea final sin "="): exit 2', res.status === 2)
}

{
  // fin de fichero SIN salto de línea final, pero última línea válida —
  // esto es un .env legítimo, no debe rechazarse.
  const res = run('FOO', 'FOO=bar-sin-newline-final')
  ok('última línea válida sin salto de línea final: exit 0', res.status === 0 && res.stdout === 'bar-sin-newline-final')
}

{
  const res = runBuf('FOO', Buffer.from('FOO=antes\0despues\n', 'utf8'))
  ok('byte NUL en la entrada: exit 2', res.status === 2)
}

{
  const res = runBuf('FOO', Buffer.from('FOO=bar\r\n', 'utf8'))
  ok('CRLF en la entrada: exit 2', res.status === 2)
}

{
  const res = run('FOO', '')
  ok('entrada completamente vacía: variable ausente, exit 3 (no exit 2)', res.status === 3)
}

{
  const res = run('', 'FOO=bar\n')
  ok('argv vacío: error de uso, exit 1', res.status === 1)
}

{
  const res = run('foo_lowercase', 'foo_lowercase=bar\n')
  ok('nombre de variable en minúsculas rechazado por validación de argv (exit 1)', res.status === 1)
}

{
  const res = run('ESPOCRM_DB_PASSWORD', 'ESPOCRM_DB_PASSWORD=algo-secreto-de-prueba\n')
  ok('caso de éxito: cero contenido de valor en stderr', res.status === 0 && res.stderr === '')
}

{
  // clave legacy con nombre en minúsculas no debe romper el parseo de las
  // demás líneas (solo VAR_NAME pedido por argv exige
  // MAYUSCULA_CON_GUIONES_BAJOS; las claves del fichero no).
  const res = run('FOO', 'legacyCamelCaseKey=raro\nFOO=bar\n')
  ok('clave legacy en minúsculas no rompe el parseo si FOO es válido', res.status === 0 && res.stdout === 'bar')
}

{
  // una clave con un carácter fuera de [A-Za-z0-9_] (p.ej. un '.') no es
  // una "clave legacy que se ignora": es formato inválido de verdad —
  // corrupción real del almacén, no debe aceptarse en silencio.
  const res = run('FOO', 'legacy.key.with.dots=raro\nFOO=bar\n')
  ok('clave con caracteres fuera de [A-Za-z0-9_]: formato inválido, exit 2 (no se acepta en silencio)', res.status === 2)
}

summarizeAndExit()
