#!/usr/bin/env node
// Pruebas de lib/atomicSecretsFileMutate.mjs — escritura atómica de
// VARIAS mutaciones de campo en una única reescritura de $SECRETS_FILE
// (Bloque 9, S7 atómico y reanudable). Todo bajo un directorio desechable
// fuera del repositorio, con secretos ficticios.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, statSync, lstatSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, summarizeAndExit } from './testHarness.mjs'
import { MANDATORY_KEYS_ACTIVE } from './backupSchema.mjs'
import { applyMutations, validateMutationsList } from './atomicSecretsFileMutate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'atomicSecretsFileMutate.mjs')

function pinOf(p) {
  const st = statSync(p)
  return [st.dev, st.ino, st.uid, (st.mode & 0o777).toString(8)]
}

function run(args, input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8' })
}

function runWithEnv(args, input, envOverrides) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8', env: { ...process.env, ...envOverrides } })
}

function newTemp(dir, name) {
  const p = path.join(dir, name)
  writeFileSync(p, '', { mode: 0o600 })
  return p
}

function baseSecretsFileText() {
  const lines = ['# comentario preexistente', '']
  for (const k of MANDATORY_KEYS_ACTIVE) {
    if (k.endsWith('_KEYS') || k.endsWith('_SECRETS')) {
      lines.push(`${k}=${JSON.stringify({ v1: `valor-v1-${k.toLowerCase()}` })}`)
    } else if (k.endsWith('_ACTIVE_KEY_VERSION')) {
      lines.push(`${k}=v1`)
    } else {
      lines.push(`${k}=valor-original-${k.toLowerCase()}`)
    }
  }
  return lines.join('\n') + '\n'
}

function writeSecretsFile(dir, name, text) {
  const p = path.join(dir, name)
  writeFileSync(p, text, { mode: 0o600 })
  return p
}

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-atomicmutate-test-'))

// =====================================================================
// Pruebas unitarias PURAS de applyMutations (sin proceso hijo, generador
// determinista inyectado) — la idempotencia crítica se prueba aquí Y en
// el camino CLI completo más abajo.
// =====================================================================
{
  const lines = ['BOOKING_FIELD_ENCRYPTION_KEYS={"v1":"AAAA"}', 'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION=v1']
  let calls = 0
  const gen = (n) => {
    calls += 1
    return Buffer.from('B'.repeat(n))
  }
  const r1 = applyMutations(lines, [{ op: 'json-map-generate', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versionKey: 'v3', bytes: 32, format: 'hex' }], gen)
  ok('json-map-generate (primera vez): cambia y genera una vez', r1.changed === true && calls === 1)
  ok('json-map-generate: v3 añadido conservando v1', JSON.parse(r1.lines[0].split('=').slice(1).join('=')).v1 === 'AAAA')

  // Relanzar la MISMA mutación sobre el documento YA mutado (simula una
  // reanudación tras interrupción) — nunca debe regenerar v3.
  const r2 = applyMutations(r1.lines, [{ op: 'json-map-generate', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versionKey: 'v3', bytes: 32, format: 'hex' }], gen)
  ok('json-map-generate (reanudación): idempotente — no cambia nada', r2.changed === false && r2.skipped.includes('BOOKING_FIELD_ENCRYPTION_KEYS.v3'))
  ok('json-map-generate (reanudación): el generador NUNCA se vuelve a invocar', calls === 1)
  const v3FromFirst = JSON.parse(r1.lines[0].split('=').slice(1).join('=')).v3
  const v3FromResume = JSON.parse(r2.lines[0].split('=').slice(1).join('=')).v3
  ok('json-map-generate (reanudación): v3 conserva el valor de la primera generación', v3FromFirst === v3FromResume)
}

{
  // json-map-retain: pedir conservar una versión ausente se rechaza sin tocar nada.
  const lines = ['BOOKING_FIELD_ENCRYPTION_KEYS={"v1":"AAAA","v3":"BBBB"}']
  let threw = null
  try {
    applyMutations(lines, [{ op: 'json-map-retain', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versions: ['v9'] }], () => Buffer.from('x'))
  } catch (err) {
    threw = err
  }
  ok('json-map-retain: versión ausente pedida como conservar -> rechazado', threw !== null && /no contiene la versión/.test(threw.message))
}

