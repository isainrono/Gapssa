#!/usr/bin/env node
// Pruebas de start-apps-web.mjs — puerto configurable de apps/web para
// S9 (Bloque 6, GAPSSA_APPS_WEB_PORT). Cubre tanto las funciones puras
// exportadas (checkPortFree/resolveFreeTestPort/waitForNextAnnouncedPort)
// como el binario completo vía subproceso real, con un `npm` FALSO
// (nunca arranca un Next.js real) que simula tanto un arranque
// correcto como una muerte temprana — así se puede probar el contrato
// completo (validación, puerto configurable, verificación de
// vivo-y-propietario del puerto) sin depender de una app Next.js real
// ni de infraestructura Docker.
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, ranAsync, summarizeAndExit } from './lib/testHarness.mjs'
import { checkPortFree, isAlive, resolveFreeTestPort, waitForNextAnnouncedPort } from './start-apps-web.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'start-apps-web.mjs')

function freshTmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'gapssa-startappsweb-test-'))
}

// --- checkPortFree / resolveFreeTestPort -----------------------------------

async function withDisposableListener(fn) {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    return await fn(port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

await ranAsync('checkPortFree: false para un puerto realmente ocupado', () =>
  withDisposableListener(async (busyPort) => {
    const free = await checkPortFree(busyPort, '127.0.0.1')
    if (free) throw new Error('se esperaba false (puerto ocupado)')
  }),
)

await ranAsync('checkPortFree: true para un puerto realmente libre', async () => {
  const free = await checkPortFree(0, '127.0.0.1') // puerto 0 = "cualquiera libre", siempre true
  if (!free) throw new Error('se esperaba true (puerto 0 siempre está libre)')
})

await ranAsync('resolveFreeTestPort: puerto deseado libre -> devuelve exactamente ese puerto', () =>
  withDisposableListener(async () => {
    // Un puerto casi seguro libre (no reutiliza el mismo bloque efímero que randomEphemeralPort)
    const desired = 18000 + Math.floor(Math.random() * 1000)
    const got = await resolveFreeTestPort(desired, '127.0.0.1', 3)
    if (got !== desired) throw new Error(`se esperaba ${desired}, se obtuvo ${got}`)
  }),
)

await ranAsync('resolveFreeTestPort: puerto deseado ocupado -> nunca cae a un puerto fijo, elige otro libre', () =>
  withDisposableListener(async (busyPort) => {
    const got = await resolveFreeTestPort(busyPort, '127.0.0.1', 5)
    if (got === busyPort) throw new Error('devolvió el mismo puerto ocupado')
    const stillFree = await checkPortFree(got, '127.0.0.1')
    if (!stillFree) throw new Error(`el puerto devuelto (${got}) no está realmente libre`)
  }),
)

// --- waitForNextAnnouncedPort -----------------------------------------------

await ranAsync('waitForNextAnnouncedPort: log con "- Local: http://localhost:PORT" y proceso vivo -> resuelve ese puerto', async () => {
  const tmp = freshTmpDir()
  try {
    const logFile = path.join(tmp, 'apps-web.log')
    writeFileSync(logFile, '> next dev\n▲ Next.js 16.3.0\n- Local:        http://localhost:41777\n- Network:      http://192.168.1.1:41777\n✓ Ready in 300ms\n')
    const port = await waitForNextAnnouncedPort(logFile, process.pid, 2000)
    if (port !== 41777) throw new Error(`se esperaba 41777, se obtuvo ${port}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

await ranAsync('waitForNextAnnouncedPort: el hijo muere antes de anunciar puerto -> null de inmediato (fail closed)', async () => {
  const tmp = freshTmpDir()
  try {
    const logFile = path.join(tmp, 'apps-web.log') // nunca se crea -- simula que aún no ha escrito nada
    const child = spawn(process.execPath, ['-e', 'process.exit(1)'])
    const deadPid = await new Promise((resolve) => child.on('exit', () => resolve(child.pid)))
    const started = Date.now()
    const port = await waitForNextAnnouncedPort(logFile, deadPid, 5000)
    const elapsed = Date.now() - started
    if (port !== null) throw new Error(`se esperaba null (proceso muerto), se obtuvo ${port}`)
    if (elapsed > 2000) throw new Error(`tardó ${elapsed}ms en detectar el proceso muerto -- debía ser casi inmediato, no esperar el timeout completo`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

await ranAsync('waitForNextAnnouncedPort: nunca anuncia nada y el proceso sigue vivo -> null tras el timeout (acotado, no cuelga)', async () => {
  const tmp = freshTmpDir()
  try {
    const logFile = path.join(tmp, 'apps-web.log')
    writeFileSync(logFile, '> next dev\n▲ Next.js 16.3.0\n(arrancando todavía...)\n')
    const started = Date.now()
    const port = await waitForNextAnnouncedPort(logFile, process.pid, 300)
    const elapsed = Date.now() - started
    if (port !== null) throw new Error(`se esperaba null (nunca anunció), se obtuvo ${port}`)
    if (elapsed < 250 || elapsed > 2000) throw new Error(`tiempo fuera de rango: ${elapsed}ms (esperado ~300ms)`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// --- binario completo vía subproceso, con un `npm` FALSO --------------------
// El fake nunca arranca Next.js real: según UN ÚNICO argv (para poder
// distinguir "arranque correcto" de "muere enseguida" sin variables de
// entorno adicionales) escribe la línea "- Local: ..." al log (heredado
// como stdout/stderr por el hijo real) o sale enseguida con error.

function buildFakeBinDir(behavior) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gapssa-startappsweb-fakebin-'))
  const npmPath = path.join(dir, 'npm')
  const script = `#!/usr/bin/env bash
set -euo pipefail
{ printf 'FAKE_NPM_ARGV:'; for a in "$@"; do printf ' [%s]' "$a"; done; printf '\\n'; } >&2
port=3000
prev=""
for a in "$@"; do
  if [ "$prev" = "-p" ]; then port="$a"; fi
  prev="$a"
done
case "${behavior}" in
ok)
  echo "> next dev"
  echo "▲ Next.js 16.3.0 (Turbopack)"
  echo "- Local:        http://localhost:\${port}"
  echo "✓ Ready in 250ms"
  # Ocupa realmente el puerto (nunca solo un sleep) -- así las
  # pruebas de limpieza pueden comprobar de verdad que el puerto queda
  # LIBRE tras detener el proceso, no solo que el PID murió.
  exec python3 -m http.server "\${port}" --bind 127.0.0.1 >/dev/null 2>&1
  ;;
dies)
  echo "> next dev"
  echo "some fatal startup error"
  exit 1
  ;;
esac
`
  writeFileSync(npmPath, script)
  chmodSync(npmPath, 0o755)
  return dir
}

function runCli(env, extraPath) {
  const tmp = freshTmpDir()
  const pidFile = path.join(tmp, 'apps-web.pid')
  const logFile = path.join(tmp, 'apps-web.log')
  // repoRoot/secretsFile no necesitan ser reales para estas pruebas de
  // puerto: buildChildEnv() solo necesita poder parsear un fichero de
  // secretos EXISTENTE con forma mínima válida.
  const secretsFile = path.join(tmp, '.env.gapssa')
  writeFileSync(secretsFile, 'COMPOSE_PROJECT_NAME=x\n')
  const fakeBinDir = buildFakeBinDir(extraPath)
  const res = spawnSync(process.execPath, [SCRIPT, 'start', tmp, secretsFile, pidFile, logFile], {
    env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}`, ...env },
    encoding: 'utf8',
    timeout: 20000,
  })
  return { res, tmp, pidFile, logFile, fakeBinDir }
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}

