#!/usr/bin/env node
// Lanzador de apps/web para la puerta S9 — SIN `npx`, SIN heredar
// `process.env` sin filtrar, SIN secretos en argv. Reemplaza
// `npx dotenv -e ... -- npm run dev` (v2): construye el entorno del hijo
// con `loadSecretsEnv.mjs` (allowlist cerrada + inventario cerrado de
// `$SECRETS_FILE`) y lo arranca con `child_process.spawn` — nunca
// `shell: true`.
//
// Subcomandos:
//   start <repoRoot> <secretsFile> <pidFile> <logFile>
//     Arranca `npm run dev -w @gapssa/web` en background, escribe su PID en
//     <pidFile> (fuera del workspace) y su stdout/stderr en <logFile>
//     (fuera del workspace, 600) — vuelve inmediatamente (el llamador
//     sondea /api/health por su cuenta).
//   stop <pidFile>
//     Envía SIGTERM al PID guardado y espera (hasta 15s) a que termine de
//     verdad. Sale 0 si se detuvo, 1 si seguía vivo tras el plazo.
//   scan-log-for-secrets <secretsFile> <logFile>
//     Escaneo EN PROCESO (nunca `grep <valor>`, que pondría el secreto en
//     el argv de un proceso externo): lee ambos ficheros con Node, compara
//     en memoria, y solo imprime {variable, filtrado:boolean} por
//     variable — nunca el valor, un fragmento ni un hash. Sale 1 si
//     cualquiera aparece.

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, openSync, readFileSync, realpathSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildChildEnv, parseSecretsFile, SECRET_VALUE_KEYS, MIN_SECRET_VALUE_LENGTH } from './lib/loadSecretsEnv.mjs'

const [, , command, ...rest] = process.argv

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// GAPSSA_APPS_WEB_PORT (Bloque 6) — variable NO secreta, deliberadamente
// distinta de `PORT` (nunca se reutiliza esa convención genérica: mezclar
// configuración externa inesperada de PORT con el propósito específico de
// esta variable sería confuso y frágil). AUSENTE: comportamiento real
// IDÉNTICO al de siempre — 3000, sin -p/-H, sin ninguna comprobación de
// puerto. PRESENTE (solo en el ensayo integral desechable): exige un
// entero 1-65535 sin vacíos/signos/ceros a la izquierda — cualquier otra
// cosa falla cerrado ANTES de arrancar nada.
function validateTestPort(raw) {
  if (!/^[1-9][0-9]*$/.test(raw)) {
    fail(`GAPSSA_APPS_WEB_PORT inválido: "${raw}" (debe ser un entero positivo sin ceros a la izquierda ni signos).`)
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    fail(`GAPSSA_APPS_WEB_PORT fuera de rango: "${raw}" (debe estar entre 1 y 65535).`)
  }
  return n
}

export function checkPortFree(port, host) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, host)
  })
}

function randomEphemeralPort() {
  return 20000 + Math.floor(Math.random() * 20000)
}

// Reintentos acotados ante la carrera EADDRINUSE (Bloque 6): la
// comprobación previa de checkPortFree() y el bind real de Next.js no son
// atómicos entre sí -- otro proceso podría tomar el puerto justo en medio.
// Nunca cae a un puerto fijo alternativo: si el deseado está ocupado,
// prueba puertos efímeros nuevos, acotado a maxAttempts.
export async function resolveFreeTestPort(desiredPort, host, maxAttempts = 5) {
  let port = desiredPort
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (await checkPortFree(port, host)) return port
    port = randomEphemeralPort()
  }
  fail(`no se encontró un puerto libre en ${host} tras ${maxAttempts} reintentos (último probado: ${port}).`)
}