{
  // json-map-retain: idempotente si el mapa YA es exactamente el conjunto pedido.
  const lines = ['BOOKING_FIELD_ENCRYPTION_KEYS={"v3":"BBBB"}']
  const r = applyMutations(lines, [{ op: 'json-map-retain', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versions: ['v3'] }], () => Buffer.from('x'))
  ok('json-map-retain: idempotente si ya coincide exactamente', r.changed === false && r.skipped.includes('BOOKING_FIELD_ENCRYPTION_KEYS'))
}

{
  // Varias mutaciones sobre CLAVES DISTINTAS en una sola pasada (caso de
  // "activar v3 en los 4 mapas" con una sola reescritura).
  const lines = [
    'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION=v1',
    'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION=v1',
    'UNRELATED_KEY=sin-tocar',
  ]
  const r = applyMutations(
    lines,
    [
      { op: 'set-line', key: 'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION', value: 'v3' },
      { op: 'set-line', key: 'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION', value: 'v3' },
    ],
    () => Buffer.from('x'),
  )
  ok('multi-mutación en una pasada: ambas claves activadas', r.lines[0] === 'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION=v3' && r.lines[1] === 'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION=v3')
  ok('multi-mutación: la clave no mencionada queda intacta', r.lines[2] === 'UNRELATED_KEY=sin-tocar')
  ok('multi-mutación: changed=true', r.changed === true)
}

{
  // set-line idempotente: ya en el valor destino -> no-op.
  const lines = ['BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION=v3']
  const r = applyMutations(lines, [{ op: 'set-line', key: 'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION', value: 'v3' }], () => Buffer.from('x'))
  ok('set-line: idempotente si ya vale exactamente eso', r.changed === false && r.skipped.includes('BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION'))
}

{
  // clave mutada ausente del documento -> rechazado.
  let threw = null
  try {
    applyMutations(['OTHER=x'], [{ op: 'set-line', key: 'MISSING_KEY', value: 'v3' }], () => Buffer.from('x'))
  } catch (err) {
    threw = err
  }
  ok('clave ausente del documento -> rechazado', threw !== null && /no está presente/.test(threw.message))
}

{
  // forma cerrada: mutación duplicada sobre la misma clave -> rechazada.
  let threw = null
  try {
    validateMutationsList([
      { op: 'set-line', key: 'K', value: 'a' },
      { op: 'set-line', key: 'K', value: 'b' },
    ])
  } catch (err) {
    threw = err
  }
  ok('dos mutaciones sobre la misma clave en una invocación -> rechazado', threw !== null && /ya tiene otra mutación/.test(threw.message))
}

// =====================================================================
// Camino CLI completo (proceso hijo real, temporal pinneado real).
// =====================================================================

// --- camino feliz: set-line ---
{
  const secretsFile = writeSecretsFile(dir, 'setline.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'setline.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'valor-nuevo-de-prueba-suficientemente-largo' }])
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations)
  ok('set-line CLI: exit 0', res.status === 0)
  ok('set-line CLI: temporal consumido (renombrado)', !existsSync(tmp))
  ok('set-line CLI: valor actualizado', readFileSync(secretsFile, 'utf8').includes('BOOKING_INTERNAL_API_SECRET=valor-nuevo-de-prueba-suficientemente-largo\n'))
  ok('set-line CLI: destino conserva el inodo del temporal', lstatSync(secretsFile).ino === ino)
  const summary = JSON.parse(res.stdout)
  ok('set-line CLI: resumen stdout solo trae nombres/booleanos', summary.changed === true && summary.applied.includes('BOOKING_INTERNAL_API_SECRET'))
  ok('set-line CLI: el resumen NUNCA incluye el valor', !res.stdout.includes('valor-nuevo-de-prueba-suficientemente-largo'))
}

