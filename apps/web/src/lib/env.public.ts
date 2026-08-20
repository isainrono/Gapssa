import { z } from 'zod'

/**
 * Único módulo de entorno que SÍ puede importarse desde componentes
 * cliente: solo variables NEXT_PUBLIC_, que Next.js ya inlinea en el
 * bundle del navegador en build. No lleva `import 'server-only'` a
 * propósito.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
  /**
   * Umami "preparado, pero sin activar" (`PLAN_DESARROLLO_WEB_PORTAL.md`
   * §16, §6.2 de este documento): ambas vacías por defecto — sin ellas,
   * `AnalyticsScript` no emite ningún `<script>`, cero peticiones de red,
   * no solo "desactivado por bandera".
   */
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: z.string().optional(),
  NEXT_PUBLIC_UMAMI_SRC: z.url().optional().or(z.literal('')),
})

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
  NEXT_PUBLIC_UMAMI_SRC: process.env.NEXT_PUBLIC_UMAMI_SRC,
})
