import { expect, test } from '@playwright/test'

test.describe('Selector de idioma', () => {
  test('cambia de idioma preservando la página actual', async ({ page }) => {
    await page.goto('/es/tratamientos')
    await page.getByRole('combobox', { name: 'Seleccionar idioma' }).selectOption('en')
    await expect(page).toHaveURL(/\/en\/tratamientos$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})

test.describe('Menú móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('se abre, gestiona el foco y cierra con el botón', async ({ page }) => {
    await page.goto('/es')
    const trigger = page.getByRole('button', { name: 'Abrir menú' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Tratamientos', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Cerrar menú' }).click()
    await expect(dialog).not.toBeVisible()
    // El foco vuelve al disparador al cerrar (MobileNav.tsx).
    await expect(trigger).toBeFocused()
  })

  test('se cierra con la tecla Escape', async ({ page }) => {
    await page.goto('/es')
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('no produce scroll horizontal', async ({ page }) => {
    await page.goto('/es')
    const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(hasHorizontalScroll).toBe(false)
  })

  // Regresión: el disparador robaba el foco nada más cargar la página
  // (antes de cualquier interacción), porque el efecto que devuelve el
  // foco al cerrar no distinguía "recién cerrado" de "montaje inicial con
  // open=false" (MobileNav.tsx). Con el menú nunca abierto, el disparador
  // no debe estar enfocado al cargar.
  test('el disparador no roba el foco al cargar la página sin interactuar', async ({ page }) => {
    await page.goto('/es')
    const trigger = page.getByRole('button', { name: 'Abrir menú' })
    await expect(trigger).not.toBeFocused()
  })
})

test.describe('404', () => {
  test('un locale inválido devuelve 404', async ({ page }) => {
    const response = await page.goto('/xx')
    expect(response?.status()).toBe(404)
  })

  test('un slug de tratamiento inválido devuelve 404 con cabecera/pie visibles', async ({ page }) => {
    const response = await page.goto('/es/tratamientos/no-existe-este-tratamiento')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('link', { name: 'GAPSSA by Nana' })).toBeVisible()
  })
})

test.describe('CTA de reserva', () => {
  test('el botón "Reservar cita" de la cabecera lleva a /reservar y muestra el formulario real de reserva (Fase 4A)', async ({
    page,
  }) => {
    await page.goto('/es')
    await page.getByRole('link', { name: 'Reservar cita' }).first().click()
    await expect(page).toHaveURL(/\/es\/reservar$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Reservar cita')
    // Desde Fase 4A el motor de reservas es real (server/booking/*, adaptador
    // EspoCRM simulado) — la página ya no es meramente informativa
    // (revisión de Fase 2 obsoleta): muestra el primer paso del asistente
    // (selector de tratamiento y fecha), sin enviar nada hasta que el
    // cliente complete el formulario.
    await expect(page.locator('form')).toHaveCount(1)
    await expect(page.getByLabel('Tratamiento')).toBeVisible()
  })
})
