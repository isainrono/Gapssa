#!/usr/bin/env node
// Pruebas de lib/redisVerify.mjs — validación de entrada, contrato
// cerrado de valores secretos, y el contrato de salida (booleano puro,
// nunca la contraseña) — incluyendo, desde el Bloque 6, servidores TCP
// reales desechables (creados y destruidos por esta misma prueba, en
// localhost, nunca contra infraestructura GAPSSA) para ejercitar
// protocolo corrupto, timeout real y conexión rechazada sin depender de
// un Redis real completo (eso sigue viviendo en el ensayo desechable,
// que sí verifica autenticación PONG genuina).
import { spawnSync, spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ok, ranAsync, summarizeAndExit } from './testHarness.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'redisVerify.mjs')

function run(input) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', timeout: 10000 })
}

/**
 * Levanta un servidor TCP desechable en 127.0.0.1 con un puerto efímero
 * del propio SO, ejecuta `fn(port)`, y lo cierra siempre al terminar.
 * Registra CADA socket aceptado y lo destruye explícitamente al cerrar
 * — `server.close()` por sí solo espera a que TODAS las conexiones
 * terminen por su cuenta, lo que puede colgarse indefinidamente si un
 * cliente murió sin que el servidor llegara a detectar el cierre (bug
 * real detectado durante esta misma revisión, al escribir la prueba de
 * interrupción por SIGINT de más abajo).
 */
async function withDisposableServer(connectionHandler, fn) {
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    connectionHandler(socket)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(port)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
}

{
  const res = run('not json at all\nsomepassword')
  ok('config no-JSON: stdout=false, exit=1', res.stdout === 'false' && res.status === 1)
}
{
  const res = run('{"host":"127.0.0.1"}\nsomepassword')
  ok('config sin port: stdout=false, exit=1', res.stdout === 'false' && res.status === 1)
}
{
  const res = run('{"host":"","port":6379}\nsomepassword')
  ok('config con host vacío: stdout=false, exit=1', res.stdout === 'false' && res.status === 1)
}
{
  const res = run('{"host":"127.0.0.1","port":"6379"}\nsomepassword')
  ok('config con port como string (no entero): stdout=false, exit=1', res.stdout === 'false' && res.status === 1)
}
{
  const res = run('{"host":"127.0.0.1","port":6379,"extra":true}\nsomepassword')
  ok('config con clave inesperada: stdout=false, exit=1', res.stdout === 'false' && res.status === 1)
}
{
  const res = run('sin-salto-de-linea-en-absoluto')
  ok('stdin sin ninguna línea (sin salto): stdout=false, exit=1', res.stdout === 'false' && res.status === 1)
}
{
  // Puerto inalcanzable (nadie escuchando) -> debe resolver a "false" sin
  // colgarse ni lanzar una excepción no controlada, exit 0 (config bien
  // formada, la autenticación simplemente no se pudo demostrar).
  const res = run('{"host":"127.0.0.1","port":1}\nanything')
  ok('host/puerto inalcanzable: stdout=false, exit=0 (nunca cuelga, nunca crashea)', res.stdout === 'false' && res.status === 0)
}
{
  const res = run('{"host":"127.0.0.1","port":6379}\nsomepassword')
  const leaked = res.stdout.includes('somepassword') || (res.stderr || '').includes('somepassword')
  ok('la contraseña nunca aparece en stdout/stderr', !leaked)
}

// ============================================================
// Bloque 6 — contrato cerrado aplicado ANTES de conectar
// ============================================================
{
  const res = run('{"host":"127.0.0.1","port":1}\n')
  ok('contraseña vacía: rechazada por contrato (exit 1, stdout=false), nunca intenta conectar', res.stdout === 'false' && res.status === 1)
}
{
  const res = run('{"host":"127.0.0.1","port":1}\nlinea-uno\nlinea-dos')
  ok('contraseña con LF embebido: rechazada por contrato (exit 1)', res.stdout === 'false' && res.status === 1)
}
{
  const res = run(Buffer.concat([Buffer.from('{"host":"127.0.0.1","port":1}\n'), Buffer.from('con'), Buffer.from([0x00]), Buffer.from('nul')]))
  ok('contraseña con NUL embebido: rechazada por contrato (exit 1)', res.stdout === 'false' && res.status === 1)
}
{
  const res = run('{"host":"127.0.0.1","port":1}\n' + 'a'.repeat(5000))
  ok('contraseña que excede la longitud máxima: rechazada por contrato (exit 1)', res.stdout === 'false' && res.status === 1)
}

