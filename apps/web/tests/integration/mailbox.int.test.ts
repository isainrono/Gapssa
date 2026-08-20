import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { listen, startTestMailbox } from './mailbox'

/**
 * Revisión 3 de Fase 3: antes de esta revisión, `listen()` solo resolvía
 * en éxito y nunca escuchaba el evento `error` — si un servidor no podía
 * abrir el puerto, la Promise se quedaba pendiente para siempre y la
 * prueba colgaba hasta el timeout genérico de la suite. Estas pruebas
 * ejercitan `listen()` directamente contra servidores falsos (nunca contra
 * red real) para comprobar los tres caminos de forma rápida y
 * determinista, sin depender de provocar un fallo de bind real.
 */

type ListenCallback = () => void

class FakeServer extends EventEmitter {
  listenCallCount = 0

  constructor(private readonly behavior: 'succeed' | 'error' | 'hang') {
    super()
  }

  listen(_port: number, _host: string, callback: ListenCallback): this {
    this.listenCallCount += 1
    if (this.behavior === 'succeed') {
      queueMicrotask(callback)
    } else if (this.behavior === 'error') {
      queueMicrotask(() => this.emit('error', new Error('EADDRINUSE (simulado, sin red real)')))
    }
    // 'hang': nunca llama al callback ni emite 'error' — ejercita el timeout explícito.
    return this
  }
}

describe('mailbox listen() helper', () => {
  it('resolves once the server reports it is listening, and removes the error listener afterwards', async () => {
    const server = new FakeServer('succeed')
    await expect(listen(server, '127.0.0.1')).resolves.toBeUndefined()
    expect(server.listenerCount('error')).toBe(0)
  })

  it('rejects immediately on an "error" event instead of hanging until a generic timeout', async () => {
    const server = new FakeServer('error')
    await expect(listen(server, '127.0.0.1')).rejects.toThrow('EADDRINUSE')
    expect(server.listenerCount('error')).toBe(0)
  })

  it('rejects with an explicit, bounded timeout if the server never reports success or failure', async () => {
    vi.useFakeTimers()
    try {
      const server = new FakeServer('hang')
      const pending = listen(server, '127.0.0.1')
      const assertion = expect(pending).rejects.toThrow(/Tiempo de espera agotado/)
      await vi.runAllTimersAsync()
      await assertion
      expect(server.listenerCount('error')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('startTestMailbox()', () => {
  it('starts real SMTP + HTTP servers on ephemeral ports and closes cleanly', async () => {
    const mailbox = await startTestMailbox()
    try {
      expect(mailbox.smtpPort).toBeGreaterThan(0)
      expect(mailbox.httpPort).toBeGreaterThan(0)
      expect(mailbox.smtpPort).not.toBe(mailbox.httpPort)
    } finally {
      await mailbox.close()
    }
  })
})
