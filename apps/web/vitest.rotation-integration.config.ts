import { defineConfig } from 'vitest/config'

/**
 * Suite de integración EXCLUSIVA de rotación de secretos — separada de
 * `vitest.integration.config.ts` (la normal, que depende de
 * `docker compose up -d apps-db redis`, contenedores REALES de GAPSSA).
 * `globalSetup` apunta a `tests/integration/rotation/global-setup.disposable.ts`,
 * que NUNCA importa el global-setup normal — solo depende de la
 * infraestructura Docker DESECHABLE de
 * `scripts/secrets-rotation/tests/disposable-infra.sh`
 * (`GAPSSA_ROTATION_V3_PG_URL`/`GAPSSA_ROTATION_V3_REDIS_URL`, nunca `.env`).
 *
 * `include` solo `tests/integration/rotation/**` — nunca el resto de la
 * suite de integración normal (que necesita Payload/mailbox/next dev real).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/rotation/**/*.int.test.ts'],
    globalSetup: ['./tests/integration/rotation/global-setup.disposable.ts'],
    setupFiles: ['./tests/integration/rotation/setEnv.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
