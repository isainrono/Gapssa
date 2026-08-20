import { z } from 'zod'

/**
 * Validación de entorno específica de Payload — deliberadamente SIN
 * `import 'server-only'`. `payload.config.ts` lo carga no solo desde
 * Next.js: también desde la CLI standalone (`payload migrate`,
 * `payload generate:types`, `payload generate:importmap`) y desde scripts
 * sueltos (`scripts/verify-persistence.ts`, vía `tsx`), ninguno de los
 * cuales pasa por el bundler de Next.js.
 *
 * Verificado en ejecución, no asumido: `node_modules/server-only/index.js`
 * no comprueba nada (ni `typeof window`) — su único contenido es un
 * `throw` incondicional. Bajo Next.js no explota porque el bundler alía
 * `server-only` a un módulo vacío en compilación de servidor, y solo lo
 * deja lanzar cuando algo lo cuela en el bundle de cliente; fuera de ese
 * bundler (CLI de Payload, scripts sueltos, y también Vitest — ver
 * `vitest.setup.ts`) no hay nada que lo neutralice, así que **siempre**
 * revienta. Por eso este módulo, cargado desde la CLI, no puede llevarlo.
 * La validación específica de la app Next (`src/server/env.ts`, con
 * `server-only` de verdad) importa y reutiliza esta.
 *
 * Nunca hace fallback a `''`: si falta o es inválida una variable, falla
 * rápido con un mensaje claro (y sin imprimir el valor real del secreto).
 */
export const payloadEnvSchema = z.object({
  PAYLOAD_SECRET: z.string().min(32, 'PAYLOAD_SECRET debe tener al menos 32 caracteres'),
  DATABASE_URL_CMS: z.url('DATABASE_URL_CMS debe ser una URL de Postgres válida'),
})

export type PayloadEnv = z.infer<typeof payloadEnvSchema>

export class PayloadEnvError extends Error {}

/**
 * Función pura (no toca `process.env`): separada de `getPayloadEnv` para
 * poder probarla con un objeto de entorno de mentira, sin acoplar los
 * tests al proceso global.
 */
export function parsePayloadEnv(source: Record<string, string | undefined>): PayloadEnv {
  const parsed = payloadEnvSchema.safeParse(source)

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n')
    throw new PayloadEnvError(`Variables de entorno de Payload inválidas o ausentes:\n${issues}`)
  }

  return parsed.data
}

let cached: PayloadEnv | null = null

export function getPayloadEnv(): PayloadEnv {
  if (!cached) {
    cached = parsePayloadEnv(process.env)
  }
  return cached
}
