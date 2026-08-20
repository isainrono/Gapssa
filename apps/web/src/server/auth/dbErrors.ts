import 'server-only'

/**
 * `23505` es el código SQLSTATE estándar de Postgres para
 * `unique_violation` (https://www.postgresql.org/docs/current/errcodes-appendix.html)
 * — no específico de `pg`/Drizzle. Se usa para tratar una carrera de
 * inserción concurrente (dos registros con el mismo correo a la vez) como
 * el mismo caso que "ya existe", en vez de un error 500 genérico.
 *
 * Revisión 2 de Fase 3: descubierto por la propia prueba de concurrencia
 * (`auth.registerVerifyLogin.int.test.ts`, "concurrent duplicate
 * registrations") al mover la creación de cuenta+credencial a una
 * transacción (`createAccountWithPasswordCredential`) — dentro de
 * `authDb.transaction(...)`, drizzle-orm envuelve el error de Postgres en
 * su propio `DrizzleQueryError` ("Failed query: ...") y mueve el error
 * original (con `.code`) a `error.cause`, en vez de exponer `.code`
 * directamente en el objeto de nivel superior como sí hacía (al menos en
 * la versión de drizzle-orm de este proyecto) una llamada suelta sin
 * transacción. Comprobar también `error.cause` hace la detección robusta
 * a ambas formas, sin depender de si la sentencia que falla está dentro de
 * una transacción.
 */
function hasUniqueViolationCode(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === '23505'
}

export function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true
  }
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return hasUniqueViolationCode((error as { cause: unknown }).cause)
  }
  return false
}
