#!/usr/bin/env node
// scripts/secrets-rotation/lib/redisDataBaseline.mjs — Bloque 8 (S5)
//
// Captura una línea base NO SENSIBLE del contenido de Redis, para que
// gate_s5 pueda confirmar que los datos y sus TTL sobrevivieron al
// `force-recreate` del contenedor (el volumen nombrado no se toca al
// recrear el contenedor, pero esta puerta lo VERIFICA en vez de
// asumirlo). Nunca imprime nombres de clave ni valores: cada clave
// muestreada se reduce a un hash SHA-256 de una sola vía (nunca
// reversible) + su TTL en segundos (-1 = persistente).
//
// Mismo protocolo de entrada que lib/redisVerify.mjs (config JSON en la
// primera línea + contraseña cruda en el resto de stdin) y el mismo
// contrato cerrado de valores secretos aplicado ANTES de conectar.
//
// Uso: node redisDataBaseline.mjs   (stdin: {host,port}\n<password>)
// stdout: UNA línea JSON {"dbsize": N, "sample": [{"h":"<sha256 hex>","ttl":N}, ...]}
//   — "sample" es un lote ACOTADO (COUNT 50, una sola llamada SCAN desde
//   el cursor "0" — nunca recorre todo el keyspace) ordenado por hash
//   para comparación determinista.
// exit 0 = captura correcta (incluso con Redis vacío: dbsize=0, sample=[]).
// exit 1 = entrada mal formada / contrato de contraseña incumplido /
//   Redis inalcanzable o comando fallido — stdout SIN imprimir (nunca
//   una línea base parcial/falsa).

import { createHash } from 'node:crypto'
import { createClient } from 'redis'
import { validateSecretValue } from './secretValueContract.mjs'

const SAMPLE_COUNT = 50
const OPERATION_BUDGET_MS = 8000

function readAllStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
    process.stdin.on('error', reject)
  })
}

function hashKeyName(name) {
  return createHash('sha256').update(name, 'utf8').digest('hex')
}

async function main() {
  const raw = await readAllStdin()
  const nlIndex = raw.indexOf(0x0a)
  if (nlIndex === -1) {
    console.error('ERROR redisDataBaseline: stdin debe tener al menos dos líneas (config JSON + contraseña).')
    process.exit(1)
    return
  }
  const configLine = raw.subarray(0, nlIndex).toString('utf8')
  const passwordBuffer = raw.subarray(nlIndex + 1)

  let config
  try {
    config = JSON.parse(configLine)
  } catch {
    console.error('ERROR redisDataBaseline: la primera línea no es JSON válido.')
    process.exit(1)
    return
  }
  if (typeof config !== 'object' || config === null || typeof config.host !== 'string' || !config.host || typeof config.port !== 'number' || !Number.isInteger(config.port)) {
    console.error('ERROR redisDataBaseline: config debe ser {host: string no vacío, port: entero}.')
    process.exit(1)
    return
  }
  if (Object.keys(config).length !== 2) {
    console.error('ERROR redisDataBaseline: config tiene claves inesperadas.')
    process.exit(1)
    return
  }

  const contractResult = validateSecretValue(passwordBuffer)
  if (!contractResult.ok) {
    console.error(`ERROR redisDataBaseline: la contraseña no cumple el contrato cerrado (${contractResult.reason}).`)
    process.exit(1)
    return
  }
  const password = passwordBuffer.toString('utf8')

  const client = createClient({
    socket: { host: config.host, port: config.port, connectTimeout: OPERATION_BUDGET_MS, reconnectStrategy: false },
    password,
  })
  client.on('error', () => {})

  let timeoutHandle
  let result = null
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('operation budget exceeded')), OPERATION_BUDGET_MS)
    })
    result = await Promise.race([
      (async () => {
        await client.connect()
        const dbsize = await client.dbSize()
        // El cursor SCAN debe ser string (o Buffer) para este cliente — un
        // número lanza "arguments[1] must be of type string | Buffer"
        // dentro del propio encoder RESP (verificado empíricamente contra
        // un Redis real; nunca asumido).
        const scanResult = await client.scan('0', { COUNT: SAMPLE_COUNT })
        const keys = Array.isArray(scanResult?.keys) ? scanResult.keys : []
        const sample = []
        for (const key of keys) {
          // eslint-disable-next-line no-await-in-loop
          const ttl = await client.ttl(key)
          sample.push({ h: hashKeyName(key), ttl: typeof ttl === 'number' ? ttl : -2 })
        }
        sample.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
        return { dbsize, sample }
      })(),
      timeoutPromise,
    ])
  } catch {
    result = null
  } finally {
    clearTimeout(timeoutHandle)
    try {
      client.destroy()
    } catch {
      /* ya desconectado o nunca llegó a conectar */
    }
  }

  if (result === null || typeof result.dbsize !== 'number' || !Number.isInteger(result.dbsize) || result.dbsize < 0) {
    console.error('ERROR redisDataBaseline: no se pudo capturar la línea base (conexión, comando, o presupuesto de tiempo agotado).')
    process.exit(1)
    return
  }
  process.stdout.write(JSON.stringify(result) + '\n')
}

main().catch(() => {
  process.exit(1)
})
