import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  addMember,
  closeDb,
  seedParsedPair,
  seedUsageEvents,
  seedVendor,
  seedWorkspace,
  setWorkspaceBilling,
  subscriptionFor,
  usageSummaryFor,
} from '../support/db'
import { batchRow, fillBatchRow, openBatchDialog, submitBatch } from '../support/flows'
import { chooseFiles, fixture } from '../support/ui'
import type { Owner } from '../support/state'
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

// Billing metering (S4). The API process runs BILLING_ENFORCEMENT=off for the
// whole suite, so the 402 UI is driven by answering the BFF call with the
// contract body (page.route); the gate itself is proven in the API e2e specs.
// The chat page is a soft 404 while the support surfaces are off, so the
// AI-allowance notice is driven from the PO upload dialog instead.

const QUOTA_STOP = {
  statusCode: 402,
  code: 'QUOTA_EXCEEDED',
  quota: 'matchedLines',
  message: "Your plan's matched-line allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
}
const AI_STOP = {
  statusCode: 402,
  code: 'AI_BUDGET_EXCEEDED',
  message: "Your plan's AI allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
}

async function stubStop(page: Page, urlPattern: string, body: typeof QUOTA_STOP | typeof AI_STOP) {
  await page.route(urlPattern, (route) =>
    route.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

async function triggerCompareStop(page: Page, workspaceId: string, label: string) {
  const names = { purchaseOrder: `s4-po-${label}-${state.run}.csv`, invoice: `s4-invoice-${label}-${state.run}.csv` }
  await seedParsedPair(workspaceId, names)
  await stubStop(page, '**/api/workspaces/*/procurement/discrepancies/compare', QUOTA_STOP)
  await page.goto(`/workspaces/${workspaceId}/procurement`)
  await page.locator('select[aria-label="Purchase order"]').selectOption({ label: names.purchaseOrder })
  await page.locator('select[aria-label="Invoice"]').selectOption({ label: names.invoice })
  await page.getByRole('button', { name: 'Run comparison' }).click()
}

const notice = (page: Page) => page.getByRole('alert', { name: 'Billing notice' })

test('error: a 402 QUOTA_EXCEEDED answer on Compare shows the billing notice with a link to Billing', async ({ page }) => {
  const workspaceId = await freshWorkspace('stop-compare', { trialEndsInDays: 5 })

  await triggerCompareStop(page, workspaceId, 'compare')

  await expect(notice(page)).toBeVisible()
  await expect(notice(page)).toContainText('matched-line allowance')
  await expect(notice(page).getByRole('link', { name: /view billing/i })).toHaveAttribute('href', `/workspaces/${workspaceId}/billing`)
})

test('error: a 402 AI_BUDGET_EXCEEDED answer on an upload shows the billing notice', async ({ page }) => {
  const workspaceId = await freshWorkspace('stop-ai', { trialEndsInDays: 5 })
  const vendorId = await seedVendor(workspaceId, `S4 Vendor ${state.run}`)
  await stubStop(page, '**/api/workspaces/*/procurement/purchase-orders', AI_STOP)

  await openBatchDialog(page, { workspaceId } as Owner, 'purchase-orders')
  const file = fixture('po.csv', `s4-ai-${state.run}.csv`)
  await chooseFiles(page, 'Add files', [file])
  const row = batchRow(page, file.name)
  await fillBatchRow(row, 'purchase-orders', vendorId, `PO-S4-AI-${state.run}`)
  await submitBatch(page)

  await expect(notice(page)).toBeVisible()
  await expect(notice(page)).toContainText('AI allowance')
})

test("edge: seeded usage rows show 'N of M' meters and the AI percentage on the Billing page", async ({ page }) => {
  const workspaceId = await freshWorkspace('meters', { trialEndsInDays: 5 })
  await seedUsageEvents(workspaceId, [
    { kind: 'matched_line', quantity: 120 },
    { kind: 'photo_check', quantity: 12 },
    { kind: 'llm_cost', quantity: 1_500_000 },
  ])
  expect(await usageSummaryFor(workspaceId)).toEqual([
    { kind: 'llm_cost', quantity: '1500000' },
    { kind: 'matched_line', quantity: '120' },
    { kind: 'photo_check', quantity: '12' },
  ])

  await page.goto(`/workspaces/${workspaceId}/billing`)

  await expect(page.getByText('120 of 400')).toBeVisible()
  await expect(page.getByText('12 of 100')).toBeVisible()
  await expect(page.getByText('37% used')).toBeVisible()
  await expect(page.getByRole('meter', { name: 'Matched lines' })).toHaveAttribute('aria-valuenow', '120')
  await expect(page.getByRole('meter', { name: 'AI allowance' })).toHaveAttribute('aria-valuenow', '37')
})

test('edge: an exempt workspace shows no meters', async ({ page }) => {
  const workspaceId = await freshWorkspace('exempt-meters', { exempt: true, trialEndsInDays: null })
  await seedUsageEvents(workspaceId, [{ kind: 'matched_line', quantity: 50 }])

  await page.goto(`/workspaces/${workspaceId}/billing`)

  await expect(page.getByText('This workspace is exempt from billing.')).toBeVisible()
  await expect(page.getByRole('meter')).toHaveCount(0)
})

test('edge: dismissing the notice hides it', async ({ page }) => {
  const workspaceId = await freshWorkspace('dismiss', { trialEndsInDays: 5 })
  await triggerCompareStop(page, workspaceId, 'dismiss')
  await expect(notice(page)).toBeVisible()

  await page.getByRole('button', { name: 'Dismiss billing notice' }).click()

  await expect(notice(page)).toHaveCount(0)
})

test("happy: the notice's link opens the Billing page", async ({ page }) => {
  const workspaceId = await freshWorkspace('link', { trialEndsInDays: 5 })
  await triggerCompareStop(page, workspaceId, 'link')

  await notice(page).getByRole('link', { name: /view billing/i }).click()

  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/billing$`))
  await expect(page.getByText(/days left/i)).toBeVisible()
})
