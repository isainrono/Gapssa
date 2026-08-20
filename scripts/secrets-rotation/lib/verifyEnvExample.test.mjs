#!/usr/bin/env node
// Pruebas de lib/verifyEnvExample.mjs (Bloque 6, escenario ".env.example")
// — ficheros desechables bajo os.tmpdir(), nunca el .env.example real del
// repositorio. Cubre los casos de fichero roto que el escenario PTY de
// gate_s9 (tests/s9_env_example_failure_rehearsal.py) no puede permitirse
// repetir uno a uno contra infraestructura real: ausente, ilegible,
// corrupto (valor sensible sin forma de placeholder), incompleto
// (línea sensible truncada a mitad de valor) — el PTY real demuestra el
// contrato de integración (S9 falla cerrado) para UNO de estos casos; aquí
// se cubre la variedad completa a nivel de algoritmo, rápido y sin Docker.
import { mkdtempSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { verifyEnvExample, SENSITIVE_VAR_NAMES } from './verifyEnvExample.mjs'
import { ok, summarizeAndExit } from './testHarness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'verifyEnvExample.mjs')

const dir = mkdtempSync(path.join(tmpdir(), 'gapssa-verifyenvexample-test-'))

function write(name, content, mode) {
  const p = path.join(dir, name)
  writeFileSync(p, content, mode !== undefined ? { mode } : undefined)
  return p
}

// --- válido: todas las variables sensibles son placeholder/vacías ---
{
  const p = write(
    'valido.example',
    'POSTGRES_PASSWORD=change-me\nREDIS_PASSWORD=\nESPOCRM_API_KEY=replace_me\nESPOCRM_HTTP_PORT=8081\n',
  )
  const res = verifyEnvExample(p)
  ok('válido: ok=true, cero líneas con problema', res.ok === true && res.numerosDeLineaConProblema.length === 0)
}

// --- válido: mapa JSON versionado con todos los valores placeholder ---
{
  const p = write('valido-mapa.example', 'BOOKING_FIELD_ENCRYPTION_KEYS={"v1":"change-me"}\n')
  const res = verifyEnvExample(p)
  ok('válido (mapa JSON versionado, todos placeholder): ok=true', res.ok === true)
}

// --- variables NO sensibles nunca exigen placeholder ---
{
  const p = write('no-sensible.example', 'ESPOCRM_DEFAULT_CURRENCY=EUR\nTRUSTED_PROXY_HOP_COUNT=3\n')
  const res = verifyEnvExample(p)
  ok('variable no sensible con valor público real: ok=true (nunca se le exige placeholder)', res.ok === true)
}

// --- ausente: nunca "ok=false silencioso", lanza — el llamador (bash) lo
//     trata como fallo cerrado (captura 2>&1, exit != 0) ---
{
  const missing = path.join(dir, 'no-existe.example')
  let threw = false
  try {
    verifyEnvExample(missing)
  } catch {
    threw = true
  }
  ok('ausente: lanza (nunca ok=true ni ok=false silencioso sobre un fichero que no existe)', threw)
}

// --- ilegible (modo 000) — mismo contrato: lanza, nunca finge éxito ---
{
  const p = write('ilegible.example', 'POSTGRES_PASSWORD=change-me\n', 0o000)
  let threw = false
  try {
    verifyEnvExample(p)
  } catch {
    threw = true
  } finally {
    chmodSync(p, 0o600)
  }
  // root (uid 0) ignora los bits de permiso — si esta prueba corre como
  // root, la lectura SÍ tendría éxito; solo se afirma "lanza" cuando no.
  ok('ilegible (modo 000): lanza salvo que el proceso corra como root', threw || process.getuid?.() === 0)
}

// --- corrupto: variable sensible presente con un valor que NO tiene
//     forma de placeholder (valor real/con pinta de secreto) ---
{
  const p = write('corrupto.example', 'POSTGRES_PASSWORD=un-valor-que-no-es-placeholder-en-absoluto\n')
  const res = verifyEnvExample(p)
  ok('corrupto: ok=false, línea señalada', res.ok === false && res.numerosDeLineaConProblema.includes(1))
}

// --- incompleto: línea sensible truncada a mitad de valor (ej. un backup
//     interrumpido a mitad de escritura) — sigue sin ser placeholder ---
{
  const p = write('incompleto.example', 'ESPOCRM_API_KEY=chan\n')
  const res = verifyEnvExample(p)
  ok('incompleto (valor truncado, no llega a "change-me"): ok=false', res.ok === false && res.numerosDeLineaConProblema.includes(1))
}

// --- fallo del parser en un valor de mapa JSON: JSON inválido nunca
//     cuenta como placeholder por accidente (looksLikePlaceholderMap
//     captura el JSON.parse y devuelve false, nunca lanza) ---
{
  const p = write('mapa-corrupto.example', 'BOOKING_INTERNAL_API_SECRET={esto-no-es-json\n')
  const res = verifyEnvExample(p)
  ok('mapa JSON corrupto en variable sensible: ok=false, nunca lanza ni se acepta por accidente', res.ok === false)
}

// --- múltiples líneas con problema: TODAS se señalan, nunca solo la
//     primera (fail closed exhaustivo, no "early return") ---
{
  const p = write(
    'multiples.example',
    'POSTGRES_PASSWORD=valor-real-1\nREDIS_PASSWORD=valor-real-2\nESPOCRM_API_KEY=change-me\n',
  )
  const res = verifyEnvExample(p)
  ok(
    'múltiples variables sensibles rotas: TODAS las líneas señaladas (1 y 2, nunca solo la primera)',
    res.ok === false && res.numerosDeLineaConProblema.length === 2 && res.numerosDeLineaConProblema.includes(1) && res.numerosDeLineaConProblema.includes(2),
  )
}

// --- comentarios y líneas vacías nunca se evalúan como variable ---
{
  const p = write('comentarios.example', '# POSTGRES_PASSWORD=algo-real-en-un-comentario\n\nREDIS_PASSWORD=change-me\n')
  const res = verifyEnvExample(p)
  ok('comentarios y líneas vacías ignorados (nunca evaluados como variable)', res.ok === true)
}

// --- cobertura cerrada: SENSITIVE_VAR_NAMES no queda vacía ni cambia
//     de forma inesperada (regresión si alguien la vacía por error) ---
ok('SENSITIVE_VAR_NAMES es un array no vacío de nombres en mayúsculas', Array.isArray(SENSITIVE_VAR_NAMES) && SENSITIVE_VAR_NAMES.length > 0 && SENSITIVE_VAR_NAMES.every((k) => /^[A-Z_][A-Z0-9_]*$/.test(k)))

// --- CLI (nivel de proceso, no solo la función exportada): invocado a
//     través de un SYMLINK hacia este mismo fichero -- regresión exacta
//     del bug real detectado por tests/s9_env_example_failure_rehearsal.py
//     (Bloque 6). `rotate-all-interactive.sh` invoca este script vía
//     `$SCRIPT_DIR`, que puede ser una ruta simbólica (repo sombra de
//     los ensayos desechables, o cualquier despliegue real invocado a
//     través de un symlink) -- con la guardia de auto-invocación rota
//     (comparación literal de `import.meta.url` contra `process.argv[1]`,
//     sin `realpathSync`), `node` terminaba con éxito SIN IMPRIMIR NADA
//     y sin validar nada en absoluto, y gate_s9 lo interpretaba como
//     ".env.example válido" sin haber comprobado una sola línea. ---
{
  const symlinkPath = path.join(dir, 'verifyEnvExample-symlink.mjs')
  symlinkSync(SCRIPT, symlinkPath)

  const validFile = write('cli-valido.example', 'POSTGRES_PASSWORD=change-me\n')
  const resValidReal = spawnSync(process.execPath, [SCRIPT, validFile], { encoding: 'utf8' })
  ok('CLI vía ruta real, contenido válido: exit=0, imprime JSON con ok:true', resValidReal.status === 0 && JSON.parse(resValidReal.stdout).ok === true)
  const resValidSymlink = spawnSync(process.execPath, [symlinkPath, validFile], { encoding: 'utf8' })
  ok('CLI vía SYMLINK, contenido válido: exit=0, imprime JSON con ok:true (nunca vacío)', resValidSymlink.status === 0 && resValidSymlink.stdout.trim() !== '' && JSON.parse(resValidSymlink.stdout).ok === true)

  const invalidFile = write('cli-invalido.example', 'POSTGRES_PASSWORD=un-valor-real-no-placeholder\n')
  const resInvalidReal = spawnSync(process.execPath, [SCRIPT, invalidFile], { encoding: 'utf8' })
  ok('CLI vía ruta real, contenido inválido: exit!=0, ok:false', resInvalidReal.status !== 0 && JSON.parse(resInvalidReal.stdout).ok === false)
  const resInvalidSymlink = spawnSync(process.execPath, [symlinkPath, invalidFile], { encoding: 'utf8' })
  ok(
    'CLI vía SYMLINK, contenido inválido: exit!=0, ok:false (regresión: antes exit=0 y stdout vacío, "válido" por accidente)',
    resInvalidSymlink.status !== 0 && resInvalidSymlink.stdout.trim() !== '' && JSON.parse(resInvalidSymlink.stdout).ok === false,
  )
}

rmSync(dir, { recursive: true, force: true })
summarizeAndExit()
