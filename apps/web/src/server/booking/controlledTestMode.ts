import 'server-only'

import { serverEnv } from '../env'

/**
 * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas, NUNCA una
 * función productiva. Único punto que decide si el `Meeting` que está a
 * punto de crearse debe nacer con `cExcluirGoogleCalendarSync=true`
 * (Puerta 6, `docs/fase4b-puerta6-exclusion-gcs.md`) — decide
 * EXCLUSIVAMENTE a partir de `serverEnv` (`ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS`,
 * ya validado al arrancar el proceso: `env.ts`, `superRefine` — nunca
 * `true` en producción, nunca con el adaptador simulado, nunca sin un
 * identificador de ejecución bien formado), jamás de una entrada de red
 * (query params, cookies, formularios, Payload CMS, perfil del cliente ni
 * ningún otro dato controlable por el navegador).
 *
 * `guestFlow.ts`/`authenticatedFlow.ts` nunca llaman a esta función
 * directamente — ambos delegan la creación del Meeting en
 * `completeBookingToMeeting` (`verificationSteps.ts`), que es el ÚNICO
 * llamante real, garantizando que invitado y cliente autenticado comparten
 * exactamente la misma decisión (encargo Fase 4A, punto 7: "no duplicar
 * lógica de negocio entre invitado y cliente autenticado").
 */
export function resolveControlledTestGcsExclusion(): true | undefined {
  return serverEnv.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS ? true : undefined
}
