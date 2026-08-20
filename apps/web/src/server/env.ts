import 'server-only'
import { z } from 'zod'

import {
  APPROVAL_HOLD_HOURS,
  ARGON2ID_DEFAULT_MEMORY_COST_KIB,
  ARGON2ID_DEFAULT_PARALLELISM,
  ARGON2ID_DEFAULT_TIME_COST,
  CONTACT_REVIEW_HOLD_HOURS,
  OTP_DEFAULT_MAX_ATTEMPTS,
  OTP_DEFAULT_TTL_MINUTES,
  OTP_LOCKOUT_MINUTES,
  OTP_REQUEST_RATE_LIMIT,
  PASSWORD_RESET_SESSION_MINUTES,
  SESSION_ABSOLUTE_TTL_DAYS,
  VERIFICATION_RECOVERY_WINDOW_MINUTES,
} from '@gapssa/contracts'

import { getPayloadEnv, parsePayloadEnv } from '../payload.env'

/**
 * Variables de entorno validadas al arrancar el proceso (falla rápido y
 * con un mensaje claro si falta o es inválida alguna). `import 'server-only'`
 * hace que intentar importar este módulo desde un componente cliente sea
 * un error de build, no un fallo silencioso en el navegador — es la
 * frontera real entre "acceso a sistemas internos" y "componentes
 * cliente" que pide la Fase 1, no solo una convención de carpetas.
 *
 * `PAYLOAD_SECRET`/`DATABASE_URL_CMS` se validan una sola vez, en
 * `payload.env.ts` (reutilizado aquí) — ese módulo no lleva `server-only`
 * porque también lo carga la CLI de Payload fuera de Next.js.
 *
 * Ninguna variable aquí lleva el prefijo NEXT_PUBLIC_: eso las expondría
 * en el bundle del navegador. Lo público (NEXT_PUBLIC_SITE_URL) se valida
 * aparte, en lib/env.public.ts.
 */
