import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Vite 8 / Vitest 4 resuelven los paths de tsconfig de forma nativa;
  // ya no hace falta el plugin vite-tsconfig-paths (aviso al ejecutar los
  // tests con la versión anterior de esta config).
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
