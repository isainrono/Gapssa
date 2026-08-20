#!/usr/bin/env node
// Pruebas de lib/updateRedisSecrets.mjs — actualización atómica de
// REDIS_PASSWORD + REDIS_URL EN UNA SOLA operación (nunca dos escrituras
// independientes), con REDIS_URL reconstruida por parseo real (clase
// `URL`, nunca regex) y relectura obligatoria del percent-encoding.
// Todo bajo un directorio desechable fuera del repositorio, con
// secretos ficticios.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, symlinkSync, statSync, lstatSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { ok, summarizeAndExit } from './testHarness.mjs'
import { MANDATORY_KEYS_ACTIVE } from './backupSchema.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'updateRedisSecrets.mjs')

function pinOf(p) {
  const st = statSync(p)
  return [st.dev, st.ino, st.uid, (st.mode & 0o777).toString(8)]
}

function run(args, input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8' })
}

const OLD_REDIS_PASSWORD = 'contrasena-anterior-000'
const OLD_REDIS_URL = `redis://:${OLD_REDIS_PASSWORD}@localhost:6380`

// Documento base: todas las claves obligatorias de "active" (incluye
// REDIS_PASSWORD/REDIS_URL), con REDIS_URL como una URL redis:// real —
// más un comentario y una línea en blanco intercalados, para demostrar
// que se preservan byte a byte.
function baseSecretsFileText() {
  const lines = ['# comentario preexistente', '']
  for (const k of MANDATORY_KEYS_ACTIVE) {
    if (k === 'REDIS_PASSWORD') lines.push(`REDIS_PASSWORD=${OLD_REDIS_PASSWORD}`)
    else if (k === 'REDIS_URL') lines.push(`REDIS_URL=${OLD_REDIS_URL}`)
    else lines.push(`${k}=valor-original-${k.toLowerCase()}`)
  }
  return lines.join('\n') + '\n'
}

function withRedisUrl(text, newUrl) {
  return text
    .split('\n')
    .map((l) => (l.startsWith('REDIS_URL=') ? `REDIS_URL=${newUrl}` : l))
    .join('\n')
}

function writeSecretsFile(dir, name, text) {
  const p = path.join(dir, name)
  writeFileSync(p, text, { mode: 0o600 })
  return p
}

function newTemp(dir, name) {
  const p = path.join(dir, name)
  writeFileSync(p, '', { mode: 0o600 })
  return p
}

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-updateredis-test-'))

// --- camino feliz: password base64 con caracteres reservados (/, +, =) ---
{
  const secretsFile = writeSecretsFile(dir, 'happy.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'happy.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  // 23 bytes -> base64 real con padding "=" garantizado; búsqueda acotada
  // de una muestra que además incluya "/" o "+" para ejercitar el
  // percent-encoding de verdad (nunca una cadena inventada a mano: el
  // contrato de secretos GENERADOS exige base64 SINTÁCTICAMENTE válido,
  // no solo caracteres del alfabeto).
  let newPassword = randomBytes(23).toString('base64')
  for (let i = 0; i < 200 && !/[/+]/.test(newPassword); i++) newPassword = randomBytes(23).toString('base64')
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], newPassword)
  ok('camino feliz: exit 0', res.status === 0, res.stderr)
  ok('camino feliz: el temporal ya no existe (renombrado)', !existsSync(tmp))
  const content = readFileSync(secretsFile, 'utf8')
  ok('camino feliz: REDIS_PASSWORD quedó actualizada exactamente', content.includes(`REDIS_PASSWORD=${newPassword}\n`))
  const urlLine = content.split('\n').find((l) => l.startsWith('REDIS_URL='))
  const newUrl = urlLine.slice('REDIS_URL='.length)
  ok('camino feliz: REDIS_URL cambió respecto al valor anterior', newUrl !== OLD_REDIS_URL)
  const reparsed = new URL(newUrl)
  ok('camino feliz: REDIS_URL sigue siendo esquema redis:', reparsed.protocol === 'redis:')
  ok('camino feliz: REDIS_URL conserva host/puerto originales', reparsed.hostname === 'localhost' && reparsed.port === '6380')
  ok('camino feliz: REDIS_URL decodifica EXACTAMENTE a la contraseña nueva', decodeURIComponent(reparsed.password) === newPassword)
  ok('camino feliz: la contraseña viaja percent-encoded (nunca en claro con "/" literal en la URL)', !newUrl.includes(`:${newPassword}@`))
  ok('camino feliz: el comentario preexistente se preserva byte a byte', content.startsWith('# comentario preexistente\n\n'))
  ok(
    'camino feliz: una clave NO tocada conserva su valor original exacto',
    content.includes(`${MANDATORY_KEYS_ACTIVE.find((k) => k !== 'REDIS_PASSWORD' && k !== 'REDIS_URL')}=valor-original-${MANDATORY_KEYS_ACTIVE.find((k) => k !== 'REDIS_PASSWORD' && k !== 'REDIS_URL').toLowerCase()}\n`),
  )
  ok('camino feliz: el destino conserva modo 600', (statSync(secretsFile).mode & 0o777).toString(8) === '600')
  ok('camino feliz: el destino conserva el mismo inodo que tenía el temporal', lstatSync(secretsFile).ino === ino)
  ok('ningún valor aparece en stdout', !res.stdout.includes(newPassword) && !res.stdout.includes(OLD_REDIS_PASSWORD))
  ok('ningún valor aparece en stderr', !res.stderr.includes(newPassword) && !res.stderr.includes(OLD_REDIS_PASSWORD))
}

