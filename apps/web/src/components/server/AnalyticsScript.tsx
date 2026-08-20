import { publicEnv } from '@/lib/env.public'

/**
 * Umami "preparado, pero apagado" de verdad: si `NEXT_PUBLIC_UMAMI_SRC` o
 * `NEXT_PUBLIC_UMAMI_WEBSITE_ID` faltan (caso por defecto en Fase 2), no
 * se renderiza absolutamente nada — ni un `<script>` deshabilitado, cero
 * peticiones de red. No se activa hasta que exista mecanismo de
 * consentimiento de cookies (`PLAN_DESARROLLO_WEB_PORTAL.md` §11).
 */
export function AnalyticsScript() {
  const { NEXT_PUBLIC_UMAMI_SRC, NEXT_PUBLIC_UMAMI_WEBSITE_ID } = publicEnv
  if (!NEXT_PUBLIC_UMAMI_SRC || !NEXT_PUBLIC_UMAMI_WEBSITE_ID) {
    return null
  }
  return <script defer src={NEXT_PUBLIC_UMAMI_SRC} data-website-id={NEXT_PUBLIC_UMAMI_WEBSITE_ID} />
}
