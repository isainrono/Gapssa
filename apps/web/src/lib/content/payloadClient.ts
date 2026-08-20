import 'server-only'

import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * Único punto de entrada a la Local API de Payload para las páginas
 * públicas (`apps/web/AGENTS.md`: "las páginas públicas usan la Local API
 * de Payload sin pasar por HTTP"). `getPayload` ya memoiza internamente
 * por identidad de `config`, así que llamarlo en cada helper es barato —
 * este wrapper existe solo para no repetir el import en cada archivo de
 * `src/lib/content/*.ts`.
 */
export async function getPayloadClient() {
  return getPayload({ config })
}