// Espera (acotada) a que el PROPIO Next.js anuncie en su log el puerto
// REAL en el que quedó escuchando -- nunca se asume que el puerto
// resuelto por resolveFreeTestPort() es el que realmente se usó (una
// carrera de última hora en el bind real seguiría siendo posible incluso
// tras la comprobación previa). Si el hijo muere mientras se espera,
// devuelve null de inmediato -- nunca sigue esperando ni acepta un puerto
// de un proceso ya muerto.
export async function waitForNextAnnouncedPort(logFile, pid, timeoutMs) {
  const localUrlRe = /-\s*Local:\s*https?:\/\/[^:\s]+:(\d+)/
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return null
    if (existsSync(logFile)) {
      const content = readFileSync(logFile, 'utf8')
      const m = localUrlRe.exec(content)
      if (m) return Number(m[1])
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return null
}

async function cmdStart() {
  const [repoRoot, secretsFile, pidFile, logFile] = rest
  if (!repoRoot || !secretsFile || !pidFile || !logFile) {
    fail('Uso: start-apps-web.mjs start <repoRoot> <secretsFile> <pidFile> <logFile>')
  }
  const env = buildChildEnv(secretsFile)

  const logFd = openSync(logFile, 'a')
  chmodSync(logFile, 0o600)

  const rawTestPort = process.env.GAPSSA_APPS_WEB_PORT
  if (rawTestPort === undefined) {
    // Comportamiento real, sin cambios: 3000, sin -p/-H, arranque
    // "dispara y olvida" (el llamador sondea /api/health por su cuenta).
    const child = spawn('npm', ['run', 'dev', '-w', '@gapssa/web'], {
      cwd: repoRoot,
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    })
    child.unref()
    writeFileSync(pidFile, String(child.pid), { mode: 0o600 })
    console.log(JSON.stringify({ started: true, pid: child.pid, port: 3000 }))
    return
  }

  const desiredPort = validateTestPort(rawTestPort)
  const host = '127.0.0.1'
  const port = await resolveFreeTestPort(desiredPort, host)

  const child = spawn('npm', ['run', 'dev', '-w', '@gapssa/web', '--', '-p', String(port), '-H', host], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  child.unref()
  writeFileSync(pidFile, String(child.pid), { mode: 0o600 })

  const actualPort = await waitForNextAnnouncedPort(logFile, child.pid, 45_000)
  if (actualPort === null) {
    fail(`apps/web (PID ${child.pid}) no anunció un puerto de escucha real en 45s, o murió antes -- revisa ${logFile}.`)
  }
  console.log(JSON.stringify({ started: true, pid: child.pid, port: actualPort }))
}

async function cmdStop() {
  const [pidFile] = rest
  if (!pidFile || !existsSync(pidFile)) {
    fail('No existe el fichero de PID indicado.')
  }
  const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
  if (!Number.isFinite(pid)) {
    fail('El fichero de PID no contiene un PID numérico válido.')
  }
  if (!isAlive(pid)) {
    console.log(JSON.stringify({ stopped: true, alreadyDead: true }))
    return
  }
  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      console.log(JSON.stringify({ stopped: true, alreadyDead: false }))
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  console.log(JSON.stringify({ stopped: false }))
  process.exit(1)
}

function cmdScanLogForSecrets() {
  const [secretsFile, logFile] = rest
  if (!secretsFile || !logFile) {
    fail('Uso: start-apps-web.mjs scan-log-for-secrets <secretsFile> <logFile>')
  }
  const secrets = parseSecretsFile(secretsFile)
  const logContent = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''

  // Solo se escanean las claves de SECRET_VALUE_KEYS (material realmente
  // secreto), nunca el inventario completo de $SECRETS_FILE (Bloque 6):
  // este último también contiene parámetros operativos no sensibles con
  // valores cortos/genéricos ("3", "60", "true"...) que coinciden por pura
  // casualidad con cualquier log (timestamps, duraciones, puertos),
  // produciendo falsos positivos que bloqueaban la Puerta S9 sin que
  // ningún secreto real se hubiera filtrado nunca.
  // Fail-closed (Bloque 6): un valor clasificado secret/DSN pero más
  // corto que MIN_SECRET_VALUE_LENGTH nunca puede venir de una rotación
  // real de este sistema (todo secreto generado usa >=24 bytes) -- es
  // indistinguible de una coincidencia genérica de log, así que ESCANEARLO
  // no da garantías reales. En vez de tratarlo en silencio como "sin
  // fuga" (falso negativo posible) o "fuga" (ruido garantizado), se
  // aborta ANTES de escanear nada, sin imprimir el valor, exigiendo
  // revisión operativa explícita.
  const tooShortKeys = []
  for (const [key, value] of Object.entries(secrets)) {
    if (!SECRET_VALUE_KEYS.has(key)) continue
    if (value === '') continue
    if (value.length < MIN_SECRET_VALUE_LENGTH) tooShortKeys.push(key)
  }
  if (tooShortKeys.length > 0) {
    fail(
      `No se puede escanear con garantías: ${tooShortKeys.join(', ')} tiene un valor más corto que ${MIN_SECRET_VALUE_LENGTH} caracteres (nunca se imprime el valor). Un secreto tan corto es indistinguible de una coincidencia genérica de log -- refuerza el valor antes de continuar.`,
    )
  }

  const results = {}
  let anyLeaked = false
  for (const [key, value] of Object.entries(secrets)) {
    if (!SECRET_VALUE_KEYS.has(key)) continue
    if (value === '') continue
    const leaked = logContent.includes(value)
    results[key] = leaked
    if (leaked) anyLeaked = true
  }

  console.log(JSON.stringify(results))
  process.exit(anyLeaked ? 1 : 0)
}

// Guarda estándar "¿es este el módulo principal?" (Bloque 6): sin ella,
// importar este fichero desde un test (para probar checkPortFree/
// resolveFreeTestPort/waitForNextAnnouncedPort de forma aislada, sin
// arrancar next dev de verdad) ejecutaría también este switch con
// `command` a `undefined`, cayendo en el `default:` y matando el
// proceso de prueba con `process.exit(1)`.
//
// NUNCA comparar import.meta.url contra `file://${process.argv[1]}` sin
// resolver symlinks primero (bug real, detectado por el ensayo integral,
// Bloque 6): Node CANONICALIZA import.meta.url del módulo de entrada
// (resuelve symlinks), pero process.argv[1] conserva la ruta EXACTA tal
// como se invocó -- el repo sombra del ensayo enlaza "scripts/" con un
// symlink, así que `node "$SCRIPT_DIR/start-apps-web.mjs" start ...`
// pasaba una ruta symlinked en argv[1] mientras import.meta.url ya venía
// resuelta al destino real, la comparación SIEMPRE daba false, el switch
// nunca se ejecutaba, y el proceso terminaba en silencio (exit 0, stdout
// vacío) sin arrancar nada -- gate_s9 interpretaba ese stdout vacío como
// "puerto 3000 por defecto" y comprobaba el healthcheck equivocado.
// realpathSync() en ambos lados antes de comparar lo hace robusto frente
// a symlinks en cualquier dirección.
const isMainModule = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
})()
if (isMainModule) {
  switch (command) {
    case 'start':
      await cmdStart()
      break
    case 'stop':
      await cmdStop()
      break
    case 'scan-log-for-secrets':
      cmdScanLogForSecrets()
      break
    default:
      fail(`Subcomando desconocido: "${command ?? ''}". Usa start | stop | scan-log-for-secrets.`)
  }
}
