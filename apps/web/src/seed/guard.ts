export class SeedProductionGuardError extends Error {}

/**
 * `NODE_ENV=production` es la señal estándar de Node/Next para
 * distinguir el entorno — el seed se niega a ejecutar ahí sin excepción
 * (`PLAN_DESARROLLO_WEB_PORTAL.md` §6: "no se ejecuta automáticamente en
 * producción"). Función pura para poder probarla sin tocar
 * `process.env`.
 */
export function assertSeedAllowedInEnv(
  nodeEnv: string | undefined,
  allowInProduction: boolean = process.env.ALLOW_SEED_IN_PRODUCTION === 'true',
): void {
  if (allowInProduction) {
    return
  }
  if (nodeEnv === 'production') {
    throw new SeedProductionGuardError(
      'El seed de contenido de Fase 2 no puede ejecutarse con NODE_ENV=production sin ALLOW_SEED_IN_PRODUCTION=true.',
    )
  }
}
