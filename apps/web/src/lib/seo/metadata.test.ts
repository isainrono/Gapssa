import { describe, expect, it } from 'vitest'

import { buildLocalizedMetadata, buildLocalizedUrl } from './metadata'

const SITE_URL = 'https://gapssa.es'

describe('buildLocalizedUrl', () => {
  it('construye la URL de la portada sin barra final extra', () => {
    expect(buildLocalizedUrl(SITE_URL, 'es', '')).toBe('https://gapssa.es/es')
  })

  it('construye la URL de una página interna', () => {
    expect(buildLocalizedUrl(SITE_URL, 'en', 'tratamientos/masaje-relajante')).toBe(
      'https://gapssa.es/en/tratamientos/masaje-relajante',
    )
  })

  it('ignora una barra final en siteUrl', () => {
    expect(buildLocalizedUrl('https://gapssa.es/', 'ca', 'contacto')).toBe('https://gapssa.es/ca/contacto')
  })
})

describe('buildLocalizedMetadata', () => {
  const base = buildLocalizedMetadata(
    { locale: 'es', path: 'tratamientos', title: 'Tratamientos' },
    SITE_URL,
  )

  it('fija el canonical a la URL del locale actual', () => {
    expect(base.alternates?.canonical).toBe('https://gapssa.es/es/tratamientos')
  })

  it('incluye hreflang para los 6 idiomas más x-default', () => {
    const languages = base.alternates?.languages as Record<string, string>
    expect(Object.keys(languages).sort()).toEqual(['ca', 'en', 'es', 'fr', 'it', 'pt', 'x-default'].sort())
    expect(languages.en).toBe('https://gapssa.es/en/tratamientos')
    expect(languages['x-default']).toBe('https://gapssa.es/es/tratamientos')
  })

  it('no fija robots cuando no se pide noIndex', () => {
    expect(base.robots).toBeUndefined()
  })

  it('fija robots noindex,nofollow cuando se pide', () => {
    const noIndexed = buildLocalizedMetadata({ locale: 'es', path: '', title: 'x', noIndex: true }, SITE_URL)
    expect(noIndexed.robots).toBe('noindex, nofollow')
  })

  it('no incluye imagen de Open Graph si no se proporciona', () => {
    expect(base.openGraph?.images).toBeUndefined()
    expect((base.twitter as { card?: string } | undefined)?.card).toBe('summary')
  })

  it('usa summary_large_image cuando hay ogImage', () => {
    const withImage = buildLocalizedMetadata(
      { locale: 'es', path: '', title: 'x', ogImage: 'https://gapssa.es/og.jpg' },
      SITE_URL,
    )
    expect((withImage.twitter as { card?: string } | undefined)?.card).toBe('summary_large_image')
  })
})
