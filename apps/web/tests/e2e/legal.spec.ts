import { expect, test } from '@playwright/test'

const PAGINAS_LEGALES = [
  { path: '/es/legal/aviso-legal', titulo: 'Aviso legal' },
  { path: '/es/legal/privacidad', titulo: 'Política de privacidad' },
  { path: '/es/legal/cookies', titulo: 'Política de cookies' },
  { path: '/es/legal/condiciones-reserva', titulo: 'Condiciones de reserva' },
]

test.describe('Páginas legales', () => {
  for (const pagina of PAGINAS_LEGALES) {
    test(`${pagina.path} carga y avisa de su estado provisional`, async ({ page }) => {
      const response = await page.goto(pagina.path)
      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(pagina.titulo)
      await expect(page.getByText('Texto provisional, pendiente de revisión legal definitiva')).toBeVisible()
    })

    test(`${pagina.path} no es indexable (contenido provisional)`, async ({ page }) => {
      await page.goto(pagina.path)
      const robots = page.locator('meta[name="robots"]')
      await expect(robots).toHaveAttribute('content', /noindex/)
    })
  }
})

test.describe('Mi cuenta', () => {
  test('carga y nunca es indexable', async ({ page }) => {
    const response = await page.goto('/es/mi-cuenta')
    expect(response?.status()).toBe(200)
    const robots = page.locator('meta[name="robots"]')
    await expect(robots).toHaveAttribute('content', /noindex/)
  })
})

test.describe('SEO técnico', () => {
  test('sitemap.xml responde con URLs de los 6 idiomas', async ({ page }) => {
    const response = await page.goto('/sitemap.xml')
    expect(response?.status()).toBe(200)
    const body = await response?.text()
    for (const locale of ['es', 'ca', 'en', 'it', 'fr', 'pt']) {
      expect(body).toContain(`/${locale}`)
    }
    expect(body).not.toContain('/mi-cuenta')
  })

  test('robots.txt referencia el sitemap y bloquea rutas privadas', async ({ page }) => {
    const response = await page.goto('/robots.txt')
    expect(response?.status()).toBe(200)
    const body = await response?.text()
    expect(body).toContain('Sitemap:')
    expect(body).toContain('mi-cuenta')
  })

  test('la portada tiene hreflang para los 6 idiomas', async ({ page }) => {
    await page.goto('/es')
    const hreflangLinks = await page.locator('link[rel="alternate"][hreflang]').all()
    const hreflangs = await Promise.all(hreflangLinks.map((link) => link.getAttribute('hreflang')))
    for (const locale of ['es', 'ca', 'en', 'it', 'fr', 'pt', 'x-default']) {
      expect(hreflangs).toContain(locale)
    }
  })
})
