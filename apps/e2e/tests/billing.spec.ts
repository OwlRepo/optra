import { expect, test, type Browser, type Page } from '@playwright/test'
import { addMember, closeDb, seedWorkspace, setWorkspaceBilling, subscriptionFor } from '../support/db'
import { LS_STUB_PORT } from '../support/env'
import { SOLO_VARIANT, TEAM_VARIANT, postWebhook, signBody, subscriptionEvent } from '../support/lemonsqueezy'
import { loadState, storageStateFor, type SeedState } from '../support/state'

// Billing core (S3): the Billing page, the trial banner and the signed
// Lemon Squeezy webhook through the real BFF. Lemon Squeezy itself is the
// stub on :4011 (stubs/lemonsqueezy-stub.ts). Each case seeds its own
// workspace, owned by billingOwner with billingMember added (never the shared ownerA/memberA, whose workspace lists other specs depend on), so no case depends on another.

const STUB_ORIGIN = `http://127.0.0.1:${LS_STUB_PORT}`

test.use({ storageState: storageStateFor('billingOwner') })

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

async function freshWorkspace(label: string, billing: { trialEndsInDays?: number | null; exempt?: boolean }) {
  const workspaceId = await seedWorkspace(state.billingOwner.userId, `E2E Billing ${label} ${state.run}`)
  await addMember(workspaceId, state.billingMember.userId, 'member')
  await setWorkspaceBilling(workspaceId, billing)
  return workspaceId
}

async function memberPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor('billingMember') })
  return context.newPage()
}

test('error: a webhook with a bad signature through the BFF is 401 and the page stays unchanged', async ({ page, request }) => {
  const workspaceId = await freshWorkspace('badsig', { trialEndsInDays: 5 })
  const body = subscriptionEvent({ workspaceId, subscriptionId: `sub-badsig-${state.run}`, status: 'active', variantId: TEAM_VARIANT, quantity: 3 })

  const response = await postWebhook(request, body, signBody(`${body} `))

  expect(response.status()).toBe(401)
  expect(await subscriptionFor(workspaceId)).toBeNull()
  await page.goto(`/workspaces/${workspaceId}/billing`)
  await expect(page.getByText(/days left/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /manage billing/i })).toHaveCount(0)
})

test('error: a member sees the plan but no Subscribe button', async ({ browser }) => {
  const workspaceId = await freshWorkspace('member', { trialEndsInDays: 5 })
  const page = await memberPage(browser)

  await page.goto(`/workspaces/${workspaceId}/billing`)

  await expect(page.getByText(/days left/i)).toBeVisible()
  await expect(page.getByText('Only the workspace owner can change billing.')).toBeVisible()
  await expect(page.getByRole('button', { name: /subscribe/i })).toHaveCount(0)
  await page.context().close()
})

test('error: an expired trial shows No active plan and still offers Subscribe', async ({ page }) => {
  const workspaceId = await freshWorkspace('expired', { trialEndsInDays: -1 })

  await page.goto(`/workspaces/${workspaceId}/billing`)

  await expect(page.getByText('No active plan')).toBeVisible()
  await expect(page.getByRole('button', { name: /subscribe.*solo/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /subscribe.*team/i })).toBeVisible()
})

test('edge: a trial ending in 2 days shows the banner on a workspace page', async ({ page }) => {
  const workspaceId = await freshWorkspace('banner', { trialEndsInDays: 2 })

  await page.goto(`/workspaces/${workspaceId}/procurement`)

  const banner = page.getByRole('link', { name: /Your free trial ends in 2 days\./ })
  await expect(banner).toBeVisible()
  await expect(banner).toHaveAttribute('href', `/workspaces/${workspaceId}/billing`)
})

test('edge: an exempt workspace shows the exempt note', async ({ page }) => {
  const workspaceId = await freshWorkspace('exempt', { exempt: true, trialEndsInDays: null })

  await page.goto(`/workspaces/${workspaceId}/billing`)

  await expect(page.getByText('This workspace is exempt from billing.')).toBeVisible()
  await expect(page.getByRole('button', { name: /subscribe/i })).toHaveCount(0)
})

test('edge: the Billing link is in the sidebar for a member', async ({ browser }) => {
  const workspaceId = await freshWorkspace('nav', { trialEndsInDays: 5 })
  const page = await memberPage(browser)

  await page.goto(`/workspaces/${workspaceId}/procurement`)

  const link = page.locator('aside').getByRole('link', { name: 'Billing', exact: true })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', `/workspaces/${workspaceId}/billing`)
  await page.context().close()
})

test('regression: a signed event containing a non-ASCII name posted through the real BFF is accepted (bytes untouched)', async ({ request }) => {
  const workspaceId = await freshWorkspace('bytes', { trialEndsInDays: 5 })
  const body = subscriptionEvent({
    workspaceId,
    subscriptionId: `sub-bytes-${state.run}`,
    status: 'active',
    variantId: SOLO_VARIANT,
    userName: 'José Müller 王 \u{1F680}',
  })

  const response = await postWebhook(request, body)

  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ received: true })
  expect((await subscriptionFor(workspaceId))?.status).toBe('active')
})

test('happy: a trial shows its days left and the Solo allowance', async ({ page }) => {
  const workspaceId = await freshWorkspace('trial', { trialEndsInDays: 5 })

  await page.goto(`/workspaces/${workspaceId}/billing`)

  await expect(page.getByText(/\d+ days? left/i)).toBeVisible()
  await expect(page.getByText(/400 matched lines and 100 photo checks/)).toBeVisible()
})

test("happy: Subscribe sends the browser to the stub checkout and the stub saw this workspace's id", async ({ page, request }) => {
  const workspaceId = await freshWorkspace('checkout', { trialEndsInDays: 5 })
  await page.goto(`/workspaces/${workspaceId}/billing`)

  await page.getByRole('button', { name: /subscribe.*solo/i }).click()

  await page.waitForURL(new RegExp(`^${STUB_ORIGIN}/checkout/`))
  await expect(page.getByRole('heading', { name: 'Stub checkout' })).toBeVisible()
  const seen = (await (await request.get(`${STUB_ORIGIN}/__checkouts`)).json()) as any[]
  expect(seen.some((body) => body.data.attributes.checkout_data.custom.workspace_id === workspaceId)).toBe(true)
})

test('happy: a signed subscription_created through the BFF flips the page to Active and Manage billing opens the stub portal', async ({ page, request }) => {
  const workspaceId = await freshWorkspace('active', { trialEndsInDays: 5 })
  const subscriptionId = `sub-active-${state.run}`
  await page.goto(`/workspaces/${workspaceId}/billing`)
  await expect(page.getByText(/days left/i)).toBeVisible()

  const response = await postWebhook(
    request,
    subscriptionEvent({ workspaceId, subscriptionId, status: 'active', variantId: TEAM_VARIANT, quantity: 2 }),
  )
  expect(response.status()).toBe(200)
  await page.reload()

  await expect(page.getByText(/\bactive\b/i).first()).toBeVisible()
  await page.getByRole('button', { name: /manage billing/i }).click()
  await page.waitForURL(new RegExp(`^${STUB_ORIGIN}/billing/${subscriptionId}`))
  await expect(page.getByRole('heading', { name: 'Stub portal' })).toBeVisible()
})
