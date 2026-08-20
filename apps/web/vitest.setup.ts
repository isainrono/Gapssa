import { vi } from 'vitest'

import { installSyntheticServerEnv } from './src/test/syntheticServerEnv'

// La suite unitaria nunca carga el `.env` real del monorepo — instala un
// entorno sintético y cerrado ANTES de que Vitest importe cualquier
// fichero de test (orden garantizado por `setupFiles`), para que
// `src/server/env.ts` (valida el esquema completo en tiempo de import)
// nunca dependa de lo que haya en el `.env` de quien ejecuta la suite.
// Ver src/test/syntheticServerEnv.ts y su test dedicado, que comprueba
// además que este fichero no referencia ningún `.env` real.
installSyntheticServerEnv()

// `server-only` (node_modules/server-only/index.js) no tiene una
// comprobación de entorno: su único contenido es un `throw` incondicional.
// Fuera del bundler de Next.js (que en compilación de servidor lo alía a
// un módulo vacío, y solo lo deja "explotar" cuando algo lo cuela en el
// bundle de cliente) no hay nada que lo neutralice — ni siquiera
// ejecutarlo bajo el entorno "node" de Vitest evita el throw, porque no
// depende de `window`. Verificado en ejecución, no asumido. Se sustituye
// aquí por un módulo vacío para todos los tests: Vitest no reproduce la
// separación servidor/cliente de Next, así que la comprobación real de
// "esto no se cuela en un componente cliente" la sigue haciendo el build
// de Next (`npm run build`), no los tests unitarios.
vi.mock('server-only', () => ({}))
