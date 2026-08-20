import 'server-only'

export class TimeoutError extends Error {}

/**
 * Acota cuánto se espera una promesa sin poder cancelar necesariamente la
 * operación subyacente (p. ej. una consulta a Postgres ya en vuelo sigue
 * corriendo en segundo plano) — suficiente para que un health check no se
 * quede colgado indefinidamente si una dependencia deja de responder.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} superó ${ms}ms`)), ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
