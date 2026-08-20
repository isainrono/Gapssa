import { expect, test } from '@playwright/test'

test.describe('Inicio en español', () => {
  test('redirige "/" a "/es" y carga la portada', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/es$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('muestra el nombre comercial y navegación principal', async ({ page }) => {
    await page.goto('/es')
    const header = page.locator('header')
    await expect(header.getByRole('link', { name: 'GAPSSA by Nana' })).toBeVisible()
    await expect(header.getByRole('link', { name: 'Tratamientos', exact: true })).toBeVisible()
    await expect(header.getByRole('link', { name: 'Sobre Gapssa' })).toBeVisible()
    await expect(header.getByRole('link', { name: 'Contacto', exact: true })).toBeVisible()
  })

  test('muestra las familias destacadas con enlace al catálogo', async ({ page }) => {
    await page.goto('/es')
    await expect(page.getByRole('heading', { name: 'Tratamientos y servicios' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ver catálogo completo' })).toBeVisible()
  })

  /**
   * Revisión 2 de Fase 2: los testimonios del seed (`seed/data/testimonios.ts`)
   * son contenido de ejemplo, no reseñas reales, y se siembran como borrador
   * no visible y sin autorización (`seed/index.ts#seedTestimonios`) — nunca
   * deben llegar a la portada. Mientras no exista ningún testimonio real
   * publicado, visible y con `autorizacionRegistrada: true`
   * (`lib/content/testimonios.ts#TESTIMONIOS_PUBLICOS_WHERE`), la sección
   * completa —incluido el título "Experiencias de clientas"— debe quedar
   * oculta (`app/(frontend)/[locale]/page.tsx`, `testimonios.length > 0`).
   */
  test('oculta por completo la sección de testimonios cuando no hay ninguno publicado, visible y autorizado', async ({ page }) => {
    await page.goto('/es')
    await expect(page.getByRole('heading', { name: 'Experiencias de clientas' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Testimonio siguiente' })).toHaveCount(0)
  })

  test('no genera errores graves de consola', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text())
      }
    })
    await page.goto('/es')
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })
})
