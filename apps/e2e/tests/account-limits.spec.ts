import { expect, test } from '@playwright/test'
import { closeDb, latestOtp, seedUser } from '../support/db'
import { loadState, type SeedState } from '../support/state'

// Per-account limits through the real browser, BFF and API. Each context
// sends its own X-Forwarded-For (standing in for the host Caddy), so the
// per-address limits are not what stops these visitors - the per-account
// ones are.

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

test('error: an account with 20 failed sign-ins is refused, even with the right password from a new address', async ({ browser }) => {
  const email = `${state.run}-locked@e2e.test`
  await seedUser({ email, password: 'e2e-Password-1' })

  for (const address of ['203.0.113.30', '203.0.113.31']) {
    const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': address } })
    const page = await context.newPage()
    await page.goto('/login')
    for (let attempt = 0; attempt < 10; attempt++) {
      await page.locator('#email').fill(email)
      await page.locator('#password').fill('not-the-password')
      const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'))
      await page.getByRole('button', { name: 'Sign in' }).click()
      expect((await response).status()).toBe(401)
    }
    await context.close()
  }

  const owner = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.32' } })
  const page = await owner.newPage()
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill('e2e-Password-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Too many sign-in attempts for this account. Try again later.' }),
  ).toBeVisible()
  await owner.close()
})

test('happy: five wrong codes burn the code, and "Send a new code" gets a working one', async ({ browser }) => {
  const email = `${state.run}-burn@e2e.test`

  const first = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.40' } })
  const page = await first.newPage()
  await page.goto('/register')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill('e2e-Password-1')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/verify-otp\?email=/)

  const real = await latestOtp(email)
  const wrong = real === '111111' ? '222222' : '111111'
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.locator('#code').fill(wrong)
    await page.getByRole('button', { name: 'Verify email' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid or expired code' })).toBeVisible()
  }
  await page.locator('#code').fill(wrong)
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Too many wrong codes. Request a new code.' })).toBeVisible()

  await page.getByRole('button', { name: 'Send a new code' }).click()
  await expect(page.getByText('If that account is waiting for verification, a new code is on its way.')).toBeVisible()
  const url = page.url()
  await first.close()

  // This address has used its five verify attempts; carry on from another.
  const second = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.41' } })
  const next = await second.newPage()
  await next.goto(url)
  await next.locator('#code').fill(await latestOtp(email))
  await next.getByRole('button', { name: 'Verify email' }).click()
  await expect(next).toHaveURL(/\/workspaces\/[0-9a-f-]{36}\//)
  await second.close()
})
