import Link from 'next/link'

/**
 * Único not-found sin locale posible en este árbol: cubre el caso en que
 * `[locale]/layout.tsx` llama a `notFound()` porque el segmento de
 * locale no es válido (ej. `/xx`) — ese layout falla antes de renderizar
 * su propio `<html>`, así que `[locale]/not-found.tsx` (que depende de él)
 * nunca llega a usarse ahí. Sin `params.locale` disponible aquí, se queda
 * en español (idioma principal) en vez de adivinar un idioma.
 */
export default function RootNotFound() {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: '4rem 1.5rem' }}>
        <h1>Página no encontrada</h1>
        <p>La página que buscas no existe o ha cambiado de dirección.</p>
        <p>
          <Link href="/es">Volver al inicio</Link>
        </p>
      </body>
    </html>
  )
}