// --- camino feliz: set-line-generate (nunca imprime el valor) ---
{
  const secretsFile = writeSecretsFile(dir, 'setlinegen.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'setlinegen.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const before = readFileSync(secretsFile, 'utf8').match(/^BOOKING_INTERNAL_API_SECRET=(.*)$/m)[1]
  const mutations = JSON.stringify([{ op: 'set-line-generate', key: 'BOOKING_INTERNAL_API_SECRET', bytes: 32, format: 'base64' }])
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations)
  ok('set-line-generate CLI: exit 0', res.status === 0)
  const after = readFileSync(secretsFile, 'utf8').match(/^BOOKING_INTERNAL_API_SECRET=(.*)$/m)[1]
  ok('set-line-generate CLI: valor rotado (distinto del original)', after !== before && after.length > 0)
  ok('set-line-generate CLI: nunca imprime el valor generado', !res.stdout.includes(after) && !res.stderr.includes(after))
}

// --- camino feliz: json-map-generate añade v3 SIN tocar v1 ---
{
  const secretsFile = writeSecretsFile(dir, 'mapgen.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'mapgen.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'json-map-generate', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versionKey: 'v3', bytes: 32, format: 'base64' }])
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations)
  ok('json-map-generate CLI: exit 0', res.status === 0)
  const line = readFileSync(secretsFile, 'utf8').match(/^BOOKING_FIELD_ENCRYPTION_KEYS=(.*)$/m)[1]
  const map = JSON.parse(line)
  ok('json-map-generate CLI: v1 preservado', map.v1 === 'valor-v1-booking_field_encryption_keys')
  ok('json-map-generate CLI: v3 añadido', typeof map.v3 === 'string' && map.v3.length > 0)
}

// --- IDEMPOTENCIA CRÍTICA vía CLI: relanzar json-map-generate tras "interrupción" nunca sustituye v3 ---
{
  const secretsFile = writeSecretsFile(dir, 'mapgen-resume.env', baseSecretsFileText())
  const tmp1 = newTemp(dir, 'mapgen-resume-1.tmp')
  {
    const [dev, ino, uid, mode] = pinOf(tmp1)
    const mutations = JSON.stringify([{ op: 'json-map-generate', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versionKey: 'v3', bytes: 32, format: 'base64' }])
    const res = run([secretsFile, tmp1, String(dev), String(ino), String(uid), mode, 'active'], mutations)
    ok('idempotencia crítica: primera ejecución exit 0', res.status === 0)
  }
  const v3AfterFirstRun = JSON.parse(readFileSync(secretsFile, 'utf8').match(/^BOOKING_FIELD_ENCRYPTION_KEYS=(.*)$/m)[1]).v3

  // Segunda "ejecución" (simula relanzar gate_s7 tras una interrupción) —
  // temporal DISTINTO (como haría bash de verdad), misma mutación.
  const tmp2 = newTemp(dir, 'mapgen-resume-2.tmp')
  const [dev2, ino2, uid2, mode2] = pinOf(tmp2)
  const mutations2 = JSON.stringify([{ op: 'json-map-generate', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versionKey: 'v3', bytes: 32, format: 'base64' }])
  const res2 = run([secretsFile, tmp2, String(dev2), String(ino2), String(uid2), mode2, 'active'], mutations2)
  ok('idempotencia crítica: reanudación exit 20 (no-op)', res2.status === 20)
  ok('idempotencia crítica: el temporal de la reanudación NUNCA se consume (bash debe borrarlo)', existsSync(tmp2))
  const v3AfterSecondRun = JSON.parse(readFileSync(secretsFile, 'utf8').match(/^BOOKING_FIELD_ENCRYPTION_KEYS=(.*)$/m)[1]).v3
  ok('idempotencia crítica: v3 NUNCA cambia entre la primera ejecución y la reanudación (ninguna fila ya recifrada con v3 queda huérfana)', v3AfterFirstRun === v3AfterSecondRun)
  rmSync(tmp2, { force: true })
}

