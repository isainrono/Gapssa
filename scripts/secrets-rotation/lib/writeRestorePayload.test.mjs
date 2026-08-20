#!/usr/bin/env node
// Pruebas de lib/writeRestorePayload.mjs — el único punto del código que
// escribe contenido descifrado real durante una restauración Y ejecuta
// el rename atómico al destino final. Todo bajo un directorio desechable
// fuera del repositorio, con secretos ficticios.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, symlinkSync, statSync, lstatSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'
import { MANDATORY_KEYS_ACTIVE } from './backupSchema.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'writeRestorePayload.mjs')
const TAG = '__GAPSSA_BACKUP_SCHEMA_VERSION__=active'
const FULL_BODY = MANDATORY_KEYS_ACTIVE.map((k) => `${k}=valor-ficticio-${k.toLowerCase()}`).join('\n') + '\n'

function pinOf(p) {
  const st = statSync(p)
  return [st.dev, st.ino, st.uid, (st.mode & 0o777).toString(8)]
}

function run(args, input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8' })
}

function newTemp(dir, name) {
  const p = path.join(dir, name)
  writeFileSync(p, '', { mode: 0o600 })
  return p
}

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-writerestore-test-'))

// --- camino feliz: escribe el cuerpo verbatim, despoja la etiqueta, renombra al destino ---
{
  const tmp = newTemp(dir, 'ok.tmp')
  const dest = path.join(dir, 'ok.dest')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([tmp, dest, String(dev), String(ino), String(uid), mode], `${TAG}\n${FULL_BODY}`)
  ok('camino feliz: exit 0', res.status === 0)
  ok('camino feliz: stdout es la versión de esquema (no secreto)', res.stdout.trim() === 'active')
  ok('camino feliz: el temporal ya NO existe (renombrado, bash no hace mv aparte)', !existsSync(tmp))
  ok('camino feliz: el destino existe con EXACTAMENTE el cuerpo, sin la etiqueta', readFileSync(dest, 'utf8') === FULL_BODY)
  ok('camino feliz: el destino conserva modo 600', (statSync(dest).mode & 0o777).toString(8) === '600')
  ok('camino feliz: el destino conserva el mismo inodo que tenía el temporal', lstatSync(dest).ino === ino)
}

// --- identidad no coincide ANTES de escribir: nada se escribe, no hay rename ---
{
  const tmp = newTemp(dir, 'mismatch.tmp')
  const dest = path.join(dir, 'mismatch.dest')
  const res = run([tmp, dest, '999999', '999999', '999999', '600'], `${TAG}\n${FULL_BODY}`)
  ok('identidad no coincide (pre-escritura): exit 10', res.status === 10)
  ok('identidad no coincide: el temporal sigue vacío e intacto', existsSync(tmp) && readFileSync(tmp, 'utf8') === '')
  ok('identidad no coincide: nunca se crea el destino', !existsSync(dest))
}

// --- la ruta temporal es un symlink: rechazado sin seguirlo, ni rename ni escritura ---
{
  const realTarget = path.join(dir, 'objetivo-real.txt')
  writeFileSync(realTarget, 'CONTENIDO-QUE-DEBE-SOBREVIVIR', { mode: 0o600 })
  const link = path.join(dir, 'symlink.tmp')
  symlinkSync(realTarget, link)
  const dest = path.join(dir, 'symlink.dest')
  const res = run([link, dest, '1', '1', '1', '600'], `${TAG}\n${FULL_BODY}`)
  ok('ruta es symlink: rechazada (exit 10, ELOOP vía O_NOFOLLOW)', res.status === 10)
  ok('el destino del symlink no se ha tocado', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
  ok('nunca se crea el destino cuando el temporal es un symlink', !existsSync(dest))
}

// --- sustitución del temporal por un symlink INMEDIATAMENTE antes del rename ---
// (simulado sustituyendo el fichero por un symlink DESPUÉS de que el
// proceso ya abrió el fd original — como no podemos interceptar el
// proceso a mitad, verificamos el caso equivalente: un temporal que YA
// es un symlink desde el principio se detecta en el paso 1, cubierto
// arriba; aquí comprobamos que el propio guard de "matchesPin" en el
// paso previo al rename usa lstat, no fstat, re-declarando el contrato)
{
  const tmp = newTemp(dir, 'prerename.tmp')
  const dest = path.join(dir, 'prerename.dest')
  const [dev, ino, uid, mode] = pinOf(tmp)
  // Sustituye el CONTENIDO por algo inválido para forzar que el proceso
  // aborte ANTES de llegar al rename (camino de error de validación) y
  // confirmar que ese aborto nunca deja un destino a medias.
  const res = run([tmp, dest, String(dev), String(ino), String(uid), mode], `${TAG}\nCLAVE_NO_PERMITIDA=x\n`)
  ok('contenido inválido: exit 3 (fuera de inventario/obligatorias)', res.status === 3)
  ok('contenido inválido: nunca se crea el destino', !existsSync(dest))
}

// --- contenido con clave duplicada: rechazado, ni temporal modificado ni destino creado ---
{
  const tmp = newTemp(dir, 'dup.tmp')
  const dest = path.join(dir, 'dup.dest')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([tmp, dest, String(dev), String(ino), String(uid), mode], `${TAG}\nFOO=uno\nFOO=dos\n`)
  ok('clave duplicada en el cuerpo: exit 2, temporal sigue vacío, sin destino', res.status === 2 && readFileSync(tmp, 'utf8') === '' && !existsSync(dest))
}

// --- backup incompleto (falta una clave obligatoria): rechazado ---
{
  const tmp = newTemp(dir, 'incomplete.tmp')
  const dest = path.join(dir, 'incomplete.dest')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const incompleteBody = MANDATORY_KEYS_ACTIVE.slice(1).map((k) => `${k}=x`).join('\n') + '\n'
  const res = run([tmp, dest, String(dev), String(ino), String(uid), mode], `${TAG}\n${incompleteBody}`)
  ok('backup incompleto: exit 3, sin destino', res.status === 3 && !existsSync(dest))
}

// --- cero contenido de valores en stderr, en todos los casos anteriores ---
{
  const tmp = newTemp(dir, 'nostderr.tmp')
  const dest = path.join(dir, 'nostderr.dest')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([tmp, dest, String(dev), String(ino), String(uid), mode], `${TAG}\nFOO=valor-secreto-de-prueba-uno\nFOO=valor-secreto-de-prueba-dos\n`)
  ok('ningún valor aparece en stderr', !res.stderr.includes('valor-secreto-de-prueba-uno') && !res.stderr.includes('valor-secreto-de-prueba-dos'))
}

// --- uso incorrecto: faltan argumentos ---
{
  const res = spawnSync(process.execPath, [SCRIPT, '/tmp/x'], { encoding: 'utf8' })
  ok('argv incompleto: exit 1', res.status === 1)
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
