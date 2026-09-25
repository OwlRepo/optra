import { expect, test } from '@playwright/test'
import { loadState, type SeedState } from '../support/state'

// Per-visitor rate limiting through the real browser, BFF and API. Each
// context sends its own X-Forwarded-For, standing in for the host Caddy,
// which writes the visitor's address in production. The API runs with
// TRUST_PROXY=1 (support/env.ts). Setup's own logins carry no header and so
// count against 127.0.0.1, a separate bucket.

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})

test('error: a visitor who keeps failing to sign in is stopped, while another visitor signs in', async ({ browser }) => {
  const attacker = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.10' } })
  const attackerPage = await attacker.newPage()
  await attackerPage.goto('/login')
  let lastStatus = 0
  for (let attempt = 0; attempt < 11; attempt++) {
    await attackerPage.locator('#email').fill(state.ownerA.email)
    await attackerPage.locator('#password').fill('not-the-password')
    const response = attackerPage.waitForResponse((r) => r.url().endsWith('/api/auth/login'))
    await attackerPage.getByRole('button', { name: 'Sign in' }).click()
    lastStatus = (await response).status()
  }
  expect(lastStatus).toBe(429)
  await attacker.close()

  const visitor = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.11' } })
  const visitorPage = await visitor.newPage()
  await visitorPage.goto('/login')
  await visitorPage.locator('#email').fill(state.ownerA.email)
  await visitorPage.locator('#password').fill(state.ownerA.password)
  await visitorPage.getByRole('button', { name: 'Sign in' }).click()
  await expect(visitorPage).toHaveURL(new RegExp(`/workspaces/${state.ownerA.workspaceId}/`))
  await visitor.close()
})
