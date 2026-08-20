import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startTestMailbox, type TestMailbox } from '../../../tests/integration/mailbox'

/**
 * Revisión 2 de Fase 3: la versión anterior de `mailer.ts` volcaba por
 * `console.log` (y opcionalmente en `DEV_MAILER_LOG_FILE`) el destinatario,
 * el asunto, el cuerpo completo y por tanto el OTP en claro. Estas pruebas
 * capturan literalmente stdout/stderr durante `sendMail()` y comprueban
 * que ningún dato sensible aparece jamás — ni en el camino sin SMTP
 * configurado (evento genérico permitido) ni, sobre todo, en el camino con
 * SMTP configurado (entrega real, cero registro).
 */

const SECRET_OTP_CODE = '482913'
const SECRET_PASSWORD_LOOKING_TOKEN = 'Correct-Horse-Battery-42!'
const RECIPIENT_EMAIL = 'sensitive-recipient@example.test'
const SECRET_SUBJECT = 'Verifica tu correo — GAPSSA'

function captureConsole() {
  const calls: string[] = []
  const record = (...args: unknown[]) => {
    calls.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
  }
  const logSpy = vi.spyOn(console, 'log').mockImplementation(record)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(record)
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(record)
  return {
    calls,
    restore() {
      logSpy.mockRestore()
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    },
  }
}

function assertNoSensitiveContent(haystack: string) {
  expect(haystack).not.toContain(SECRET_OTP_CODE)
  expect(haystack).not.toContain(SECRET_PASSWORD_LOOKING_TOKEN)
  expect(haystack).not.toContain(RECIPIENT_EMAIL)
  expect(haystack).not.toContain(SECRET_SUBJECT)
}

describe('sendMail — never leaks OTP/PII to stdout/stderr', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('without SMTP configured: logs only a generic "mail_queued" event, with no recipient/subject/body/OTP', async () => {
    vi.stubEnv('SMTP_HOST', '')
    const console_ = captureConsole()
    try {
      const { sendMail } = await import('./mailer')
      await sendMail({
        to: RECIPIENT_EMAIL,
        subject: SECRET_SUBJECT,
        text: `Tu código de verificación es: ${SECRET_OTP_CODE}. Contraseña de referencia: ${SECRET_PASSWORD_LOOKING_TOKEN}`,
      })

      expect(console_.calls.length).toBeGreaterThan(0)
      const combined = console_.calls.join('\n')
      assertNoSensitiveContent(combined)
      expect(combined).toContain('mail_queued')
    } finally {
      console_.restore()
    }
  })

  it('with SMTP configured (ephemeral test mailbox): delivers the mail for real over SMTP and logs NOTHING at all', async () => {
    const mailbox: TestMailbox = await startTestMailbox()
    try {
      vi.stubEnv('SMTP_HOST', mailbox.smtpHost)
      vi.stubEnv('SMTP_PORT', String(mailbox.smtpPort))
      vi.stubEnv('SMTP_SECURE', 'false')

      const console_ = captureConsole()
      try {
        const { sendMail } = await import('./mailer')
        await sendMail({
          to: RECIPIENT_EMAIL,
          subject: SECRET_SUBJECT,
          text: `Tu código de verificación es: ${SECRET_OTP_CODE}. Contraseña de referencia: ${SECRET_PASSWORD_LOOKING_TOKEN}`,
        })

        // Cero rastro en stdout/stderr, ni siquiera un evento genérico:
        // con SMTP configurado, el canal de entrega es el correo real.
        expect(console_.calls).toHaveLength(0)
      } finally {
        console_.restore()
      }

      // Prueba de control: el mensaje sí llegó de verdad al buzón (canal
      // de entrega legítimo) — la ausencia de logging no es porque el
      // envío haya fallado en silencio.
      const response = await fetch(
        `http://127.0.0.1:${mailbox.httpPort}/messages?to=${encodeURIComponent(RECIPIENT_EMAIL)}`,
      )
      const messages = (await response.json()) as Array<{ text: string }>
      expect(messages).toHaveLength(1)
      expect(messages[0]?.text).toContain(SECRET_OTP_CODE)
    } finally {
      await mailbox.close()
    }
  })
})