// El `npm` falso escribe FAKE_NPM_ARGV/las líneas de arranque en su
// PROPIO stdout/stderr, que start-apps-web.mjs redirige al fichero de
// log (nunca hereda el del proceso de start-apps-web.mjs) -- así que
// las aserciones sobre "qué argv recibió el hijo" deben leer el log,
// nunca res.stderr (que es el stderr de start-apps-web.mjs mismo).
function readLog(logFile) {
  return existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
}

await ranAsync('CLI: sin GAPSSA_APPS_WEB_PORT -> puerto 3000 en la salida, ningún -p/-H al hijo', async () => {
  const env = { ...process.env }
  delete env.GAPSSA_APPS_WEB_PORT
  const { res, tmp, fakeBinDir, logFile } = runCli({}, 'ok')
  try {
    if (res.status !== 0) throw new Error(`exit=${res.status} stderr=${res.stderr}`)
    const out = JSON.parse(res.stdout.trim())
    if (out.port !== 3000) throw new Error(`puerto esperado 3000, obtenido ${out.port}`)
    const log = readLog(logFile)
    if (log.includes('[-p]') || log.includes('[-H]')) throw new Error(`el hijo real NUNCA debe recibir -p/-H cuando GAPSSA_APPS_WEB_PORT está ausente: ${log}`)
  } finally {
    cleanup(tmp, fakeBinDir)
  }
})

