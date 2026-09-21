import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // apps/web es la única capa que habla con EspoCRM/n8n/FacturaScripts.
  // Ningún secreto de servidor debe llevar el prefijo NEXT_PUBLIC_: ver
  // src/server/env.ts.

  // @gapssa/contracts se consume como workspace fuente (TypeScript sin
  // compilar, "main": "./src/index.ts") y Next.js lo transpila él mismo
  // con su propio compilador — el mismo mecanismo con el que ya procesa
  // el código de apps/web. No hay paso de build separado para el paquete
  // ni una carpeta dist/ que mantener sincronizada.
  transpilePackages: ['@gapssa/contracts'],
  // `tests/integration/global-setup.ts` arranca su propio `next dev`
  // contra una base de datos aislada; si compartiera `.next` con un
  // `next dev` de desarrollo en marcha, ambos procesos escribirían el
  // mismo caché de build a la vez. Sin `NEXT_DIST_DIR` (caso normal),
  // `distDir` sigue siendo el valor por defecto de Next (`.next`).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
