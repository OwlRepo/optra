import { expect, test } from '@playwright/test'
import { closeDb, latestOtp } from '../support/db'
import { loadState, storageStateFor, type SeedState } from '../support/state'

// Authentication through the real pages and the real BFF. Every other spec
// starts from a session this file's flows produce, so these are the tests that
// explain a red run whose storage specs all failed at once.

// Read in beforeAll, not at import: test files are collected before the setup
// project has run, so the state file may not exist yet at import time.
let state: SeedState
test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

test.describe('signed out', () => {
  test('signs in with a password and lands in the workspace', async ({ page, context }) => {
    await page.goto('/login')
    await page.locator('#email').fill(state.ownerA.email)
    await page.locator('#password').fill(state.ownerA.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(new RegExp(`/workspaces/${state.ownerA.workspaceId}/`))
    const names = (await context.cookies()).map((cookie) => cookie.name)
    expect(names).toEqual(expect.arrayContaining(['mnemra_at', 'mnemra_rt']))
  })

  test('a wrong password shows an error and sets no session', async ({ page, context }) => {
    await page.goto('/login')
    await page.locator('#email').fill(state.ownerA.email)
    await page.locator('#password').fill('not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Filtered by text: Next's route announcer is also role=alert.
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid credentials' })).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    const names = (await context.cookies()).map((cookie) => cookie.name)
    expect(names).not.toContain('mnemra_rt')
  })

  test('an unverified account is refused', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill(state.unverified.email)
    await page.locator('#password').fill(state.unverified.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Filtered by text: Next's route announcer is also role=alert.
    await expect(page.getByRole('alert').filter({ hasText: 'Email not verified' })).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('register, read the emailed code, verify - and a workspace exists', async ({ page }) => {
    const email = `${state.run}-register@e2e.test`
    await page.goto('/register')
    await page.locator('#email').fill(email)
    await page.locator('#password').fill('e2e-Password-1')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/verify-otp\?email=/)
    // EMAIL_OTP_ENABLED=false: the code is logged, not sent, and stored in
    // plaintext - reading it back is what a person does with their inbox.
    await page.locator('#code').fill(await latestOtp(email))
    await page.getByRole('button', { name: 'Verify email' }).click()

    // verifyOtp creates the personal workspace in the same transaction.
    await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}\//)
  })

  test('a protected page without a session redirects to /login', async ({ page }) => {
    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
    await expect(page).toHaveURL(/\/login/)
  })

  test('the BFF refuses a download with no session', async ({ request }) => {
    const response = await request.get(
      `/api/workspaces/${state.ownerA.workspaceId}/procurement/purchase-orders/00000000-0000-4000-8000-000000000000/download`,
    )
    expect(response.status()).toBe(401)
  })
})

test.describe('signed in', () => {
  test.use({ storageState: storageStateFor('ownerA') })

  test('a saved session opens a protected page without signing in again', async ({ page }) => {
    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
    await expect(page).toHaveURL(new RegExp(`/workspaces/${state.ownerA.workspaceId}/procurement`))
    await expect(page.getByRole('heading', { name: 'Uploaded purchase orders' })).toBeVisible()
  })
})
