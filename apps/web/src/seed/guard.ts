export class SeedProductionGuardError extends Error {}

/**
 * `NODE_ENV=production` es la señal estándar de Node/Next para
 * distinguir el entorno — el seed se niega a ejecutar ahí sin excepción
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6: "no se ejecuta automáticamente en
 * producción"). Función pura para poder probarla sin tocar
 * `process.env`.
 */
export function assertSeedAllowedInEnv(nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') {
    throw new SeedProductionGuardError(
      'El seed de contenido de Fase 2 no puede ejecutarse con NODE_ENV=production.',
    )
  }
}