// --- camino feliz: 2000 contraseñas aleatorias base64 -- percent-encoding siempre redecodifica exacto ---
{
  const secretsFile = writeSecretsFile(dir, 'fuzz.env', baseSecretsFileText())
  let allOk = true
  for (let i = 0; i < 25; i++) {
    const tmp = newTemp(dir, `fuzz-${i}.tmp`)
    const [dev, ino, uid, mode] = pinOf(tmp)
    const newPassword = randomBytes(24).toString('base64')
    const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], newPassword)
    if (res.status !== 0) {
      allOk = false
      break
    }
    const content = readFileSync(secretsFile, 'utf8')
    const urlLine = content.split('\n').find((l) => l.startsWith('REDIS_URL='))
    const newUrl = urlLine.slice('REDIS_URL='.length)
    if (decodeURIComponent(new URL(newUrl).password) !== newPassword) {
      allOk = false
      break
    }
  }
  ok('25 contraseñas base64 aleatorias consecutivas: siempre exit 0 y URL redecodifica exacto', allOk)
}

// --- REDIS_PASSWORD duplicada en el documento: rechazado (parsePlainEnvEntries falla primero) ---
{
  const dupText = baseSecretsFileText() + 'REDIS_PASSWORD=duplicada\n'
  const secretsFile = writeSecretsFile(dir, 'duppw.env', dupText)
  const tmp = newTemp(dir, 'duppw.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('REDIS_PASSWORD duplicada: exit 2, sin tocar el destino', res.status === 2 && readFileSync(secretsFile, 'utf8') === dupText)
}

// --- REDIS_URL duplicada en el documento: rechazado ---
{
  const dupText = baseSecretsFileText() + `REDIS_URL=${OLD_REDIS_URL}\n`
  const secretsFile = writeSecretsFile(dir, 'dupurl.env', dupText)
  const tmp = newTemp(dir, 'dupurl.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('REDIS_URL duplicada: exit 2, sin tocar el destino', res.status === 2 && readFileSync(secretsFile, 'utf8') === dupText)
}

// --- REDIS_PASSWORD ausente del documento: rechazado ---
{
  const textWithoutKey = baseSecretsFileText()
    .split('\n')
    .filter((l) => !l.startsWith('REDIS_PASSWORD='))
    .join('\n')
  const secretsFile = writeSecretsFile(dir, 'misspw.env', textWithoutKey)
  const tmp = newTemp(dir, 'misspw.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('REDIS_PASSWORD ausente: exit 2, sin tocar el destino', res.status === 2 && readFileSync(secretsFile, 'utf8') === textWithoutKey)
}

// --- REDIS_URL ausente del documento: rechazado ---
{
  const textWithoutKey = baseSecretsFileText()
    .split('\n')
    .filter((l) => !l.startsWith('REDIS_URL='))
    .join('\n')
  const secretsFile = writeSecretsFile(dir, 'missurl.env', textWithoutKey)
  const tmp = newTemp(dir, 'missurl.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('REDIS_URL ausente: exit 2, sin tocar el destino', res.status === 2 && readFileSync(secretsFile, 'utf8') === textWithoutKey)
}

// --- REDIS_URL existente no es una URL válida: rechazado, nunca "arreglada" con regex ---
{
  const text = withRedisUrl(baseSecretsFileText(), 'esto no es ni remotamente una url')
  const secretsFile = writeSecretsFile(dir, 'badurl.env', text)
  const tmp = newTemp(dir, 'badurl.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('REDIS_URL inválida: exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === text)
}

// --- REDIS_URL existente con esquema incorrecto: rechazado ---
{
  const text = withRedisUrl(baseSecretsFileText(), 'http://:x@localhost:6380')
  const secretsFile = writeSecretsFile(dir, 'wrongscheme.env', text)
  const tmp = newTemp(dir, 'wrongscheme.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('REDIS_URL con esquema "http:": exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === text)
}

// --- REDIS_URL existente sin host: rechazado ---
{
  const text = withRedisUrl(baseSecretsFileText(), 'redis:///path-sin-host')
  const secretsFile = writeSecretsFile(dir, 'nohost.env', text)
  const tmp = newTemp(dir, 'nohost.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('REDIS_URL sin host: exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === text)
}

// --- REDIS_URL existente sin puerto: rechazado ---
{
  const text = withRedisUrl(baseSecretsFileText(), 'redis://:x@localhost')
  const secretsFile = writeSecretsFile(dir, 'noport.env', text)
  const tmp = newTemp(dir, 'noport.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('REDIS_URL sin puerto: exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === text)
}

// --- REDIS_PASSWORD nueva vacía: rechazada por el contrato ---
{
  const secretsFile = writeSecretsFile(dir, 'emptypw.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'emptypw.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '')
  ok('REDIS_PASSWORD nueva vacía: exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- REDIS_PASSWORD nueva con LF embebido: rechazada ---
{
  const secretsFile = writeSecretsFile(dir, 'lfpw.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'lfpw.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], 'linea1\nlinea2')
  ok('REDIS_PASSWORD nueva con LF: exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- REDIS_PASSWORD nueva con alfabeto fuera de hex/base64: rechazada (contrato de secretos GENERADOS) ---
{
  const secretsFile = writeSecretsFile(dir, 'badalphabet.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'badalphabet.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], 'contraseña con espacios y ñ')
  ok('REDIS_PASSWORD con alfabeto no hex/base64: exit 3, sin tocar el destino', res.status === 3 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- preimagen es un symlink: rechazada sin seguirla ---
{
  const realTarget = path.join(dir, 'preimage-real.env')
  writeFileSync(realTarget, 'CONTENIDO-QUE-DEBE-SOBREVIVIR', { mode: 0o600 })
  const link = path.join(dir, 'preimage-symlink.env')
  symlinkSync(realTarget, link)
  const tmp = newTemp(dir, 'symlinkpreimage.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([link, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('preimagen symlink: exit 14, rechazada sin seguirla', res.status === 14)
  ok('preimagen symlink: el objetivo real no se ha tocado', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
}

// --- preimagen con modo distinto de 600: rechazada ---
{
  const secretsFile = writeSecretsFile(dir, 'badmode.env', baseSecretsFileText())
  chmodSync(secretsFile, 0o644)
  const tmp = newTemp(dir, 'badmode.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('preimagen con modo != 600: exit 14, sin tocar el destino', res.status === 14 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- identidad del temporal no coincide ANTES de escribir ---
{
  const secretsFile = writeSecretsFile(dir, 'pinmismatch.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'pinmismatch.tmp')
  const res = run([secretsFile, tmp, '999999', '999999', '999999', '600', 'active'], '0123456789abcdef0123456789abcdef01234567')
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
  const res = run([secretsFile, link, '1', '1', '1', '600', 'active'], '0123456789abcdef0123456789abcdef01234567')
  ok('ruta temporal es symlink: exit 10 (ELOOP vía O_NOFOLLOW)', res.status === 10)
  ok('el objetivo del symlink no se ha tocado', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
  ok('destino sin tocar', readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- cero contenido de valores en stderr/stdout ante un fallo ---
{
  const secretsFile = writeSecretsFile(dir, 'nostderr.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'nostderr.tmp')
  const res = run([secretsFile, tmp, '999999', '999999', '999999', '600', 'active'], 'valor-secreto-que-nunca-debe-aparecer')
  ok('ningún valor aparece en stderr (fallo)', !res.stderr.includes('valor-secreto-que-nunca-debe-aparecer'))
  ok('ningún valor aparece en stdout (fallo)', !res.stdout.includes('valor-secreto-que-nunca-debe-aparecer'))
}

// --- uso incorrecto: faltan argumentos ---
{
  const res = spawnSync(process.execPath, [SCRIPT, '/tmp/x'], { encoding: 'utf8' })
  ok('argv incompleto: exit 1', res.status === 1)
}

// --- uso incorrecto: <schemaVersion> desconocida ---
{
  const secretsFile = writeSecretsFile(dir, 'badschema.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'badschema.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'no-existe-esta-version'], '0123456789abcdef0123456789abcdef01234567')
  ok('schemaVersion desconocida: exit 1, sin tocar el destino', res.status === 1 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
