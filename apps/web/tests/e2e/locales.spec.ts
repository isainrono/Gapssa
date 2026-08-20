import { expect, test } from '@playwright/test'

/**
 * Smoke test ligero para los 5 idiomas que no son español (que ya tiene su
 * propia suite completa en `home.spec.ts`/`navigation.spec.ts`): la
 * portada carga, `<html lang>` es correcto y no hay errores de consola.
 */
const OTHER_LOCALES: { locale: string; heading: string }[] = [
  { locale: 'ca', heading: 'Cuidem la teva bellesa' },
  { locale: 'en', heading: 'We take care of your beauty' },
  { locale: 'it', heading: 'Ci prendiamo cura della tua bellezza' },
  { locale: 'fr', heading: 'Nous prenons soin de votre beauté' },
  { locale: 'pt', heading: 'Cuidamos da sua beleza' },
]

for (const { locale, heading } of OTHER_LOCALES) {
  test.describe(`Idioma: ${locale}`, () => {
    test(`la portada en "${locale}" carga con el lang correcto`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(message.text())
        }
      })

      const response = await page.goto(`/${locale}`)
      expect(response?.status()).toBe(200)
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading)

      await page.waitForLoadState('networkidle')
      expect(errors).toEqual([])
    })
  })
}
