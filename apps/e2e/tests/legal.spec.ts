import { expect, test } from '@playwright/test'

// Public legal pages, reached the way a visitor does: from the landing footer.
// No session; these routes must be open to signed-out traffic.

test.describe('legal pages', () => {
  test('error: an unknown path under a legal route renders the not-found page', async ({
    page,
  }) => {
    const response = await page.goto('/terms/x')

    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  })

  test('error: legal pages are public and do not bounce a signed-out visitor to /login', async ({
    page,
  }) => {
    for (const path of ['/terms', '/privacy', '/refund']) {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    }
  })

  for (const { label, path, heading } of [
    { label: 'Terms', path: '/terms', heading: /Terms/ },
    { label: 'Privacy', path: '/privacy', heading: /Privacy/ },
    { label: 'Refunds', path: '/refund', heading: /Refund/ },
  ]) {
    test(`happy: footer ${label} link opens ${path} with heading and seller line`, async ({
      page,
    }) => {
      await page.goto('/')
      await page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: label }).click()

      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await expect(page.getByText('© 2026 Romeo Angeles Jr. · Optra · Philippines')).toBeVisible()
    })
  }
})
