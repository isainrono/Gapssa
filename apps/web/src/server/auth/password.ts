import 'server-only'
import { hash, verify } from '@node-rs/argon2'
import { PASSWORD_MIN_LENGTH } from '@gapssa/contracts'

import { serverEnv } from '../env'

/**
 * Hash/verificación de contraseñas con Argon2id (`@node-rs/argon2`, binding
 * nativo — más rápido y sin bloquear el event loop frente a una
 * implementación pura JS). Parámetros configurables vía
 * `ARGON2_MEMORY_COST_KIB`/`ARGON2_TIME_COST`/`ARGON2_PARALLELISM`
 * (`server/env.ts`), con el mínimo recomendado por OWASP como valor por
 * defecto — ver `packages/contracts/src/auth.ts`.
 */

/**
 * `algorithm` se omite a propósito: `@node-rs/argon2` expone `Algorithm`
 * como `const enum` (bindings auto-generados de NAPI-RS), incompatible con
 * `isolatedModules` (activo en este proyecto vía Next.js/SWC) al
 * importarlo desde otro módulo. El propio paquete documenta Argon2id como
 * su valor por defecto cuando se omite — verificado en
 * `node_modules/@node-rs/argon2/index.d.ts` — así que no hace falta
 * pasarlo explícitamente para obtener Argon2id.
 */
export async function hashPassword(plainTextPassword: string): Promise<string> {
  return hash(plainTextPassword, {
    memoryCost: serverEnv.ARGON2_MEMORY_COST_KIB,
    timeCost: serverEnv.ARGON2_TIME_COST,
    parallelism: serverEnv.ARGON2_PARALLELISM,
  })
}

/**
 * `secretHash` puede ser `null` (cuenta sin credencial de contraseña
 * todavía, no debería ocurrir en el flujo normal pero se contempla
 * explícitamente): se sigue ejecutando un hash señuelo con el mismo coste
 * para que el tiempo de respuesta no distinga "cuenta sin contraseña" de
 * "contraseña incorrecta" — misma defensa de sincronización que
 * `verifyPasswordOrDecoy`.
 */
export async function verifyPassword(plainTextPassword: string, secretHash: string): Promise<boolean> {
  try {
    return await verify(secretHash, plainTextPassword)
  } catch {
    // Un secretHash con formato inesperado (corrupto, de otro algoritmo)
    // no debe tirar abajo el login: se trata como "no coincide".
    return false
  }
}

/**
 * Hash señuelo, calculado una sola vez por proceso, con los mismos
 * parámetros de coste que un hash real — usado por `session.ts` cuando la
 * cuenta no existe, para que verificar "cuenta inexistente" tarde
 * aproximadamente lo mismo que verificar "contraseña incorrecta" y no
 * revele por temporización si un correo está registrado
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6.2).
 */
let decoyHashPromise: Promise<string> | null = null

export function getDecoyPasswordHash(): Promise<string> {
  if (!decoyHashPromise) {
    decoyHashPromise = hashPassword('decoy-password-never-used-for-a-real-account')
  }
  return decoyHashPromise
}

export function isPasswordStrongEnough(plainTextPassword: string): boolean {
  if (plainTextPassword.length < PASSWORD_MIN_LENGTH) {
    return false
  }
  const hasLetter = /[a-zA-Z]/.test(plainTextPassword)
  const hasDigit = /[0-9]/.test(plainTextPassword)
  const hasSymbolOrSpace = /[^a-zA-Z0-9]/.test(plainTextPassword)
  return hasLetter && hasDigit && hasSymbolOrSpace
}
