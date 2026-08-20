#!/usr/bin/env node
// Pruebas de lib/updateSecretsFileField.mjs — actualización atómica de UN
// campo de un $SECRETS_FILE plano ya existente, reutilizando el patrón
// aceptado en el Bloque 2 (Bloque 5, Revisión 2, punto 4). Todo bajo un
// directorio desechable fuera del repositorio, con secretos ficticios.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, symlinkSync, statSync, lstatSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'
import { MANDATORY_KEYS_ACTIVE, MANDATORY_KEYS_LEGACY_PRE_S7, LEGACY_PRE_S7_KEY_INVENTORY } from './backupSchema.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'updateSecretsFileField.mjs')

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

// Documento base: todas las claves obligatorias + ESPOCRM_API_KEY (no
// obligatoria, pero SÍ perteneciente al inventario cerrado) — con un
// comentario y una línea en blanco intercalados, para demostrar que se
// preservan byte a byte.
function baseSecretsFileText() {
  const lines = ['# comentario preexistente', '']
  for (const k of MANDATORY_KEYS_ACTIVE) lines.push(`${k}=valor-original-${k.toLowerCase()}`)
  lines.push('ESPOCRM_API_KEY=api-key-original-000')
  return lines.join('\n') + '\n'
}

function writeSecretsFile(dir, name, text) {
  const p = path.join(dir, name)
  writeFileSync(p, text, { mode: 0o600 })
  return p
}

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-updatefield-test-'))

// --- camino feliz: valor crudo por stdin ---
{
  const secretsFile = writeSecretsFile(dir, 'happy.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'happy.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], 'api-key-nueva-generada-por-recuperacion')
  ok('camino feliz (valor crudo): exit 0', res.status === 0)
  ok('camino feliz: el temporal ya no existe (renombrado)', !existsSync(tmp))
  const content = readFileSync(secretsFile, 'utf8')
  ok('camino feliz: la clave objetivo quedó actualizada', content.includes('ESPOCRM_API_KEY=api-key-nueva-generada-por-recuperacion\n'))
  ok('camino feliz: el resto del documento se preserva byte a byte (comentario)', content.startsWith('# comentario preexistente\n\n'))
  ok('camino feliz: una clave NO tocada conserva su valor original exacto', content.includes(`${MANDATORY_KEYS_ACTIVE[0]}=valor-original-${MANDATORY_KEYS_ACTIVE[0].toLowerCase()}\n`))
  ok('camino feliz: el destino conserva modo 600', (statSync(secretsFile).mode & 0o777).toString(8) === '600')
  ok('camino feliz: el destino conserva el mismo inodo que tenía el temporal', lstatSync(secretsFile).ino === ino)
}

