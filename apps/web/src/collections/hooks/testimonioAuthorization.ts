import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'

/**
 * Revisión 2 de Fase 2: hasta ahora nada impedía publicar o marcar visible
 * un testimonio sin `autorizacionRegistrada: true` — la única barrera era
 * acordarse de no hacerlo. `PROJECT_CONTEXT.md` §7.3 exige permisos
 * separados para uso promocional; un testimonio es justamente eso.
 *
 * Puro en la decisión (`wouldPublishWithoutAuthorization`, sin tocar
 * Payload): fusiona `data` (puede ser parcial en un `update`, ver
 * `protectAdminRole.ts` para el mismo patrón) con `originalDoc` para saber
 * el estado resultante real, no solo lo que trae esta petición — así un
 * PATCH que solo cambia `orden` y no toca `visible`/`_status` no dispara el
 * hook por error, pero un PATCH que intenta poner `visible: true` sobre un
 * documento sin autorización sí lo hace.
 */
export function wouldPublishWithoutAuthorization(
  data: { visible?: unknown; _status?: unknown; autorizacionRegistrada?: unknown },
  originalDoc: { visible?: unknown; _status?: unknown; autorizacionRegistrada?: unknown } | undefined,
): boolean {
  const seraVisible = (data.visible ?? originalDoc?.visible) === true
  const seraPublicado = (data._status ?? originalDoc?._status) === 'published'
  const tieneAutorizacion = (data.autorizacionRegistrada ?? originalDoc?.autorizacionRegistrada) === true

  return (seraVisible || seraPublicado) && !tieneAutorizacion
}

export const requireAutorizacionParaPublicar: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if (wouldPublishWithoutAuthorization(data, originalDoc)) {
    throw new APIError(
      'No se puede publicar ni hacer visible un testimonio sin autorizacionRegistrada = true.',
      400,
      undefined,
      true,
    )
  }
  return data
}
