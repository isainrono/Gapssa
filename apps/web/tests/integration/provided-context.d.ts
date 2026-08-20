/** Contexto compartido entre global-setup.ts y los ficheros *.int.test.ts vía inject(). */
declare module 'vitest' {
  export interface ProvidedContext {
    integrationBaseUrl: string
    integrationTestDatabaseName: string
    /** Fase 3: cadena de conexión completa a la base `gapssa_auth_test_<random>` efímera, ya migrada. */
    integrationAuthDatabaseUrl: string
    /** Fase 4A: cadena de conexión completa a la base `gapssa_booking_test_<random>` efímera, ya migrada. */
    integrationBookingDatabaseUrl: string
    /** Fase 3: prefijo de claves Redis exclusivo de esta ejecución — nunca el REDIS_KEY_PREFIX real de desarrollo. */
    integrationRedisKeyPrefix: string
    /** Revisión 2 de Fase 3: puerto HTTP del buzón SMTP efímero (mailbox.ts) — las pruebas consultan el correo entregado ahí, nunca un log de aplicación. */
    integrationMailboxHttpPort: number
    /**
     * Suite de rotación (tests/integration/rotation/), infra Docker
     * DESECHABLE propia (scripts/secrets-rotation/tests/disposable-infra.sh)
     * — nunca `compose.yml`, nunca `.env`. URL de conexión a Redis
     * desechable, con contraseña de un solo uso.
     */
    integrationRotationRedisUrl?: string
  }
}

export {}