for (const bad of ['', '0', '-1', 'abc', '01', '65536', ' 5', '5 ', '3.5']) {
  await ranAsync(`CLI: GAPSSA_APPS_WEB_PORT inválido (${JSON.stringify(bad)}) aborta ANTES de arrancar nada`, async () => {
    const { res, tmp, fakeBinDir, logFile } = runCli({ GAPSSA_APPS_WEB_PORT: bad }, 'ok')
    try {
      if (res.status === 0) throw new Error('debía salir con código != 0')
      if (readLog(logFile).includes('FAKE_NPM_ARGV')) throw new Error('el `npm` falso NUNCA debía haberse invocado con un puerto inválido')
    } finally {
      cleanup(tmp, fakeBinDir)
    }
  })
}

await ranAsync('CLI: GAPSSA_APPS_WEB_PORT válido -> el hijo recibe -p <puerto> -H 127.0.0.1, y la salida usa el puerto REALMENTE anunciado', async () => {
  // resolveFreeTestPort en vez de un puerto fijo sin comprobar: esta
  // máquina puede tener procesos ajenos (nada que ver con GAPSSA) ya
  // escuchando en el rango 19000-19999 — un sorteo sin verificar
  // colisionaba de forma intermitente (docs/manifests/checkpoint-v1/,
  // estabilización del harness de Commit 5).
  const desired = await resolveFreeTestPort(19000 + Math.floor(Math.random() * 500), '127.0.0.1', 10)
  const { res, tmp, fakeBinDir, logFile } = runCli({ GAPSSA_APPS_WEB_PORT: String(desired) }, 'ok')
  try {
    if (res.status !== 0) throw new Error(`exit=${res.status} stderr=${res.stderr}`)
    const log = readLog(logFile)
    // formato exacto: "FAKE_NPM_ARGV: [run] [dev] [-w] [@gapssa/web] [--] [-p] [19123] [-H] [127.0.0.1]"
    if (!log.includes(`[-p] [${desired}]`)) throw new Error(`el hijo no recibió -p ${desired}: ${log}`)
    if (!log.includes('[-H] [127.0.0.1]')) throw new Error(`el hijo no recibió -H 127.0.0.1: ${log}`)
    const out = JSON.parse(res.stdout.trim())
    if (out.port !== desired) throw new Error(`puerto esperado ${desired}, obtenido ${out.port}`)
  } finally {
    cleanup(tmp, fakeBinDir)
  }
})

await ranAsync('CLI: `stop` limpia el proceso hijo real y libera el puerto de verdad', async () => {
  // Ver comentario equivalente más arriba: puerto verificado libre antes
  // de usarlo, nunca un sorteo sin comprobar.
  const desired = await resolveFreeTestPort(19700 + Math.floor(Math.random() * 200), '127.0.0.1', 10)
  const { res, tmp, fakeBinDir, pidFile } = runCli({ GAPSSA_APPS_WEB_PORT: String(desired) }, 'ok')
  try {
    if (res.status !== 0) throw new Error(`exit=${res.status} stderr=${res.stderr}`)
    const out = JSON.parse(res.stdout.trim())
    if (isAlive(out.pid) !== true) throw new Error('el proceso debía estar vivo justo después de arrancar')
    if ((await checkPortFree(out.port, '127.0.0.1')) !== false) throw new Error('el puerto debía estar realmente ocupado justo después de arrancar')

    const stopRes = spawnSync(process.execPath, [SCRIPT, 'stop', pidFile], { encoding: 'utf8', timeout: 20000 })
    if (stopRes.status !== 0) throw new Error(`stop falló: exit=${stopRes.status} stderr=${stopRes.stderr}`)

    if (isAlive(out.pid) !== false) throw new Error(`el proceso (PID ${out.pid}) seguía vivo tras 'stop'`)
    const freedAfterStop = await checkPortFree(out.port, '127.0.0.1')
    if (freedAfterStop !== true) throw new Error(`el puerto ${out.port} seguía ocupado tras 'stop' -- limpieza incompleta`)
  } finally {
    cleanup(tmp, fakeBinDir)
  }
})

