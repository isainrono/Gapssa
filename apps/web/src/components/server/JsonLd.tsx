type Props = {
  data: Record<string, unknown>
}

/**
 * `<` escapado a `<`: evita que un valor de texto que contenga
 * literalmente `</script>` (ej. un título editorial) cierre la etiqueta
 * antes de tiempo e inyecte HTML/script arbitrario en la página.
 */
export function JsonLd({ data }: Props) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
