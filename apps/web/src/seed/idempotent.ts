/**
 * Decisión pura de si el seed debe crear un documento: nunca sobrescribe
 * una edición manual existente sin la opción explícita `force`
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6 — el seed "no pisa cambios
 * editoriales sin una opción explícita"). El propio `src/seed/index.ts`
 * decide qué cuenta como "existente" para cada colección (slug, tipo, o
 * un campo distintivo cuando no hay slug) — esta función no conoce
 * Payload ni Postgres, solo la regla en abstracto.
 */
export function shouldCreateDocument(existing: unknown, force = false): boolean {
  return force || existing === undefined || existing === null
}

/**
 * Igual razonamiento aplicado a un global de Payload: solo se rellena un
 * campo si sigue "vacío" (nunca tocado desde /admin o por un seed
 * anterior). `valorActual` es el valor real leído del global antes de
 * decidir si escribir el valor propuesto por el seed.
 */
export function shouldSeedGlobalField(valorActual: unknown, force = false): boolean {
  if (force) {
    return true
  }
  if (valorActual === undefined || valorActual === null) {
    return true
  }
  if (typeof valorActual === 'string') {
    return valorActual.trim() === ''
  }
  if (Array.isArray(valorActual)) {
    return valorActual.length === 0
  }
  return false
}
