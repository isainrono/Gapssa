import { defineConfig } from 'vitest/config'

/**
 * Suite separada de `vitest.config.ts` (unitarias, `npm run test`): esta
 * arranca un servidor Next/Payload real contra Postgres/Redis reales (ver
 * `tests/integration/global-setup.ts`), así que necesita `environment:
 * 'node'` (no `jsdom`), sin paralelismo entre ficheros (todos comparten el
 * mismo servidor y la misma base de datos aislada) y timeouts mucho más
 * altos que una prueba unitaria en memoria.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.int.test.ts'],
    globalSetup: ['./tests/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