// --- camino feliz: json-map-retain retira versiones viejas ---
{
  const text = baseSecretsFileText().replace(
    /^BOOKING_FIELD_ENCRYPTION_KEYS=.*$/m,
    `BOOKING_FIELD_ENCRYPTION_KEYS=${JSON.stringify({ v1: 'AAAA', v2: 'BBBB', v3: 'CCCC' })}`,
  )
  const secretsFile = writeSecretsFile(dir, 'retain.env', text)
  const tmp = newTemp(dir, 'retain.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'json-map-retain', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versions: ['v3'] }])
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations)
  ok('json-map-retain CLI: exit 0', res.status === 0)
  const map = JSON.parse(readFileSync(secretsFile, 'utf8').match(/^BOOKING_FIELD_ENCRYPTION_KEYS=(.*)$/m)[1])
  ok('json-map-retain CLI: solo v3 sobrevive', Object.keys(map).length === 1 && map.v3 === 'CCCC')
}

// --- json-map-retain: versión pedida ausente -> exit 2, destino intacto ---
{
  const secretsFile = writeSecretsFile(dir, 'retain-missing.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'retain-missing.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const before = readFileSync(secretsFile, 'utf8')
  const mutations = JSON.stringify([{ op: 'json-map-retain', key: 'BOOKING_FIELD_ENCRYPTION_KEYS', versions: ['v9-nunca-existio'] }])
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations)
  ok('json-map-retain versión ausente: exit 2, destino intacto', res.status === 2 && readFileSync(secretsFile, 'utf8') === before)
}

