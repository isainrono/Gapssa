import { expect, test } from '@playwright/test'

test.describe('Accesibilidad básica', () => {
  test('el primer Tab activa el enlace "saltar al contenido"', async ({ page }) => {
    await page.goto('/es')
    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: 'Saltar al contenido' })
    await expect(skipLink).toBeFocused()

    await page.keyboard.press('Enter')
    const main = page.locator('#contenido-principal')
    await expect(main).toBeVisible()
  })

  test('la navegación por teclado alcanza los enlaces principales de la cabecera', async ({ page }) => {
    await page.goto('/es')
    // Skip link -> logo -> primer enlace de navegación.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
    expect(focused).toBeTruthy()
  })

  test('los botones interactivos tienen nombre accesible', async ({ page }) => {
    await page.goto('/es')
    await expect(page.getByRole('combobox', { name: 'Seleccionar idioma' })).toBeAttached()
  })

  test('las imágenes decorativas del hero no tienen texto alternativo redundante', async ({ page }) => {
    await page.goto('/es')
    const heroImg = page.locator('img[alt=""]').first()
    await expect(heroImg).toHaveCount(1)
  })

  test('no genera errores graves de consola en el catálogo ni en una ficha', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text())
      }
    })
    await page.goto('/es/tratamientos')
    await page.goto('/es/tratamientos/masaje-relajante')
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })
})

test.describe('Responsive', () => {
  for (const viewport of [
    { name: 'móvil', width: 390, height: 844 },
    { name: 'escritorio', width: 1440, height: 900 },
  ]) {
    test(`sin scroll horizontal en ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/es/tratamientos')
      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasHorizontalScroll).toBe(false)
    })
  }
})
