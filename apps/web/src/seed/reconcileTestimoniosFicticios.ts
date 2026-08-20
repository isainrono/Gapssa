import { getPayload } from 'payload'

import { TESTIMONIOS_SEED } from './data/testimonios'

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

/**
 * Revisión 3 de Fase 2: la primera versión del seed creaba los 4
 * testimonios de `TESTIMONIOS_SEED` publicados y visibles (antes de que
 * existiera `requireAutorizacionParaPublicar`,
 * `collections/hooks/testimonioAuthorization.ts`). La revisión 2 corrigió
 * el seed para las siguientes ejecuciones (crea en borrador, no visible,
 * sin autorización) y alguien corrigió a mano los 4 registros ya
 * publicados en la base local — pero cualquier otra base que haya
 * ejecutado la primera versión del seed sigue teniendo esos 4 testimonios
 * ficticios publicados. Esta reconciliación es esa corrección, hecha
 * reproducible.
 *
 * Huella: `autor` + `texto` en español, exactos, contra los 4 textos
 * literales de `TESTIMONIOS_SEED` — no solo el nombre. Un testimonio real
 * que casualmente comparta nombre (p. ej. otra clienta real llamada
 * "María G.") tiene un texto distinto y nunca coincide con la huella
 * completa, así que nunca se toca por error.
 */
const TESTIMONIOS_FICTICIOS_FINGERPRINTS: { autor: string; texto: string }[] = TESTIMONIOS_SEED.map((testimonio) => ({
  autor: testimonio.autorPorLocale.es,
  texto: testimonio.textoPorLocale.es,
}))

export type TestimonioFingerprintCandidate = {
  autor?: string | null
  texto?: string | null
}

/** Decisión pura: ¿este documento es uno de los 4 testimonios ficticios de `TESTIMONIOS_SEED`? */
export function esTestimonioFicticioSembrado(candidate: TestimonioFingerprintCandidate): boolean {
  if (!candidate.autor || !candidate.texto) {
    return false
  }
  return TESTIMONIOS_FICTICIOS_FINGERPRINTS.some(
    (fingerprint) => fingerprint.autor === candidate.autor && fingerprint.texto === candidate.texto,
  )
}

export type TestimonioReconciliationState = {
  visible?: boolean | null
  autorizacionRegistrada?: boolean | null
  _status?: string | null
}

/**
 * Mismo estado seguro que ya usa `seedTestimonios` (`seed/index.ts`) para
 * crear los 4 testimonios de ejemplo: borrador, no visible, sin
 * autorización — nunca alcanzable por la web pública
 * (`lib/content/testimonios.ts`, `TESTIMONIOS_PUBLICOS_WHERE`).
 */
export const TESTIMONIO_FICTICIO_ESTADO_SEGURO = {
  visible: false,
  autorizacionRegistrada: false,
  _status: 'draft',
} as const

/**
 * `null` si el documento YA está en el estado seguro (nada que escribir —
 * así una segunda ejecución de la reconciliación no genera ninguna llamada
 * de actualización, igual que `computeMissingTratamientoLocaleUpdates`
 * para las traducciones). Si no, el `data` a aplicar.
 */
export function computeTestimonioFicticioCorrection(
  state: TestimonioReconciliationState,
): typeof TESTIMONIO_FICTICIO_ESTADO_SEGURO | null {
  const yaEsSeguro = state.visible === false && state.autorizacionRegistrada === false && state._status === 'draft'
  return yaEsSeguro ? null : TESTIMONIO_FICTICIO_ESTADO_SEGURO
}

/**
 * Reconciliación real contra Payload: recorre todos los testimonios (sin
 * fallback de idioma — igual que `seedTratamientos`, para no confundir
 * "autor/texto en español ausente" con contenido real de otro idioma),
 * identifica los que coinciden con la huella de `TESTIMONIOS_SEED` y
 * corrige solo los que no estén ya en el estado seguro. Nunca borra ni
 * toca un testimonio real, autorizado o no: la huella exige coincidencia
 * exacta de autor Y texto.
 */
export async function reconcileTestimoniosFicticios(payload: PayloadClient): Promise<string> {
  const existentes = await payload.find({
    collection: 'testimonios',
    locale: 'es',
    fallbackLocale: false,
    overrideAccess: true,
    limit: 200,
  })

  let detectados = 0
  let corregidos = 0

  for (const doc of existentes.docs) {
    if (!esTestimonioFicticioSembrado(doc)) {
      continue
    }
    detectados += 1

    const correccion = computeTestimonioFicticioCorrection(doc)
    if (!correccion) {
      continue
    }

    await payload.update({
      collection: 'testimonios',
      id: doc.id,
      overrideAccess: true,
      data: correccion,
    })
    corregidos += 1
  }

  return `${detectados} testimonios ficticios detectados, ${corregidos} corregidos a borrador/no visible/sin autorización`
}
