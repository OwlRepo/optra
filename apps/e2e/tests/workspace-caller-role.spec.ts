import { expect, test, type Browser, type Page } from '@playwright/test'
import { addMember, backdateWorkspace, closeDb, seedUser, seedWorkspace } from '../support/db'
import { loadState, type SeedState } from '../support/state'

// The caller's role comes from GET /workspaces/:id, not from page 1 of the
// paginated /workspaces list (20 newest). Someone in 21 workspaces opening the
// oldest must still get exactly the controls their role allows.

const PASSWORD = 'e2e-Password-1'
const NEWER_WORKSPACES = 20

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

async function crowdedUser(label: string, role: 'owner' | 'admin' | 'member') {
  const email = `${state.run}-${label}@e2e.test`
  const userId = await seedUser({ email, password: PASSWORD })
  const ownerId = role === 'owner' ? userId : await seedUser({ email: `${state.run}-${label}-owner@e2e.test`, password: PASSWORD })
  const workspaceId = await seedWorkspace(ownerId, `Oldest ${label}`)
  if (role !== 'owner') await addMember(workspaceId, userId, role)
  await backdateWorkspace(workspaceId)
  for (let i = 0; i < NEWER_WORKSPACES; i++) await seedWorkspace(userId, `Newer ${label} ${i}`)
  return { email, userId, workspaceId }
}

async function signIn(browser: Browser, user: { email: string; userId: string }, address: string): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': address } })
  // Tour marked done so its overlay does not cover the controls under test.
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [`optra.tour.v1:${user.userId}`, JSON.stringify({ status: 'completed', at: new Date().toISOString() })] as const,
  )
  const page = await context.newPage()
  await page.goto('/login')
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/workspaces\/[^/]+\//)
  return page
}

test('error: a member of the oldest of 21 workspaces gets the Member badge and no Add vendor', async ({ browser }) => {
  const user = await crowdedUser('role-member', 'member')
  const page = await signIn(browser, user, '203.0.113.50')
  await page.goto(`/workspaces/${user.workspaceId}/vendors`)
  await expect(page.getByText('Member', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add vendor' })).toHaveCount(0)
  await page.context().close()
})

test('regression: an owner of the oldest of 21 workspaces gets the Owner badge and Add vendor', async ({ browser }) => {
  const user = await crowdedUser('role-owner', 'owner')
  const page = await signIn(browser, user, '203.0.113.51')
  await page.goto(`/workspaces/${user.workspaceId}/vendors`)
  await expect(page.getByText('Owner', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add vendor' }).first()).toBeVisible()
  await page.context().close()
})

test('regression: an admin of the oldest of 21 workspaces gets the Admin badge and Add vendor', async ({ browser }) => {
  const user = await crowdedUser('role-admin', 'admin')
  const page = await signIn(browser, user, '203.0.113.52')
  await page.goto(`/workspaces/${user.workspaceId}/vendors`)
  await expect(page.getByText('Admin', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add vendor' }).first()).toBeVisible()
  await page.context().close()
})