export const restEnvSchema = z.object({
  DATABASE_URL_AUTH: z.url('DATABASE_URL_AUTH debe ser una URL de Postgres válida'),
  DATABASE_URL_BOOKING: z.url('DATABASE_URL_BOOKING debe ser una URL de Postgres válida'),
  REDIS_URL: z.url('REDIS_URL debe ser una URL de Redis válida'),
  REDIS_KEY_PREFIX: z.string().min(1, 'REDIS_KEY_PREFIX no puede estar vacío'),
  /**
   * Noindex global (`app/robots.ts`, metadata raíz) para entornos de
   * staging/desarrollo — `PLAN_DESARROLLO_WEB_PORTAL.md` §16: "staging y
   * desarrollo puedan configurarse como noindex global mediante variable
   * de entorno". Ausente o cualquier valor distinto de `"true"` = `false`
   * (indexable), nunca al revés — un valor mal escrito no debe desactivar
   * accidentalmente el noindex en staging.
   */
  SITE_NOINDEX: z
    .string()
    .optional()
    .transform((value) => value === 'true'),

  // -------------------------------------------------------------------
  // Fase 3 — Autenticación del portal (gapssa_auth). Secretos sin
  // fallback de desarrollo (fallan rápido si faltan); valores técnicos
  // sugeridos con un valor por defecto documentado en
  // packages/contracts/src/{otp,auth}.ts, pero siempre configurables sin
  // desplegar código nuevo — PLAN_DESARROLLO_WEB_PORTAL.md pide que los
  // valores de TTL/intentos/rate limiting pendientes de confirmar queden
  // como configuración, no como constantes de negocio silenciosas.
  // -------------------------------------------------------------------

  /** HMAC de los códigos OTP (packages/contracts/src/otp.ts) — nunca un valor por defecto. */
  OTP_HMAC_SECRET: z
    .string()
    .min(32, 'OTP_HMAC_SECRET debe tener al menos 32 caracteres'),
  /**
   * Revisión 2 de Fase 3: HMAC de los identificadores de sujeto derivados
   * de correo usados como parte de claves de Redis (p. ej.
   * `login:subject:<hmac>`, `server/auth/security.ts`) — sustituye a un
   * `sha256(email)` sin secreto, vulnerable a un ataque de diccionario.
   * Secreto propio, distinto de `OTP_HMAC_SECRET`: rotar uno no debe forzar
   * a rotar el otro. Sin valor por defecto en código — falla rápido si
   * falta. Rotarlo invalida los identificadores derivados de correo
   * vigentes: cualquier ventana de límite de frecuencia activa para un
   * sujeto concreto se "olvida" (la clave antigua deja de recibirse, la
   * nueva empieza de cero) — un efecto secundario aceptado, no un fallo de
   * seguridad, documentado en docs/fase3-autenticacion.md.
   */
  AUTH_RATE_LIMIT_HMAC_SECRET: z
    .string()
    .min(32, 'AUTH_RATE_LIMIT_HMAC_SECRET debe tener al menos 32 caracteres'),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(OTP_DEFAULT_TTL_MINUTES),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(OTP_DEFAULT_MAX_ATTEMPTS),
  OTP_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(OTP_LOCKOUT_MINUTES),
  OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR: z.coerce
    .number()
    .int()
    .positive()
    .default(OTP_REQUEST_RATE_LIMIT.maxPerSubjectPerHour),
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: z.coerce
    .number()
    .int()
    .positive()
    .default(OTP_REQUEST_RATE_LIMIT.maxPerIpPerHour),

  AUTH_SESSION_ABSOLUTE_TTL_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(SESSION_ABSOLUTE_TTL_DAYS),
  AUTH_PASSWORD_RESET_SESSION_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(PASSWORD_RESET_SESSION_MINUTES),

  /** Límite de intentos de login, independiente del límite de verificación de OTP (otp.ts). */
  AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR: z.coerce.number().int().positive().default(10),
  AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
  AUTH_LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  /**
   * Revisión 2 de Fase 3: cuántos saltos de proxy inverso de confianza hay
   * delante de Next.js — `PROJECT_CONTEXT.md` §15: "Plesk actuará como
   * proxy inverso". `getClientIp` (`server/auth/httpHelpers.ts`) usa este
   * valor para tomar la entrada correcta de `X-Forwarded-For` contando
   * desde la DERECHA (la más cercana a la aplicación, la única que un
   * proxy de confianza — no el cliente — puede escribir), nunca la primera
   * entrada (aportada por quien hace la petición, falsificable sin proxy
   * que la sanee). Producción con un único Plesk/nginx inmediatamente
   * delante de Next.js: 1 (valor por defecto). 0 significa "no hay ningún
   * proxy de confianza documentado": no confíes en ninguna cabecera
   * `X-Forwarded-For`, usa el sujeto agregado `unknown`. Si se añade un
   * proxy/CDN adicional delante de Plesk, sube este número en la misma
   * medida — nunca al revés (bajarlo sin que la topología real cambie
   * empieza a confiar en una entrada que el cliente controla).
   */
  TRUSTED_PROXY_HOP_COUNT: z.coerce.number().int().min(0).default(1),

  /** Parámetros de Argon2id (auth.ts) — mínimo recomendado por OWASP para Argon2id por defecto. */
  ARGON2_MEMORY_COST_KIB: z.coerce
    .number()
    .int()
    .positive()
    .default(ARGON2ID_DEFAULT_MEMORY_COST_KIB),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(ARGON2ID_DEFAULT_TIME_COST),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(ARGON2ID_DEFAULT_PARALLELISM),

  /**
   * SMTP operativo (`PLAN_DESARROLLO_WEB_PORTAL.md` §13.1: SMTP de
   * `gapssa.es`, remitente `reservas@gapssa.es`). Credenciales reales
   * pendientes (§21) — `SMTP_HOST` vacío activa un transporte de
   * desarrollo que nunca envía correo real (ver
   * `server/auth/mailer.ts`), nunca un envío silencioso a un servidor
   * real con credenciales de relleno.
   */
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  /** Remitente ya decidido por el plan (no un secreto) — configurable igualmente, nunca hardcodeado en el código. */
  SMTP_FROM_EMAIL: z.string().optional().default('reservas@gapssa.es'),

  // -------------------------------------------------------------------
  // Fase 4A — Reservas (gapssa_booking). Secretos sin fallback de
  // desarrollo (fallan rápido si faltan); valores técnicos sugeridos con
  // un valor por defecto documentado. Los valores de negocio ya fijados
  // por PLAN_DESARROLLO_WEB_PORTAL.md/packages/contracts/src/booking.ts
  // (antelación mínima, horizonte máximo, holds de verificación/
  // aprobación, límite de solicitudes pendientes) se importan siempre de
  // ahí — deliberadamente NO se repiten aquí como variables de entorno,
  // para no crear una segunda fuente de verdad de una regla de negocio ya
  // fijada (comentario de cabecera de booking.ts: "No redefinir estos
  // valores en otro sitio del código").
  // -------------------------------------------------------------------

  /**
   * Mapa JSON `{ "<keyVersion>": "<clave base64 de 32 bytes>" }` para
   * AES-256-GCM (server/crypto/fieldCrypto.ts, cifrado de
   * `PendingGuestIdentity`). Todas las versiones listadas siguen siendo
   * válidas para DESCIFRAR (permite rotar sin invalidar de golpe los datos
   * ya cifrados con una versión anterior); solo
   * `BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION` se usa para CIFRAR datos
   * nuevos. Sin valor por defecto — falla rápido si falta o si alguna
   * clave no decodifica a exactamente 32 bytes.
   */
  BOOKING_FIELD_ENCRYPTION_KEYS: z.string().transform((value, ctx) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'BOOKING_FIELD_ENCRYPTION_KEYS debe ser JSON válido.' })
      return z.NEVER
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      ctx.addIssue({
        code: 'custom',
        message: 'BOOKING_FIELD_ENCRYPTION_KEYS debe ser un objeto {"keyVersion": "claveBase64"}.',
      })
      return z.NEVER
    }

    const result: Record<string, string> = {}
    for (const [version, key] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string') {
        ctx.addIssue({ code: 'custom', message: `BOOKING_FIELD_ENCRYPTION_KEYS["${version}"] debe ser un string.` })
        return z.NEVER
      }
      let decoded: Buffer
      try {
        decoded = Buffer.from(key, 'base64')
      } catch {
        ctx.addIssue({ code: 'custom', message: `BOOKING_FIELD_ENCRYPTION_KEYS["${version}"] no es base64 válido.` })
        return z.NEVER
      }
      if (decoded.length !== 32) {
        ctx.addIssue({
          code: 'custom',
          message: `BOOKING_FIELD_ENCRYPTION_KEYS["${version}"] debe decodificar a 32 bytes (AES-256); tiene ${decoded.length}.`,
        })
        return z.NEVER
      }
      result[version] = key
    }

    if (Object.keys(result).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'BOOKING_FIELD_ENCRYPTION_KEYS no puede estar vacío.' })
      return z.NEVER
    }

    return result
  }),
  /** Qué versión de BOOKING_FIELD_ENCRYPTION_KEYS se usa para cifrar datos nuevos — debe existir en ese mapa (comprobado en el refine del objeto completo, más abajo). */
  BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: z
    .string()
    .min(1, 'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION no puede estar vacío'),
  /**
   * HMAC del correo normalizado del invitado (`emailLookupHmac`,
   * packages/contracts/src/booking.ts) — secreto propio, distinto de
   * `OTP_HMAC_SECRET`/`AUTH_RATE_LIMIT_HMAC_SECRET` (rotar uno no debe
   * forzar a rotar los otros). Mapa JSON `{ "<keyVersion>": "<secreto>" }`
   * — mismo patrón de rotación que `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS`:
   * cada `pending_guest_identities` guarda con qué versión se calculó su
   * `emailLookupHmac` (`emailLookupHmacKeyVersion`); durante convivencia,
   * `guestFlow.ts` busca bajo TODAS las versiones presentes en el mapa, no
   * solo la activa. Retirar una versión solo es seguro cuando ya no queda
   * ninguna fila que la referencie (`countRowsStillOnEmailLookupHmacVersion`,
   * `rotationSafetyChecks.ts`).
   */
  BOOKING_EMAIL_LOOKUP_HMAC_SECRETS: z.string().transform((value, ctx) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS debe ser JSON válido.' })
      return z.NEVER
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      ctx.addIssue({
        code: 'custom',
        message: 'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS debe ser un objeto {"keyVersion": "secreto"}.',
      })
      return z.NEVER
    }

    const result: Record<string, string> = {}
    for (const [version, secret] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof secret !== 'string' || secret.length < 32) {
        ctx.addIssue({
          code: 'custom',
          message: `BOOKING_EMAIL_LOOKUP_HMAC_SECRETS["${version}"] debe ser un string de al menos 32 caracteres.`,
        })
        return z.NEVER
      }
      result[version] = secret
    }

    if (Object.keys(result).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'BOOKING_EMAIL_LOOKUP_HMAC_SECRETS no puede estar vacío.' })
      return z.NEVER
    }

    return result
  }),
  /** Qué versión de BOOKING_EMAIL_LOOKUP_HMAC_SECRETS se usa para huellas nuevas — debe existir en ese mapa (comprobado en el refine del objeto completo). */
  BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION: z
    .string()
    .min(1, 'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION no puede estar vacío'),
  /**
   * Revisión 2 de Fase 4A: mapa JSON `{ "<keyVersion>": "<secreto>" }` para
   * la huella HMAC-SHA-256 de identidad/contacto que sustituye al correo en
   * claro dentro del payload canónico de idempotencia
   * (`server/booking/identityFingerprint.ts`). Mismo patrón de rotación que
   * `BOOKING_FIELD_ENCRYPTION_KEYS`: todas las versiones listadas siguen
   * siendo válidas para RECALCULAR/COMPARAR la huella de una solicitud ya
   * persistida (cada `BookingRequestRecord` guarda con qué versión se
   * calculó su huella, `identityFingerprintKeyVersion`); solo
   * `BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION` se usa para huellas
   * nuevas. Retirar una versión del mapa antes de que caduque el último
   * `BookingRequestRecord` que la referencia rompe la detección de replay
   * de esa solicitud todavía viva — ver el comentario de cabecera de
   * `identityFingerprint.ts` para la ventana de retención recomendada.
   */
  BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS: z.string().transform((value, ctx) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS debe ser JSON válido.' })
      return z.NEVER
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      ctx.addIssue({
        code: 'custom',
        message: 'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS debe ser un objeto {"keyVersion": "secreto"}.',
      })
      return z.NEVER
    }

    const result: Record<string, string> = {}
    for (const [version, secret] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof secret !== 'string' || secret.length < 32) {
        ctx.addIssue({
          code: 'custom',
          message: `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS["${version}"] debe ser un string de al menos 32 caracteres.`,
        })
        return z.NEVER
      }
      result[version] = secret
    }

    if (Object.keys(result).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS no puede estar vacío.' })
      return z.NEVER
    }

    return result
  }),
  /** Qué versión de BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS se usa para huellas nuevas — debe existir en ese mapa (comprobado en el refine del objeto completo). */
  BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION: z
    .string()
    .min(1, 'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION no puede estar vacío'),
  /**
   * HMAC del token de acceso opaco que recibe un invitado sin sesión al
   * crear una solicitud (`server/booking/accessToken.ts`) — evita que
   * cualquiera pueda consultar/verificar una solicitud ajena adivinando su
   * `id` (UUID). Mapa JSON `{ "<keyVersion>": "<secreto>" }` — cada
   * `booking_request_records` guarda con qué versión se firmó su token
   * (`accessTokenKeyVersion`, escrita al crear la solicitud y nunca
   * recalculada); verificar usa SIEMPRE esa versión guardada, nunca
   * "probar todas las presentes en el mapa" — una versión desconocida es
   * un error explícito, nunca una aceptación silenciosa. Retirar una
   * versión del mapa solo es seguro cuando
   * `countLiveBookingRequestsReferencingAccessTokenVersions` para esa
   * versión llega a 0.
   */
  BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS: z.string().transform((value, ctx) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS debe ser JSON válido.' })
      return z.NEVER
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      ctx.addIssue({
        code: 'custom',
        message: 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS debe ser un objeto {"keyVersion": "secreto"}.',
      })
      return z.NEVER
    }

    const result: Record<string, string> = {}
    for (const [version, secret] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof secret !== 'string' || secret.length < 32) {
        ctx.addIssue({
          code: 'custom',
          message: `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS["${version}"] debe ser un string de al menos 32 caracteres.`,
        })
        return z.NEVER
      }
      result[version] = secret
    }

    if (Object.keys(result).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS no puede estar vacío.' })
      return z.NEVER
    }

    return result
  }),
  /** Qué versión de BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS se usa para firmar tokens nuevos — debe existir en ese mapa (comprobado en el refine del objeto completo). */
  BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION: z
    .string()
    .min(1, 'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION no puede estar vacío'),
  /**
   * Secreto compartido para los endpoints internos de reservas (barrido de
   * conciliación, decisión de aprobación simulada de EspoCRM) — nunca
   * expuestos al navegador, protegidos por cabecera
   * `X-Internal-Api-Secret`. Sin valor por defecto; sustituye, en esta
   * fase, al mecanismo real de autenticación interna/cron que se decida
   * más adelante.
   */
  BOOKING_INTERNAL_API_SECRET: z.string().min(32, 'BOOKING_INTERNAL_API_SECRET debe tener al menos 32 caracteres'),
  /** Valor técnico sugerido (packages/contracts/src/booking.ts, VERIFICATION_RECOVERY_WINDOW_MINUTES) — configurable sin desplegar código nuevo. */
  BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(VERIFICATION_RECOVERY_WINDOW_MINUTES),
  /**
   * Revisión 3 de Fase 4B, punto 7: plazo máximo que un `BookingReviewRecord`
   * puede permanecer `pending` antes de que el barrido lo caduque. Las 72h
   * originales (revisión 2) NO estaban aprobadas como decisión de negocio y
   * bloqueaban el horario del profesional/zona tres días completos — ver
   * `listUnresolvedOverlapping` (repository.ts), que cuenta
   * `contact_review_pending` como ocupación real. Alineado provisionalmente
   * con `APPROVAL_HOLD_HOURS` (mismo tipo de espera "post-verificación,
   * pre-decisión-final" que `pending_approval`, booking.ts): nunca puede
   * configurarse por encima de esa ventana sin decidirlo explícitamente en
   * el propio contrato (`APPROVAL_HOLD_HOURS`), no solo en esta variable de
   * entorno. Si existe un motivo técnico real para volver a 72h, es una
   * decisión de negocio pendiente — no se impone aquí; V1 usa 5h
   * (`CONTACT_REVIEW_HOLD_HOURS`, packages/contracts/src/booking.ts).
   */
  BOOKING_CONTACT_REVIEW_HOLD_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .max(APPROVAL_HOLD_HOURS, `BOOKING_CONTACT_REVIEW_HOLD_HOURS no puede superar APPROVAL_HOLD_HOURS (${APPROVAL_HOLD_HOURS}h) sin una decisión de negocio explícita.`)
    .default(CONTACT_REVIEW_HOLD_HOURS),

  /**
   * Horario de apertura (PLAN_DESARROLLO_WEB_PORTAL.md, confirmado por el
   * encargo de Fase 4A: lunes a sábado, 09:00–21:00) — valor de negocio ya
   * fijado, pero configurable sin desplegar código nuevo (nunca hardcodeado
   * disperso, ver server/booking/availabilityConfig.ts). Días 0=domingo..6=sábado.
   */
  BOOKING_BUSINESS_DAYS: z
    .string()
    .optional()
    .default('1,2,3,4,5,6')
    .transform((value, ctx) => {
      const days = value.split(',').map((entry) => Number.parseInt(entry.trim(), 10))
      if (days.some((day) => Number.isNaN(day) || day < 0 || day > 6)) {
        ctx.addIssue({ code: 'custom', message: 'BOOKING_BUSINESS_DAYS debe ser una lista de enteros 0-6.' })
        return z.NEVER
      }
      return days
    }),
  BOOKING_OPEN_TIME: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'BOOKING_OPEN_TIME debe tener formato HH:MM').default('09:00'),
  BOOKING_CLOSE_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'BOOKING_CLOSE_TIME debe tener formato HH:MM')
    .default('21:00'),
  BOOKING_SLOT_GRANULARITY_MINUTES: z.coerce.number().int().positive().default(15),
  /** Tope de seguridad de slots devueltos por una sola consulta de disponibilidad — nunca un escaneo sin límite. */
  BOOKING_MAX_SLOTS_PER_QUERY: z.coerce.number().int().positive().default(40),

  /**
   * Límites de frecuencia por IP de los endpoints de reservas — igual que
   * el resto de límites de este archivo, configurables sin desplegar
   * código nuevo, nunca hardcodeados en la ruta (`server/booking/*`,
   * `app/api/booking/v1/**`). Valores técnicos sugeridos.
   */
  BOOKING_REQUEST_MAX_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),
  BOOKING_VERIFY_MAX_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
  BOOKING_AVAILABILITY_MAX_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(120),

  /**
   * Fase 4B — selector EXPLÍCITO del adaptador de reservas contra EspoCRM
   * (`server/booking/espoAdapter.ts`/`httpEspoAdapter.ts`). Por defecto
   * `simulated`: ningún entorno (incluidas las suites de pruebas) pasa a
   * usar el adaptador HTTP real por accidente — hay que pedirlo
   * explícitamente. `http` sin `ESPOCRM_API_BASE_URL`/`ESPOCRM_API_KEY`
   * completos falla el arranque del proceso (ver superRefine más abajo),
   * nunca cae de vuelta al simulado en silencio.
   */
  ESPO_BOOKING_ADAPTER: z.enum(['simulated', 'http']).default('simulated'),
  /** Ej. `http://localhost:8081` en desarrollo (apps/web corre con `next dev` en el host, no en un contenedor — no usar el hostname interno de Docker `espocrm`), `https://crm.gapssa.es` en producción. */
  ESPOCRM_API_BASE_URL: z.string().url('ESPOCRM_API_BASE_URL debe ser una URL válida').optional(),
  /** API Key de un API User de EspoCRM dedicado (nunca `admin` ni una cuenta humana) — cabecera `X-Api-Key`. Creación real en EspoCRM pendiente de autorización aparte (Fase 4B, punto 10). */
  ESPOCRM_API_KEY: z.string().min(1, 'ESPOCRM_API_KEY no puede estar vacío').optional(),
  ESPOCRM_API_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  /** Reintentos únicamente para operaciones idempotentes/seguras (ver httpEspoAdapter.ts) — nunca para una escritura ambigua. */
  ESPOCRM_API_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  ESPOCRM_API_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(200),
  /** Protección contra respuestas inesperadamente grandes — corta la lectura del body antes de intentar parsear JSON. */
  ESPOCRM_API_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(2_000_000),
  /**
   * EspoCRM no tiene ningún campo/rol que marque un `User` como
   * "profesional reservable" (auditoría Fase 4B: el rol "Profesional
   * Gapssa" existe, pero decidir por rol/equipo sería inventar una regla de
   * negocio no confirmada). Lista blanca explícita y auditable de
   * `User.id` de EspoCRM, en vez de adivinar un criterio — pendiente de que
   * el propietario del proyecto confirme el criterio definitivo.
   */
  ESPOCRM_PROFESSIONAL_USER_IDS: z
    .string()
    .optional()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),

  /** Nunca definida por Next.js aparte de lo que el propio Node establece — solo se lee para la comprobación de producción de Puerta 5B-2A, más abajo. */
  NODE_ENV: z.string().optional(),
  /**
   * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas, NUNCA una
   * función productiva: permite que el proceso AISLADO de la futura
   * subpuerta 5B-2B (nunca el proceso principal de `localhost:3000`) fije
   * `cExcluirGoogleCalendarSync=true` en el `Meeting` de la primera
   * reserva real, decidido exclusivamente server-side
   * (`server/booking/controlledTestMode.ts`) — nunca a partir de una
   * entrada del navegador, de query params, cookies, formularios, Payload
   * CMS ni de ningún dato persistido controlable por el cliente. Default
   * `false`; `true` solo válido junto con `ESPO_BOOKING_ADAPTER=http`,
   * `NODE_ENV!==production` y `ESPOCRM_CONTROLLED_TEST_RUN_ID` presente y
   * bien formado (ver `superRefine` más abajo) — cualquier otra
   * combinación falla el arranque del proceso, nunca se ignora en
   * silencio ni cae de vuelta a `false`.
   */
  ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  /**
   * Identificador CSPRNG efímero de la ejecución de prueba controlada de
   * Puerta 5B-2A (p. ej. `puerta5b2a-` + `crypto.randomBytes(16).toString('hex')`)
   * — solo trazabilidad interna, NUNCA una contraseña ni un mecanismo de
   * acceso HTTP por sí mismo. Nunca se registra completo en logs (ver
   * `controlledTestMode.ts`/`httpEspoAdapter.ts`). Formato cerrado,
   * validado incluso cuando `ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS` está
   * ausente/`false` — mismo principio que `ESPOCRM_API_BASE_URL` (falla
   * rápido ante configuración malformada en vez de diferir el error).
   */
  ESPOCRM_CONTROLLED_TEST_RUN_ID: z
    .string()
    .regex(
      /^puerta5b2a-[a-f0-9]{32,64}$/,
      'ESPOCRM_CONTROLLED_TEST_RUN_ID debe tener el formato puerta5b2a-<32 a 64 caracteres hexadecimales>.',
    )
    .optional(),
})
  .superRefine((data, ctx) => {
    if (!(data.BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION in data.BOOKING_FIELD_ENCRYPTION_KEYS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION'],
        message:
          'BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION debe ser una de las versiones presentes en BOOKING_FIELD_ENCRYPTION_KEYS.',
      })
    }
    if (!(data.BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION in data.BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION'],
        message:
          'BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION debe ser una de las versiones presentes en BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS.',
      })
    }
    if (!(data.BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION in data.BOOKING_EMAIL_LOOKUP_HMAC_SECRETS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION'],
        message:
          'BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION debe ser una de las versiones presentes en BOOKING_EMAIL_LOOKUP_HMAC_SECRETS.',
      })
    }
    if (!(data.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION in data.BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION'],
        message:
          'BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION debe ser una de las versiones presentes en BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS.',
      })
    }
    if (data.BOOKING_OPEN_TIME >= data.BOOKING_CLOSE_TIME) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOOKING_CLOSE_TIME'],
        message: 'BOOKING_CLOSE_TIME debe ser posterior a BOOKING_OPEN_TIME.',
      })
    }
    // Fallo seguro: pedir el adaptador http sin configuración completa nunca
    // debe arrancar el proceso ni caer de vuelta al simulado en silencio.
    if (data.ESPO_BOOKING_ADAPTER === 'http') {
      if (!data.ESPOCRM_API_BASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['ESPOCRM_API_BASE_URL'],
          message: 'ESPOCRM_API_BASE_URL es obligatorio cuando ESPO_BOOKING_ADAPTER=http.',
        })
      }
      if (!data.ESPOCRM_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['ESPOCRM_API_KEY'],
          message: 'ESPOCRM_API_KEY es obligatorio cuando ESPO_BOOKING_ADAPTER=http.',
        })
      }
      if (data.ESPOCRM_PROFESSIONAL_USER_IDS.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['ESPOCRM_PROFESSIONAL_USER_IDS'],
          message: 'ESPOCRM_PROFESSIONAL_USER_IDS es obligatorio (lista separada por comas) cuando ESPO_BOOKING_ADAPTER=http.',
        })
      }
    }

    // Puerta 5B-2A: mismo principio de fallo seguro que el bloque anterior
    // — nunca arranca el proceso con la combinación pedida si no es
    // exactamente la autorizada, nunca cae de vuelta a `false` en silencio.
    if (data.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS) {
      if (data.NODE_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS'],
          message: 'ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS nunca puede activarse en producción (NODE_ENV=production).',
        })
      }
      if (data.ESPO_BOOKING_ADAPTER !== 'http') {
        ctx.addIssue({
          code: 'custom',
          path: ['ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS'],
          message: 'ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS requiere ESPO_BOOKING_ADAPTER=http — nunca con el adaptador simulado.',
        })
      }
      if (!data.ESPOCRM_CONTROLLED_TEST_RUN_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['ESPOCRM_CONTROLLED_TEST_RUN_ID'],
          message: 'ESPOCRM_CONTROLLED_TEST_RUN_ID es obligatorio cuando ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true.',
        })
      }
    }
  })

export type ServerEnv = z.infer<typeof restEnvSchema> & PayloadEnvPart
type PayloadEnvPart = ReturnType<typeof getPayloadEnv>

/** Función pura, igual que parsePayloadEnv: para pruebas sin tocar process.env. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const payloadEnv = parsePayloadEnv(source)
  const parsed = restEnvSchema.safeParse(source)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new Error(`Variables de entorno de servidor inválidas o ausentes:\n${issues}`)
  }

  return { ...payloadEnv, ...parsed.data }
}

export const serverEnv = parseServerEnv(process.env)
