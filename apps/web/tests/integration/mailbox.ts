import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { simpleParser } from 'mailparser'
import { SMTPServer } from 'smtp-server'

/**
 * Buzón SMTP efímero y aislado, levantado exclusivamente para la suite de
 * integración (`global-setup.ts`) — sustituye a `DEV_MAILER_LOG_FILE`
 * (revisión 2 de Fase 3: ese mecanismo hacía que `mailer.ts` volcara el
 * correo/OTP en un fichero, un log con secretos y PII disfrazado de
 * "solo para pruebas").
 *
 * Equivalente funcional de Mailpit para este monorepo: un servidor SMTP
 * real (`smtp-server`) que acepta la entrega igual que cualquier SMTP de
 * pruebas, más una API HTTP mínima para consultar los mensajes recibidos —
 * las pruebas leen el OTP del propio canal de entrega (el correo), nunca
 * de un log de aplicación. Se prefiere un servidor en proceso a levantar
 * un contenedor Docker de Mailpit: arranca/cierra en milisegundos junto al
 * resto de `global-setup.ts`, no requiere coordinar puertos con
 * `compose.yml` ni depender de que Docker esté disponible para
 * `npm run test:integration`, y su ciclo de vida es idéntico al de la
 * base de datos/Redis efímeros de la misma suite: nace y muere con la
 * ejecución, nunca comparte estado entre ejecuciones.
 *
 * `close()` destruye el buzón y todos los mensajes en memoria — no hay
 * persistencia a disco en ningún momento.
 */

interface CapturedMessage {
  to: string
  subject: string
  text: string
  receivedAt: string
}

export interface TestMailbox {
  /** Host/puerto SMTP para SMTP_HOST/SMTP_PORT del servidor de pruebas. */
  smtpHost: string
  smtpPort: number
  /** Puerto de la API HTTP de consulta (`GET /messages?to=`), solo para el propio proceso de pruebas. */
  httpPort: number
  close(): Promise<void>
}

/** Tiempo máximo razonable para que un servidor en loopback empiece a escuchar — nunca depende del timeout por defecto de la suite. */
const LISTEN_TIMEOUT_MS = 5000

interface ListenableServer {
  listen(port: number, host: string, cb: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
}

/**
 * Antes de esta revisión, `listen()` solo resolvía en éxito (el callback de
 * `.listen()`) y nunca escuchaba el evento `error` — si el puerto no podía
 * abrirse (recursos agotados, `EADDRNOTAVAIL`, etc.), la Promise se quedaba
 * pendiente para siempre y la prueba colgaba hasta el timeout genérico de
 * la suite, sin ninguna pista de la causa real. Ahora: escucha `error` y
 * rechaza de inmediato con el error original (nunca lo registra ni lo
 * transforma — un fallo de bind no lleva secretos, pero tampoco hay
 * necesidad de imprimir nada aquí), retira ambos listeners tras resolver o
 * rechazar, y aplica un timeout explícito para el caso límite en el que ni
 * `listening` ni `error` llegaran a dispararse.
 */
export function listen(server: ListenableServer, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      clearTimeout(timeout)
      reject(error)
    }

    const timeout = setTimeout(() => {
      server.removeListener('error', onError)
      reject(new Error(`Tiempo de espera agotado (${LISTEN_TIMEOUT_MS}ms) abriendo el buzón SMTP de pruebas.`))
    }, LISTEN_TIMEOUT_MS)

    server.once('error', onError)
    server.listen(0, host, () => {
      clearTimeout(timeout)
      server.removeListener('error', onError)
      resolve()
    })
  })
}

export async function startTestMailbox(): Promise<TestMailbox> {
  const messages: CapturedMessage[] = []
  const host = '127.0.0.1'

  const smtpServer = new SMTPServer({
    // Buzón de pruebas sin autenticación ni TLS: solo escucha en loopback,
    // exclusivo de esta ejecución (mismo modelo de confianza que Postgres/
    // Redis efímeros de la misma suite).
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((parsed) => {
          const toAddress = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to
          const to = toAddress?.value[0]?.address?.toLowerCase() ?? ''
          messages.push({
            to,
            subject: parsed.subject ?? '',
            text: parsed.text ?? '',
            receivedAt: new Date().toISOString(),
          })
          callback()
        })
        .catch((error: unknown) => callback(error instanceof Error ? error : new Error(String(error))))
    },
  })

  await listen(smtpServer, host)
  const smtpPort = (smtpServer.server.address() as AddressInfo).port

  const httpServer: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`)
    if (request.method === 'GET' && url.pathname === '/messages') {
      const to = url.searchParams.get('to')?.toLowerCase()
      const matching = to ? messages.filter((message) => message.to === to) : messages
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(matching))
      return
    }
    response.statusCode = 404
    response.end()
  })

  try {
    await listen(httpServer, host)
  } catch (error) {
    // El buzón SMTP ya está abierto — si el segundo servidor (la API HTTP
    // de consulta) no puede levantarse, no dejamos el primero abierto sin
    // que nadie lo vaya a cerrar nunca (esta función nunca llega a
    // devolver una referencia a él).
    await new Promise<void>((resolve) => smtpServer.close(() => resolve()))
    throw error
  }
  const httpPort = (httpServer.address() as AddressInfo).port

  return {
    smtpHost: host,
    smtpPort,
    httpPort,
    async close() {
      messages.length = 0
      await Promise.all([
        new Promise<void>((resolve) => smtpServer.close(() => resolve())),
        new Promise<void>((resolve) => httpServer.close(() => resolve())),
      ])
    },
  }
}