// --- NO-OP completo: todas las mutaciones ya aplicadas -> exit 20, temporal sin consumir ---
{
  const secretsFile = writeSecretsFile(dir, 'noop.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'noop.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const currentValue = readFileSync(secretsFile, 'utf8').match(/^BOOKING_INTERNAL_API_SECRET=(.*)$/m)[1]
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: currentValue }])
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations)
  ok('no-op completo: exit 20', res.status === 20)
  ok('no-op completo: el temporal NUNCA se consume', existsSync(tmp))
  ok('no-op completo: destino byte a byte intacto', readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- preimagen symlink: rechazada sin seguirla ---
{
  const realTarget = path.join(dir, 'preimage-real2.env')
  writeFileSync(realTarget, 'CONTENIDO-QUE-DEBE-SOBREVIVIR', { mode: 0o600 })
  const link = path.join(dir, 'preimage-symlink2.env')
  symlinkSync(realTarget, link)
  const tmp = newTemp(dir, 'symlinkpreimage2.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'x'.repeat(20) }])
  const res = run([link, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations)
  ok('preimagen symlink: exit 14', res.status === 14)
  ok('preimagen symlink: el objetivo real no se ha tocado', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
}

// --- preimagen con modo distinto de 600: rechazada ---
{
  const secretsFile = writeSecretsFile(dir, 'badmode.env', baseSecretsFileText())
  chmodSync(secretsFile, 0o644)
  const tmp = newTemp(dir, 'badmode.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'x'.repeat(20) }])
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations)
  ok('preimagen modo != 600: exit 14', res.status === 14)
}

// --- identidad del temporal no coincide ANTES de escribir ---
{
  const secretsFile = writeSecretsFile(dir, 'pinmismatch.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'pinmismatch.tmp')
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'x'.repeat(20) }])
  const res = run([secretsFile, tmp, '999999', '999999', '999999', '600', 'active'], mutations)
  ok('identidad no coincide: exit 10', res.status === 10)
  ok('identidad no coincide: destino sin tocar', readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- ruta temporal es symlink: rechazada sin seguirla (O_NOFOLLOW) ---
{
  const secretsFile = writeSecretsFile(dir, 'symlinktmp.env', baseSecretsFileText())
  const realTarget = path.join(dir, 'symlinktmp-objetivo.txt')
  writeFileSync(realTarget, 'CONTENIDO-QUE-DEBE-SOBREVIVIR', { mode: 0o600 })
  const link = path.join(dir, 'symlinktmp.tmp')
  symlinkSync(realTarget, link)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'x'.repeat(20) }])
  const res = run([secretsFile, link, '1', '1', '1', '600', 'active'], mutations)
  ok('temporal symlink: exit 10 (ELOOP vía O_NOFOLLOW)', res.status === 10)
  ok('el objetivo del symlink no se ha tocado', readFileSync(realTarget, 'utf8') === 'CONTENIDO-QUE-DEBE-SOBREVIVIR')
}

// --- mutaciones: JSON malformado por stdin -> exit 2 ---
{
  const secretsFile = writeSecretsFile(dir, 'badjson.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'badjson.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '{esto no es json')
  ok('mutaciones JSON malformadas: exit 2, destino intacto', res.status === 2 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- mutaciones: array vacío -> exit 2 ---
{
  const secretsFile = writeSecretsFile(dir, 'emptymutations.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'emptymutations.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], '[]')
  ok('mutaciones vacías: exit 2', res.status === 2)
}

// --- valor generado (set-line-generate) nunca en argv/env de ningún proceso hijo (no hay hijos aquí, pero se confirma que tampoco queda en stdout/stderr en TODOS los escenarios de arriba ya cubiertos) ---

// --- uso incorrecto: faltan argumentos ---
{
  const res = spawnSync(process.execPath, [SCRIPT, '/tmp/x'], { encoding: 'utf8' })
  ok('argv incompleto: exit 1', res.status === 1)
}

// --- uso incorrecto: schemaVersion desconocida ---
{
  const secretsFile = writeSecretsFile(dir, 'badschema.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'badschema.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'x'.repeat(20) }])
  const res = run([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'no-existe-esta-version'], mutations)
  ok('schemaVersion desconocida: exit 1', res.status === 1 && readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// =====================================================================
// Failpoints de prueba (Bloque 10) — interrupción REAL (SIGKILL de este
// mismo proceso) en cada frontera de la escritura, bajo las guardas de
// "solo contexto desechable".
// =====================================================================
const DISPOSABLE_LABEL = 'gapssa-s7-atomic-rehearsal-deadbeef01'

// --- guarda: failpoint activo sin etiqueta desechable -> exit 1, nada escrito ---
{
  const secretsFile = writeSecretsFile(dir, 'failpoint-no-label.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'failpoint-no-label.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'x'.repeat(20) }])
  const res = runWithEnv([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations, { GAPSSA_ROTATION_TEST_FAILPOINT: 'before-fsync' })
  ok('failpoint sin etiqueta desechable: exit 1 (nunca se ignora en silencio)', res.status === 1 && !res.signal)
  ok('failpoint sin etiqueta desechable: destino intacto', readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
}

// --- guarda: valor de failpoint fuera del conjunto cerrado -> exit 1 ---
{
  const secretsFile = writeSecretsFile(dir, 'failpoint-bad-value.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'failpoint-bad-value.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'x'.repeat(20) }])
  const res = runWithEnv([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations, {
    GAPSSA_ROTATION_TEST_FAILPOINT: 'not-a-real-failpoint',
    GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL: DISPOSABLE_LABEL,
  })
  ok('failpoint con valor desconocido: exit 1', res.status === 1 && !res.signal)
}

// --- guarda: apunta al almacén externo REAL por defecto ($HOME simulado) -> exit 1 ---
{
  const fakeRealHome = path.join(dir, 'fake-real-home')
  const realSecretsDir = path.join(fakeRealHome, '.gapssa-secrets')
  mkdirSync(realSecretsDir, { recursive: true })
  const realSecretsFile = writeSecretsFile(realSecretsDir, '.env.gapssa', baseSecretsFileText())
  const tmp = newTemp(realSecretsDir, 'real.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'x'.repeat(20) }])
  const res = runWithEnv([realSecretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations, {
    GAPSSA_ROTATION_TEST_FAILPOINT: 'before-fsync',
    GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL: DISPOSABLE_LABEL,
    HOME: fakeRealHome,
  })
  ok('failpoint apuntando al almacén real por defecto: exit 1, nunca se activa', res.status === 1 && !res.signal)
  ok('failpoint apuntando al almacén real por defecto: destino intacto', readFileSync(realSecretsFile, 'utf8') === baseSecretsFileText())
}

// --- before-fsync: SIGKILL real, destino ORIGINAL byte a byte intacto (rename nunca ocurrió) ---
{
  const secretsFile = writeSecretsFile(dir, 'crash-before-fsync.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'crash-before-fsync.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'valor-que-nunca-debe-llegar-a-verse-activo' }])
  const res = runWithEnv([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations, {
    GAPSSA_ROTATION_TEST_FAILPOINT: 'before-fsync',
    GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL: DISPOSABLE_LABEL,
  })
  ok('before-fsync: el proceso murió por SIGKILL de verdad', res.signal === 'SIGKILL')
  ok('before-fsync: destino ORIGINAL byte a byte intacto (nunca truncado, nunca a medias)', readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
  ok('before-fsync: destino conserva modo 600', (statSync(secretsFile).mode & 0o777).toString(8) === '600')
}

// --- after-fsync-before-rename: SIGKILL real, destino ORIGINAL sigue intacto (rename aún no ocurrió); el temporal SÍ quedó completo y durable ---
{
  const secretsFile = writeSecretsFile(dir, 'crash-after-fsync.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'crash-after-fsync.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'valor-que-nunca-debe-llegar-a-verse-activo' }])
  const res = runWithEnv([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations, {
    GAPSSA_ROTATION_TEST_FAILPOINT: 'after-fsync-before-rename',
    GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL: DISPOSABLE_LABEL,
  })
  ok('after-fsync-before-rename: el proceso murió por SIGKILL de verdad', res.signal === 'SIGKILL')
  ok('after-fsync-before-rename: destino ORIGINAL byte a byte intacto (rename NUNCA se ejecutó)', readFileSync(secretsFile, 'utf8') === baseSecretsFileText())
  ok('after-fsync-before-rename: el temporal (huérfano, nunca renombrado) quedó completo y correcto', readFileSync(tmp, 'utf8').includes('BOOKING_INTERNAL_API_SECRET=valor-que-nunca-debe-llegar-a-verse-activo\n'))
}

// --- after-rename: SIGKILL real, destino YA es el documento nuevo COMPLETO (nunca parcial) ---
{
  const secretsFile = writeSecretsFile(dir, 'crash-after-rename.env', baseSecretsFileText())
  const tmp = newTemp(dir, 'crash-after-rename.tmp')
  const [dev, ino, uid, mode] = pinOf(tmp)
  const mutations = JSON.stringify([{ op: 'set-line', key: 'BOOKING_INTERNAL_API_SECRET', value: 'valor-nuevo-tras-corte-justo-despues-del-rename' }])
  const res = runWithEnv([secretsFile, tmp, String(dev), String(ino), String(uid), mode, 'active'], mutations, {
    GAPSSA_ROTATION_TEST_FAILPOINT: 'after-rename',
    GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL: DISPOSABLE_LABEL,
  })
  ok('after-rename: el proceso murió por SIGKILL de verdad', res.signal === 'SIGKILL')
  ok('after-rename: el temporal ya no existe (el rename SÍ se ejecutó)', !existsSync(tmp))
  const finalContent = readFileSync(secretsFile, 'utf8')
  ok('after-rename: destino contiene el documento NUEVO COMPLETO (nunca parcial/truncado)', finalContent.includes('BOOKING_INTERNAL_API_SECRET=valor-nuevo-tras-corte-justo-despues-del-rename\n'))
  ok('after-rename: el resto del documento sigue íntegro (comentario preexistente)', finalContent.startsWith('# comentario preexistente\n\n'))
  ok('after-rename: destino conserva modo 600 pese al corte', (statSync(secretsFile).mode & 0o777).toString(8) === '600')
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
