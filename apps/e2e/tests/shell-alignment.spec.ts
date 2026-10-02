import { expect, test } from '@playwright/test'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { rowFor } from '../support/ui'

// The app shell and the system pages after the landing-alignment redesign
// (design_handoff_app_alignment frames 3.1, 4.1, 4.2, 4.5). Desktop runs at the
// project's Desktop Chrome viewport (>= lg, sidebar); the mobile case sets 390px.

test.use({ storageState: storageStateFor('ownerA') })

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})

test('error: the 404 screen sends "Open workspace" to the workspaces list', async ({ page }) => {
  // A disabled support surface renders the root not-found screen (soft 404).
  await page.goto(`/workspaces/${state.ownerA.workspaceId}/tickets`)
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await expect(page.getByText('404 · not found', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Open workspace' }).click()

  await expect(page).toHaveURL(/\/workspaces$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Your workspaces' })).toBeVisible()
})

test('edge: at 390px the tab bar holds three links plus More, and More opens the 300px drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)

  const tabBar = page.getByRole('navigation', { name: 'Primary' })
  await expect(tabBar.getByRole('link')).toHaveCount(3)
  await expect(tabBar.getByRole('link', { name: 'Purchase Orders' })).toHaveAttribute('aria-current', 'page')

  await tabBar.getByRole('button', { name: 'More' }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigation' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('group', { name: 'Matching', exact: true })).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Catalog Matches', exact: true })).toBeVisible()

  await drawer.getByRole('button', { name: 'Close navigation' }).click()
  await expect(drawer).toHaveCount(0)
})

test('regression: the sidebar groups items under Matching and Workspace and marks the current page', async ({ page }) => {
  await page.goto(`/workspaces/${state.ownerA.workspaceId}/discrepancies`)
  const sidebar = page.locator('aside')

  const matching = sidebar.getByRole('group', { name: 'Matching', exact: true })
  const workspace = sidebar.getByRole('group', { name: 'Workspace', exact: true })
  await expect(matching).toBeVisible()
  await expect(workspace).toBeVisible()
  // toContainText: Overview may also carry the unread pill's count.
  await expect(matching.getByRole('link')).toContainText([
    'Overview',
    'Purchase Orders',
    'Discrepancies',
    'Catalog Matches',
    'Vendors',
  ])
  await expect(workspace.getByRole('link')).toHaveText(['Members', 'Settings'])

  await expect(sidebar.getByRole('link', { name: 'Discrepancies', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(sidebar.getByRole('link', { name: 'Overview', exact: true })).not.toHaveAttribute('aria-current', 'page')
  await expect(sidebar.getByRole('link', { name: /Switch workspace/ })).toHaveAttribute('href', '/workspaces')
})

test('happy: the workspaces page shows the landing hero, one New workspace action, and rows that open Purchase Orders', async ({ page }) => {
  await page.goto('/workspaces')

  await expect(page.getByText('Tenant access', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Your workspaces' })).toBeVisible()
  await expect(page.getByText('Each workspace keeps its own vendors, documents, and member permissions.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New workspace' })).toHaveCount(1)

  await rowFor(page, `E2E A ${state.run}`).getByRole('link', { name: 'Open' }).click()

  await expect(page).toHaveURL(new RegExp(`/workspaces/${state.ownerA.workspaceId}/procurement$`))
})