await ranAsync('CLI: el hijo muere enseguida -> el comando falla (exit != 0), nunca imprime un JSON de éxito', async () => {
  const desired = 19600
  const { res, tmp, fakeBinDir } = runCli({ GAPSSA_APPS_WEB_PORT: String(desired) }, 'dies')
  try {
    if (res.status === 0) throw new Error('debía fallar (el hijo murió sin anunciar ningún puerto)')
    if (res.stdout.trim().startsWith('{')) throw new Error(`no debía imprimir JSON de éxito: ${res.stdout}`)
  } finally {
    cleanup(tmp, fakeBinDir)
  }
})

await ranAsync('CLI: un servidor AJENO ya escuchando en el puerto deseado nunca produce éxito si el hijo real muere', () =>
  withDisposableListener(async (foreignPort) => {
    // El "servidor ajeno" ya ocupa foreignPort (como cualquier otro
    // proceso del sistema podría). Con GAPSSA_APPS_WEB_PORT=foreignPort:
    // resolveFreeTestPort() detecta que está ocupado y elige OTRO puerto
    // (nunca intenta usar el ajeno -- primera defensa), y aunque no fuera
    // así, el `npm` falso "dies" nunca anuncia nada en el log, así que
    // waitForNextAnnouncedPort() (que solo confía en "¿el propio proceso
    // anunció y sigue vivo?", NUNCA en "¿algo responde en el puerto?")
    // tampoco lo aceptaría -- doble garantía, en ambos casos el CLI falla.
    const { res, tmp, fakeBinDir } = runCli({ GAPSSA_APPS_WEB_PORT: String(foreignPort) }, 'dies')
    try {
      if (res.status === 0) throw new Error('debía fallar pese a que algo ajeno escucha en el puerto deseado')
    } finally {
      cleanup(tmp, fakeBinDir)
    }
  }),
)

// --- regresión: invocación a través de un symlink -----------------------
// Bug real (Bloque 6, ensayo integral): Node canonicaliza import.meta.url
// del módulo de entrada (resuelve symlinks) pero process.argv[1] conserva
// la ruta EXACTA de invocación -- si SCRIPT se invoca a través de un
// symlink (como "scripts/" en el repo sombra del ensayo), una guarda
// "¿soy el módulo principal?" que compare esas dos rutas SIN resolver
// symlinks primero da igual=false SIEMPRE, el switch de subcomandos
// nunca se ejecuta, y el proceso termina en silencio (exit 0, stdout
// vacío) sin arrancar nada -- gate_s9 interpretaba ese vacío como "usa
// el puerto 3000 por defecto" y jamás arrancaba apps/web de verdad.
await ranAsync('regresión: invocado a través de un symlink, el subcomando SÍ se ejecuta (nunca sale en silencio)', async () => {
  const linkDir = mkdtempSync(path.join(os.tmpdir(), 'gapssa-startappsweb-symlink-'))
  const linkedScript = path.join(linkDir, 'start-apps-web.mjs')
  try {
    const { symlinkSync } = await import('node:fs')
    symlinkSync(SCRIPT, linkedScript)
    const res = spawnSync(process.execPath, [linkedScript], { encoding: 'utf8', timeout: 10000 })
    // Sin subcomando: DEBE llegar al `default:` y fallar con el mensaje
    // de uso -- nunca salir 0 en silencio (que sería la guarda rota).
    if (res.status === 0) throw new Error('salió 0 en silencio -- la guarda de módulo principal no se ejecutó a través del symlink')
    if (!res.stderr.includes('Subcomando desconocido')) throw new Error(`se esperaba el mensaje de uso en stderr, se obtuvo: ${JSON.stringify(res.stderr)}`)
  } finally {
    rmSync(linkDir, { recursive: true, force: true })
  }
})

