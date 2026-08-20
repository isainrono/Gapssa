#!/usr/bin/env node
// scripts/secrets-rotation/lib/redisVerify.mjs — Bloque 5, reutilizado
// tal cual (sin duplicar) por S9 desde el Bloque 6.
//
// Verifica, con un PING autenticado por TCP REAL (nunca `docker compose
// exec` dentro del propio contenedor, que solo demuestra que el proceso
// sigue vivo, no que la autenticación de red funciona) contra
// host:port, si una contraseña candidata autentica en Redis. Usa el
// cliente `redis` ya presente en node_modules (hoisted por npm
// workspaces desde apps/web/package.json) — la contraseña viaja
// SIEMPRE en memoria de proceso, nunca en argv, nunca en un fichero, ni
// siquiera dentro de un contenedor.
//
// Bloque 6: este mismo helper sustituye por completo el mecanismo
// anterior de S9 (`docker compose cp` de un temporal a la ruta FIJA
// `/tmp/.gapssa-s9-redis-auth` dentro del contenedor `redis`, leído con
// `REDISCLI_AUTH="$(cat ...)"`) — nunca se volvió a endurecer ese
// mecanismo (CSPRNG, pinning, etc.): se eliminó, porque este helper ya
// ofrece una garantía estrictamente más fuerte (cero fichero, cero
// entorno de contenedor, cero argv) para exactamente la misma pregunta
// ("¿esta contraseña candidata autentica contra Redis ahora mismo?").
//
// Uso: node redisVerify.mjs   (lee { host, port } por stdin como JSON,
// y la contraseña candidata en la SEGUNDA línea de stdin, en crudo, sin
// procesar como JSON — para no obligar a JSON.stringify a escapar un
// valor que podría contener cualquier byte). El contrato cerrado de
// valores secretos (lib/secretValueContract.mjs) se aplica a esa
// contraseña ANTES de intentar ninguna conexión — ver más abajo. Imprime
// "true"/"false" a stdout — nunca la contraseña, nunca el host/puerto
// (ya los conoce el llamador). Exit 0 en ambos casos (una contraseña
// rechazada NO es un error de proceso); exit 1 solo si la entrada está
// mal formada, la contraseña no cumple el contrato cerrado, o el
// host/puerto no se pudo ni siquiera intentar (TCP inalcanzable) — en
// ese caso también imprime "false" primero, así el llamador nunca
// necesita mirar el exit code para decidir autenticación.

import { createClient } from 'redis'
import { validateSecretValue } from './secretValueContract.mjs'

function readAllStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
    process.stdin.on('error', reject)
  })
}

async function main() {
  const raw = await readAllStdin()
  const nlIndex = raw.indexOf(0x0a)
  if (nlIndex === -1) {
    console.error('ERROR redisVerify: stdin debe tener al menos dos líneas (config JSON + contraseña).')
    process.stdout.write('false')
    process.exit(1)
    return
  }
  const configLine = raw.subarray(0, nlIndex).toString('utf8')
  const passwordBuffer = raw.subarray(nlIndex + 1)

  let config
  try {
    config = JSON.parse(configLine)
  } catch {
    console.error('ERROR redisVerify: la primera línea no es JSON válido.')
    process.stdout.write('false')
    process.exit(1)
    return
  }
  if (typeof config !== 'object' || config === null || typeof config.host !== 'string' || !config.host || typeof config.port !== 'number' || !Number.isInteger(config.port)) {
    console.error('ERROR redisVerify: config debe ser {host: string no vacío, port: entero}.')
    process.stdout.write('false')
    process.exit(1)
    return
  }
  if (Object.keys(config).length !== 2) {
    console.error('ERROR redisVerify: config tiene claves inesperadas.')
    process.stdout.write('false')
    process.exit(1)
    return
  }

  // Bloque 6 — el contrato cerrado de valores secretos
  // (lib/secretValueContract.mjs) se aplica SIEMPRE antes de abrir
  // cualquier conexión de red — sobre el Buffer CRUDO, nunca sobre una
  // conversión a string ya hecha con .toString('utf8') (que sustituye en
  // silencio cualquier byte inválido por U+FFFD, perdiendo la
  // posibilidad de detectar la propia invalidez). Un valor candidato que
  // no lo cumpla se rechaza SIN intentar autenticar — nunca "false por
  // fallo de conexión", sino "false por contrato", con exit 1 igual que
  // el resto de rechazos de entrada mal formada de este script.
  const contractResult = validateSecretValue(passwordBuffer)
  if (!contractResult.ok) {
    console.error(`ERROR redisVerify: la contraseña candidata no cumple el contrato cerrado (${contractResult.reason}).`)
    process.stdout.write('false')
    process.exit(1)
    return
  }
  const password = passwordBuffer.toString('utf8')

  // Bloque 6 — presupuesto de tiempo TOTAL para connect+PING, no solo
  // para la fase de conexión TCP: `connectTimeout` de node-redis SOLO
  // acota el establecimiento de la conexión — un servidor que ACEPTA la
  // conexión pero nunca responde al PING (o a la negociación AUTH previa)
  // deja a `client.ping()` esperando para siempre, sin ningún timeout de
  // comando por defecto en node-redis v4 (bug real, detectado y
  // corregido durante esta revisión: contradecía la propia afirmación de
  // este fichero de "nunca se cuelga" — verificado empíricamente contra
  // un servidor TCP que acepta y nunca escribe nada). `Promise.race`
  // contra un temporizador propio es el patrón estándar para esto.
  const OPERATION_BUDGET_MS = 5000
  const client = createClient({
    socket: { host: config.host, port: config.port, connectTimeout: OPERATION_BUDGET_MS, reconnectStrategy: false },
    password,
  })
  client.on('error', () => {})
  let ok = false
  let timeoutHandle
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('operation budget exceeded')), OPERATION_BUDGET_MS)
    })
    const pong = await Promise.race([
      (async () => {
        await client.connect()
        return client.ping()
      })(),
      timeoutPromise,
    ])
    ok = pong === 'PONG'
  } catch {
    ok = false
  } finally {
    clearTimeout(timeoutHandle)
    // `destroy()` cierra el socket de inmediato, sin esperar respuesta
    // del servidor (a diferencia de `quit()`/`disconnect()`, que SÍ
    // pueden volver a colgarse esperando una respuesta de un servidor
    // que ya ha demostrado no responder) — nunca debe fallar de forma
    // bloqueante en la propia limpieza.
    try {
      client.destroy()
    } catch {
      /* ya desconectado o nunca llegó a conectar */
    }
  }
  process.stdout.write(ok ? 'true' : 'false')
}

main().catch(() => {
  process.stdout.write('false')
  process.exit(1)
})
