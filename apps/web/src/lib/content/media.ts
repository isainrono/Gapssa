import type { Media } from '@/payload-types'

type MediaSize = 'card' | 'hero' | 'thumbnail'
export type MediaRef = Media | null | number | undefined

/**
 * Resuelve la URL de una imagen de la colección `media`. Con la
 * profundidad de consulta por defecto de Payload, un campo `upload`
 * devuelve el objeto `Media` completo (no solo el id) — el caso `number`
 * queda cubierto igualmente por si algún día se consulta con `depth: 0`.
 */
export function mediaUrl(media: MediaRef, size?: MediaSize): string | undefined {
  if (!media || typeof media === 'number') {
    return undefined
  }
  if (size) {
    const sized = media.sizes?.[size]?.url
    if (sized) {
      return sized
    }
  }
  return media.url ?? undefined
}

export function mediaAlt(media: MediaRef): string {
  if (!media || typeof media === 'number') {
    return ''
  }
  return media.alt
}