// --- scan-log-for-secrets: solo material realmente secreto -------------
// Bug real (Bloque 6, ensayo integral S1->S9 contra infra desechable):
// escanear TODO SECRETS_FILE_KEY_INVENTORY (incluyendo parámetros
// operativos no sensibles como TRUSTED_PROXY_HOP_COUNT/OTP_MAX_ATTEMPTS/
// ARGON2_PARALLELISM, con valores cortos y genéricos tipo "3"/"60")
// producía falsos positivos -- esos valores aparecen por pura coincidencia
// en cualquier log real (timestamps, duraciones, puertos) -- y bloqueaban
// la Puerta S9 (y, en cascada, la promoción de S6 a 'done') pese a que
// ningún secreto real se había filtrado nunca. La corrección limita el
// escaneo a SECRET_VALUE_KEYS (loadSecretsEnv.mjs).
await ranAsync('scan-log-for-secrets: un valor no-secreto que coincide por casualidad NO cuenta como fuga', async () => {
  const tmp = freshTmpDir()
  try {
    const secretsFile = path.join(tmp, '.env.gapssa')
    // OTP_MAX_ATTEMPTS=3 -- valor corto y no secreto; el log de abajo
    // contiene "3" varias veces (puerto, duración) por pura coincidencia.
    writeFileSync(
      secretsFile,
      ['COMPOSE_PROJECT_NAME=x', 'OTP_MAX_ATTEMPTS=3', 'TRUSTED_PROXY_HOP_COUNT=3', 'ARGON2_PARALLELISM=1'].join('\n') + '\n',
    )
    const logFile = path.join(tmp, 'apps-web.log')
    writeFileSync(logFile, 'Ready in 3ms\n Local: http://127.0.0.1:56231\n GET /api/health 200 in 13ms\n')
    const res = spawnSync(process.execPath, [SCRIPT, 'scan-log-for-secrets', secretsFile, logFile], { encoding: 'utf8', timeout: 10000 })
    if (res.status !== 0) throw new Error(`se esperaba exit 0 (sin fuga), se obtuvo ${res.status}: ${res.stdout} ${res.stderr}`)
    const parsed = JSON.parse(res.stdout)
    if (Object.prototype.hasOwnProperty.call(parsed, 'OTP_MAX_ATTEMPTS')) {
      throw new Error('OTP_MAX_ATTEMPTS no debería escanearse -- no es SECRET_VALUE_KEYS')
    }
  } finally {
    cleanup(tmp)
  }
})

await ranAsync('scan-log-for-secrets: un secreto real presente en el log SÍ cuenta como fuga', async () => {
  const tmp = freshTmpDir()
  try {
    const secretsFile = path.join(tmp, '.env.gapssa')
    writeFileSync(secretsFile, ['COMPOSE_PROJECT_NAME=x', 'REDIS_PASSWORD=super-secreto-ficticio-xyz'].join('\n') + '\n')
    const logFile = path.join(tmp, 'apps-web.log')
    writeFileSync(logFile, 'algo escribio por error: super-secreto-ficticio-xyz\n')
    const res = spawnSync(process.execPath, [SCRIPT, 'scan-log-for-secrets', secretsFile, logFile], { encoding: 'utf8', timeout: 10000 })
    if (res.status !== 1) throw new Error(`se esperaba exit 1 (fuga real detectada), se obtuvo ${res.status}: ${res.stdout} ${res.stderr}`)
    const parsed = JSON.parse(res.stdout)
    if (parsed.REDIS_PASSWORD !== true) throw new Error(`se esperaba REDIS_PASSWORD=true en el resultado, se obtuvo: ${res.stdout}`)
  } finally {
    cleanup(tmp)
  }
})

await ranAsync('scan-log-for-secrets: un valor "secret" más corto que MIN_SECRET_VALUE_LENGTH aborta ANTES de escanear (fail-closed, nunca imprime el valor)', async () => {
  const tmp = freshTmpDir()
  try {
    const secretsFile = path.join(tmp, '.env.gapssa')
    // REDIS_PASSWORD=short -- 5 caracteres, muy por debajo del suelo real
    // de generación (24 bytes) e indistinguible de una coincidencia
    // genérica de log si se escaneara igualmente.
    writeFileSync(secretsFile, ['COMPOSE_PROJECT_NAME=x', 'REDIS_PASSWORD=short'].join('\n') + '\n')
    const logFile = path.join(tmp, 'apps-web.log')
    writeFileSync(logFile, 'log sin relación alguna\n')
    const res = spawnSync(process.execPath, [SCRIPT, 'scan-log-for-secrets', secretsFile, logFile], { encoding: 'utf8', timeout: 10000 })
    if (res.status === 0) throw new Error('debía abortar (valor demasiado corto para escanear con garantías), no salir 0')
    if (res.stdout.includes('short')) throw new Error('el valor del secreto NUNCA debe aparecer en stdout, ni siquiera al fallar')
    if (res.stderr.includes('short')) throw new Error('el valor del secreto NUNCA debe aparecer en stderr, ni siquiera al fallar')
  } finally {
    cleanup(tmp)
  }
})

summarizeAndExit()
