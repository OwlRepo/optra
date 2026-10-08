import { expect, test } from '@playwright/test'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { rowFor } from '../support/ui'

// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets
// and Insights are hidden from the workspace shell and their pages answer 404;
// users land on Purchase Orders. On re-enable, invert these assertions (or delete this file) along
// with the [support-surfaces-off] lines in apps/web.

const HIDDEN = ['Knowledge Bases', 'Datasets', 'Chat', 'Tickets', 'Insights']
const KEPT = ['Overview', 'Members', 'Settings', 'Vendors', 'Purchase Orders', 'Discrepancies', 'Catalog Matches', 'Billing']

test.use({ storageState: storageStateFor('ownerA') })

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})

// notFound() in each route's layout renders the root not-found screen. The
// HTTP status stays 200 because the root loading.tsx has already started the
// stream (a soft 404); the hidden page itself never mounts.
test('error: every disabled support-surface page shows the not-found screen', async ({ page }) => {
  const ws = state.ownerA.workspaceId
  for (const path of [
    `/workspaces/${ws}/knowledge-bases`,
    `/workspaces/${ws}/knowledge-bases/${state.ownerA.knowledgeBaseId}`,
    `/workspaces/${ws}/datasets`,
    `/workspaces/${ws}/chat`,
    `/workspaces/${ws}/tickets`,
    `/workspaces/${ws}/insights`,
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Page not found' }), path).toBeVisible()
  }
})

test('edge: the /chat landing hub forwards into Purchase Orders, not chat', async ({ page }) => {
  await page.goto('/chat')
  await expect(page).toHaveURL(new RegExp(`/workspaces/${state.ownerA.workspaceId}/procurement$`))
})

test('regression: the sidebar shows none of the hidden areas and no search box', async ({ page }) => {
  await page.goto(`/workspaces/${state.ownerA.workspaceId}`)
  const sidebar = page.locator('aside')
  for (const label of KEPT) {
    await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible()
  }
  for (const label of HIDDEN) {
    await expect(sidebar.getByRole('link', { name: label, exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 3, name: label, exact: true })).toHaveCount(0)
  }
  await expect(page.getByTestId('workspace-search-slot')).toHaveCount(0)
})

test('happy: the workspaces list opens a workspace into Purchase Orders', async ({ page }) => {
  await page.goto('/workspaces')
  await expect(rowFor(page, `E2E A ${state.run}`).getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    `/workspaces/${state.ownerA.workspaceId}/procurement`,
  )
})

test('happy: the mobile tab bar offers Overview, Purchase Orders and Discrepancies', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveText([
    'Overview',
    'Purchase Orders',
    'Discrepancies',
  ])
})