// ============================================================
// Bloque 6 — callsite real de S9: éxito, credencial incorrecta,
// protocolo corrupto, timeout, conexión fallida e interrupción, contra
// servidores TCP desechables reales (localhost, puerto efímero)
// ============================================================

// "Éxito" y "credencial incorrecta" con autenticación PONG genuina
// (reutilizando este MISMO helper, el callsite real de S9) se verifican
// contra un Redis real y completo en el ensayo desechable
// (s2_s5_recovery_rehearsal.sh y el ensayo integral S1-S9) — reproducir
// aquí el protocolo RESP completo (HELLO/RESP3, AUTH, PING) con un doble
// de servidor hecho a mano sería, en la práctica, una reimplementación
// paralela parcial del propio protocolo Redis, exactamente lo que este
// proyecto evita en todas partes; las pruebas de abajo cubren en cambio
// lo que SÍ se puede aislar de forma rápida, determinista y sin
// reimplementar nada: cómo se comporta este helper ante un servidor que
// NO habla el protocolo en absoluto (corrupto), uno que no responde
// nunca (timeout) y una interrupción real por señal — casos que un
// Redis real no puede provocar bajo demanda de forma fiable.

await ranAsync('protocolo corrupto (servidor no-RESP: cierra el socket al conectar) -> false, nunca crashea', () =>
  withDisposableServer(
    (socket) => socket.destroy(),
    async (port) => {
      const res = run(`{"host":"127.0.0.1","port":${port}}\ncualquier-cosa`)
      if (res.stdout !== 'false' || res.status !== 0) throw new Error(`esperado false/0, obtenido ${res.stdout}/${res.status}`)
    },
  ),
)

await ranAsync('protocolo corrupto (servidor escribe basura binaria no-RESP y mantiene el socket abierto) -> false, nunca crashea', () =>
  withDisposableServer(
    (socket) => socket.write(Buffer.from([0xff, 0x00, 0xfe, 0x01, 0x02, 0x03])),
    async (port) => {
      const res = run(`{"host":"127.0.0.1","port":${port}}\ncualquier-cosa`)
      if (res.stdout !== 'false' || res.status !== 0) throw new Error(`esperado false/0, obtenido ${res.stdout}/${res.status}`)
    },
  ),
)

await ranAsync('timeout real (servidor acepta la conexión y nunca responde) -> false, exit 0, se resuelve solo (nunca cuelga indefinidamente)', () =>
  withDisposableServer(
    () => {
      /* acepta la conexión, nunca escribe nada, nunca la cierra */
    },
    async (port) => {
      const start = Date.now()
      const res = run(`{"host":"127.0.0.1","port":${port}}\ncualquier-cosa`)
      const elapsedMs = Date.now() - start
      if (res.stdout !== 'false' || res.status !== 0) throw new Error(`esperado false/0, obtenido ${res.stdout}/${res.status}`)
      if (elapsedMs > 9000) throw new Error(`tardó ${elapsedMs}ms — debería resolverse dentro de su propio presupuesto de operación, sin depender de un timeout externo`)
    },
  ),
)

ok('conexión fallida (nadie escuchando) -> ya cubierto arriba ("host/puerto inalcanzable")', true)

await ranAsync('interrupción (SIGINT) mientras espera respuesta: termina sin colgar, nunca imprime la contraseña', () =>
  withDisposableServer(
    () => {
      /* acepta y nunca responde, para dar tiempo a enviar la señal */
    },
    (port) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => (stdout += d))
        child.stderr.on('data', (d) => (stderr += d))
        const killTimer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('el proceso no terminó tras SIGINT dentro del margen de la prueba'))
        }, 8000)
        child.on('exit', () => {
          clearTimeout(killTimer)
          if (stdout.includes('secreto-de-interrupcion') || stderr.includes('secreto-de-interrupcion')) {
            reject(new Error('la contraseña apareció en stdout/stderr tras la interrupción'))
            return
          }
          resolve()
        })
        child.stdin.write(`{"host":"127.0.0.1","port":${port}}\nsecreto-de-interrupcion`)
        child.stdin.end()
        setTimeout(() => child.kill('SIGINT'), 200)
      }),
  ),
)

summarizeAndExit()
