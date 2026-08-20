/**
 * Nombres de cookies de autenticación — módulo deliberadamente sin
 * `import 'server-only'` ni dependencias pesadas (Postgres, Redis): lo
 * importan tanto `proxy.ts` (Edge runtime, nunca debe cargar el cliente de
 * base de datos) como `server/auth/session.ts` (Node runtime). Mantener
 * los nombres en un único sitio evita que ambos módulos diverjan.
 */
export const SESSION_COOKIE_NAME = 'gapssa_session'
export const CSRF_COOKIE_NAME = 'gapssa_csrf'