// --- camino feliz: extracción de un campo JSON (streaming, sin fichero intermedio) ---
{
  const secretsFile = writeSecretsFile(dir, 'jsonfield.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'jsonfield.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active', '--json-field', 'apiKey'], JSON.stringify({ id: 'user-1', apiKey: 'clave-extraida-del-json' }))
  ok('json-field: exit 0', res.status === 0)
  ok('json-field: extrae y escribe el campo correcto', readFileSync(secretsFile, 'utf8').includes('ESPOCRM_API_KEY=clave-extraida-del-json\n'))
}

// --- respuesta JSON corrupta ---
{
  const secretsFile = writeSecretsFile(dir, 'badjson.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'badjson.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active', '--json-field', 'apiKey'], '{esto no es json')
  ok('respuesta JSON corrupta: exit 2, sin tocar el destino', res.status === 2 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- respuesta JSON sin el campo esperado ---
{
  const secretsFile = writeSecretsFile(dir, 'missingfield.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'missingfield.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active', '--json-field', 'apiKey'], JSON.stringify({ id: 'user-1' }))
  ok('respuesta JSON sin "apiKey": exit 2, sin tocar el destino', res.status === 2 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- valor nuevo vacío: rechazado por el contrato cerrado ---
{
  const secretsFile = writeSecretsFile(dir, 'emptyvalue.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'emptyvalue.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], '')
  ok('valor nuevo vacío: exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- valor nuevo con LF embebido: rechazado por el contrato cerrado ---
{
  const secretsFile = writeSecretsFile(dir, 'lfvalue.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'lfvalue.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], 'linea1\nlinea2')
  ok('valor nuevo con LF: exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- clave objetivo ausente del documento: rechazado ---
{
  const textWithoutKey = baseSecretsFileText()
    .split('\n')
    .filter((l) => !l.startsWith('ESPOCRM_API_KEY='))
    .join('\n')
  const secretsFile = writeSecretsFile(dir, 'missingkey.env', textWithoutKey)
  const tmp = newTemp(dir, 'missingkey.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], 'valor-nuevo')
  ok('clave objetivo ausente: exit 2, sin tocar el destino', res.status === 2 && readFileSync(secretsFile, 'utf8') === textWithoutKey)
}

// --- documento con clave duplicada: rechazado (parsePlainEnvEntries falla primero) ---
{
  const dupText = baseSecretsFileText() + 'ESPOCRM_API_KEY=api-key-duplicada\n'
  const secretsFile = writeSecretsFile(dir, 'dupkey.env', dupText)
  const tmp = newTemp(dir, 'dupkey.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], 'valor-nuevo')
  ok('documento con clave duplicada: exit 2, sin tocar el destino', res.status === 2 && readFileSync(secretsFile, 'utf8') === dupText)
}

// --- preimagen es un symlink: rechazada sin seguirla ---
{
  const realTarget = path.join(dir, 'preimage-real.env')
  writeFileSync(realTarget, 'CONTENIDO-QUE-DEBE-SOBREVIVIR', { mode: 0o600 })
  const link = path.join(dir, 'preimage-symlink.env')
  symlinkSync(realTarget, link)
  const tmp = newTemp(dir, 'symlinkpreimage.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([link, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], 'valor-nuevo')
  ok('preimagen symlink: exit 14, rechazada sin seguirla', res.status === 14)
  ok('preimagen symlink: el objetivo real no se ha tocado', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
}

// --- preimagen con modo distinto de 600: rechazada ---
{
  const secretsFile = writeSecretsFile(dir, 'badmode.env', baseSecretsFileText())
  statSync(secretsFile) // sanity
  const fsMod = await import('node:fs')
  fsMod.chmodSync(secretsFile, 0o644)
  const tmp = newTemp(dir, 'badmode.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], 'valor-nuevo')
  ok('preimagen con modo != 600: exit 14, sin tocar el destino', res.status === 14 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- identidad del temporal no coincide ANTES de escribir ---
{
  const secretsFile = writeSecretsFile(dir, 'pinmismatch.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'pinmismatch.tmp')
  const res = run([secretsFile, tmp, '999999', '999999', '999999', '600', 'ESPOCRM_API_KEY', 'active'], 'valor-nuevo')
  ok('identidad no coincide (pre-escritura): exit 10', res.status === 10)
  ok('identidad no coincide: el temporal sigue vacío e intacto', existsSync(tmp) && readFileSync(tmp, 'utf8') === '')
  ok('identidad no coincide: destino sin tocar', readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- ruta temporal es un symlink: rechazada sin seguirla, ni rename ni escritura ---
{
  const secretsFile = writeSecretsFile(dir, 'symlinktmp.env', baseSecretsFileText())
  const realTarget = path.join(dir, 'symlinktmp-objetivo.txt')
  writeFileSync(realTarget, 'CONTENIDO-QUE-DEBE-SOBREVIVIR', { mode: 0o600 })
  const link = path.join(dir, 'symlinktmp.tmp')
  symlinkSync(realTarget, link)
  const res = run([secretsFile, link, '1', '1', '1', '600', 'ESPOCRM_API_KEY', 'active'], 'valor-nuevo')
  ok('ruta temporal es symlink: exit 10 (ELOOP vía O_NOFOLLOW)', res.status === 10)
  ok('el objetivo del symlink no se ha tocado', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
  ok('destino sin tocar', readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- fallo del propio rename (directorio destino inexistente) ---
{
  const missingDir = path.join(dir, 'no-existe-este-directorio')
  const secretsFile = path.join(missingDir, 'target.env') // nunca se crea el directorio
  const tmp = newTemp(dir, 'renamefail.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], 'valor-nuevo')
  // La preimagen tampoco existe -> falla antes, en la comprobación de
  // preimagen (14) — confirma que nunca se intenta un rename a ciegas
  // sin preimagen válida.
  ok('preimagen inexistente: rechazada (exit 14), nunca llega al rename', res.status === 14)
}

// --- cero contenido de valores en stderr ---
{
  const secretsFile = writeSecretsFile(dir, 'nostderr.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'nostderr.tmp')
  const res = run([secretsFile, tmp, '999999', '999999', '999999', '600', 'ESPOCRM_API_KEY', 'active'], 'valor-secreto-que-nunca-debe-aparecer')
  ok('ningún valor aparece en stderr', !res.stderr.includes('valor-secreto-que-nunca-debe-aparecer'))
  ok('ningún valor aparece en stdout', !res.stdout.includes('valor-secreto-que-nunca-debe-aparecer'))
}

// --- uso incorrecto: faltan argumentos ---
{
  const res = spawnSync(process.execPath, [SCRIPT, '/tmp/x'], { encoding: 'utf8' })
  ok('argv incompleto: exit 1', res.status === 1)
}

// --- uso incorrecto: KEY_NAME con forma inválida ---
{
  const secretsFile = writeSecretsFile(dir, 'badkeyname.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'badkeyname.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'not-a-valid-key-name', 'active'], 'valor-nuevo')
  ok('KEY_NAME con forma inválida: exit 1', res.status === 1)
}

// --- uso incorrecto: <schemaVersion> desconocida ---
{
  const secretsFile = writeSecretsFile(dir, 'badschema.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'badschema.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'no-existe-esta-version'], 'valor-nuevo')
  ok('schemaVersion desconocida: exit 1, sin tocar el destino', res.status === 1 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- Bloque 6: <schemaVersion>="legacy-pre-s7" — S4 se ejecuta ANTES que
//     S7 en el orden real S1→S9, así que el documento puede seguir
//     teniendo esta forma en el momento de actualizar ESPOCRM_API_KEY
//     (bug real, detectado y corregido: la primera versión de este
//     script fijaba "active" a ciegas, lo que habría bloqueado S4 en una
//     ejecución real anterior a S7). ---
function legacyPreS7SecretsFileText() {
  const lines = ['# comentario preexistente', '']
  for (const k of MANDATORY_KEYS_LEGACY_PRE_S7) lines.push(`${k}=valor-original-${k.toLowerCase()}`)
  lines.push('ESPOCRM_API_KEY=api-key-original-000')
  return lines.join('\n') + '\n'
}
{
  ok(
    'fixture legacy-pre-s7: ESPOCRM_API_KEY pertenece a su inventario cerrado (sanity de la propia prueba)',
    LEGACY_PRE_S7_KEY_INVENTORY.includes('ESPOCRM_API_KEY'),
  )
  const secretsFile = writeSecretsFile(dir, 'legacy.env', legacyPreS7SecretsFileText())
  const tmp = newTemp(dir, 'legacy.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'legacy-pre-s7'], 'api-key-nueva-en-esquema-legacy')
  ok('legacy-pre-s7: exit 0 (nunca exige la forma "active" antes de que S7 haya corrido)', res.status === 0)
  ok('legacy-pre-s7: la clave objetivo quedó actualizada', readFileSync(secretsFile, 'utf8').includes('ESPOCRM_API_KEY=api-key-nueva-en-esquema-legacy\n'))
}
{
  // El mismo documento legacy-pre-s7, pero pidiendo validarlo como
  // "active" — debe rechazarse (las claves plurales/versionadas de
  // booking-email/access-token son obligatorias en "active" y este
  // documento tiene las variantes singulares en su lugar).
  const secretsFile = writeSecretsFile(dir, 'legacy-as-active.env', legacyPreS7SecretsFileText())
  const tmp = newTemp(dir, 'legacy-as-active.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'ESPOCRM_API_KEY', 'active'], 'valor-nuevo')
  ok('documento legacy-pre-s7 validado como "active": rechazado (mezcla de esquema), sin tocar el destino', res.status !== 0 && readFileSync(secretsFile, 'utf8') === legacyPreS7SecretsFileText())
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
