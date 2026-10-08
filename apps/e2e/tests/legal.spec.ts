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

test.describe('billing copy on the public pages', () => {
  test('error: the pricing section offers no per-line overage', async ({ page }) => {
    await page.goto('/')
    const pricing = page.locator('#pricing')

    await expect(pricing).toBeVisible()
    await expect(pricing).not.toContainText('Extra lines')
    await expect(pricing).not.toContainText('$0.04')
    await expect(pricing).not.toContainText('$0.03')
  })

  test('error: Terms no longer charge an overage rate and Refund no longer mentions overage', async ({
    page,
  }) => {
    await page.goto('/terms')
    await expect(page.getByText('charged at the overage rate')).toHaveCount(0)
    await page.goto('/refund')
    await expect(page.getByText(/overage/i)).toHaveCount(0)
  })

  test('edge: Terms state the first-workspace trial, the caps and the no-card rule', async ({ page }) => {
    await page.goto('/terms')
    const body = page.locator('main')

    await expect(body).toContainText('Your first workspace starts with a 14-day trial.')
    await expect(body).toContainText('The trial needs no payment card')
    await expect(body).toContainText('There is no overage charge.')
    await expect(body).toContainText('contact us to change the plan or the number of buyers')
  })

  test('edge: Privacy lists Lemon Squeezy as a processor', async ({ page }) => {
    await page.goto('/privacy')

    await expect(page.getByRole('rowheader', { name: 'Lemon Squeezy', exact: true })).toBeVisible()
    await expect(page.getByText('as our Merchant of Record')).toBeVisible()
  })

  test('happy: both paid plans state the hard monthly cap on the landing page', async ({ page }) => {
    await page.goto('/')
    const pricing = page.locator('#pricing')

    await expect(pricing).toContainText('Hard monthly cap, no overage charges')
    await expect(pricing).not.toContainText(/upgrade anytime|add buyers anytime/i)
    await expect(pricing).toContainText('Your first workspace starts with a 14-day trial.')
  })
})
