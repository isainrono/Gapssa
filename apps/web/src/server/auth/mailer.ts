import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

import { serverEnv } from '../env'

/**
 * Correo operativo de autenticación (`PLAN_DESARROLLO_WEB_PORTAL.md`
 * §13.1). Credenciales SMTP reales pendientes de Gapssa (§21) — con
 * `SMTP_HOST` vacío no existe ningún canal de entrega real: `sendMail()`
 * no envía nada y se limita a registrar un evento genérico.
 *
 * Revisión 2 de Fase 3: la revisión anterior volcaba por consola (y,
 * opcionalmente, en `DEV_MAILER_LOG_FILE`) el destinatario, el asunto, el
 * cuerpo completo y por tanto el OTP en claro — un log con secretos y PII,
 * sin importar que sustituyera al canal de correo real. Eso queda
 * prohibido sin excepción (`PLAN_DESARROLLO_WEB_PORTAL.md` §15): ningún
 * OTP, correo, token o cuerpo de mensaje aparece jamás en stdout/stderr ni
 * en ningún fichero. El único rastro permitido en desarrollo sin SMTP
 * configurado es un evento genérico (`mail_queued`), sin destinatario ni
 * contenido — y ni siquiera eso pasa por `server/auth/audit.ts` o por
 * cualquier logger compartido con el resto de la aplicación.
 *
 * Para poder probar el flujo completo (incluida la lectura del código OTP
 * recibido) sin credenciales reales, la suite de integración configura
 * `SMTP_HOST`/`SMTP_PORT` apuntando a un buzón SMTP efímero y aislado
 * levantado exclusivamente para la ejecución
 * (`tests/integration/mailbox.ts`) — desde el punto de vista de este
 * módulo es indistinguible de un SMTP real: el correo se entrega de
 * verdad, por SMTP, y las pruebas lo consultan como consultarían
 * cualquier servidor de pruebas, nunca raspando logs de la aplicación.
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

let transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (transporter) {
    return transporter
  }

  if (!serverEnv.SMTP_HOST) {
    // Sin SMTP configurado (ni real, ni un buzón de pruebas): no hay
    // ningún canal de entrega. `jsonTransport` no envía nada a ninguna
    // parte — sendMail() más abajo se limita a registrar el evento
    // genérico `mail_queued`.
    transporter = nodemailer.createTransport({ jsonTransport: true })
    return transporter
  }

  transporter = nodemailer.createTransport({
    host: serverEnv.SMTP_HOST,
    port: serverEnv.SMTP_PORT,
    secure: serverEnv.SMTP_SECURE,
    auth: serverEnv.SMTP_USER
      ? { user: serverEnv.SMTP_USER, pass: serverEnv.SMTP_PASSWORD }
      : undefined,
  })
  return transporter
}

export async function sendMail(message: MailMessage): Promise<void> {
  const mailTransporter = getTransporter()

  await mailTransporter.sendMail({
    from: serverEnv.SMTP_FROM_EMAIL,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })

  if (!serverEnv.SMTP_HOST) {
    // Evento genérico, sin destinatario ni contenido — nunca el correo, el
    // asunto, el cuerpo ni ningún OTP/token. No usa server/auth/audit.ts:
    // no es un hecho de negocio auditable, es el único rastro de
    // diagnóstico permitido cuando no hay ningún canal de entrega real.
    console.log('[mailer] mail_queued')
  }
}
