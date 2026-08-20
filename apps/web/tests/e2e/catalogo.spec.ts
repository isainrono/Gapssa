import { expect, test } from '@playwright/test'

test.describe('Catálogo', () => {
  test('lista tratamientos agrupados por familia', async ({ page }) => {
    await page.goto('/es/tratamientos')
    await expect(page.getByRole('heading', { name: 'Masajes' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tratamientos faciales' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Masaje relajante', exact: true })).toBeVisible()
  })

  test('el filtro por familia muestra solo esa familia', async ({ page }) => {
    await page.goto('/es/tratamientos')
    await page.getByRole('link', { name: 'Uñas' }).first().click()
    await expect(page).toHaveURL(/familia=unas/)
    await expect(page.getByRole('heading', { name: 'Uñas' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Masajes' })).toHaveCount(0)
  })

  test('nunca muestra un precio numérico inventado', async ({ page }) => {
    await page.goto('/es/tratamientos')
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).toContain('Consultar')
    expect(bodyText).not.toMatch(/\d+[.,]?\d*\s?€/)
  })
})

test.describe('Ficha de tratamiento', () => {
  test('muestra título, familia, beneficios y botón de reserva', async ({ page }) => {
    await page.goto('/es/tratamientos/masaje-relajante')
    await expect(page.getByRole('heading', { name: 'Masaje relajante', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Beneficios' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reservar este tratamiento' })).toHaveAttribute('href', /\/es\/reservar/)
  })

  test('incluye breadcrumbs de navegación', async ({ page }) => {
    await page.goto('/es/tratamientos/masaje-relajante')
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(breadcrumb.getByRole('link', { name: 'Inicio' })).toBeVisible()
    await expect(breadcrumb.getByRole('link', { name: 'Tratamientos' })).toBeVisible()
  })

  test('el mismo tratamiento en inglés usa el mismo slug', async ({ page }) => {
    const response = await page.goto('/en/tratamientos/masaje-relajante')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Relaxing massage', level: 1 })).toBeVisible()
  })
})
