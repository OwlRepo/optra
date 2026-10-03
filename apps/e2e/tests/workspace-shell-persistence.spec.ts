import { expect, test, type Page } from '@playwright/test'
import { loadState, storageStateFor, type SeedState } from '../support/state'

// The workspace header (name + caller role) loads once in
// app/workspaces/[id]/layout.tsx (WorkspaceProvider). Sidebar clicks remount
// the page, not the layout, so the brand never falls back to "Workspace" and
// GET /api/workspaces/:id is not repeated per click.

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})

const brand = (page: Page) => page.locator('aside a[href="/workspaces"]')

test.describe('as a stranger to workspace A', () => {
  test.use({ storageState: storageStateFor('ownerB') })

  test("error: another workspace's pages still show the no-access state", async ({ page }) => {
    const ws = state.ownerA.workspaceId
    for (const path of [`/workspaces/${ws}`, `/workspaces/${ws}/procurement`, `/workspaces/${ws}/vendors`]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: "You don't have access to this workspace" }), path).toBeVisible()
      await expect(brand(page), path).not.toContainText(`E2E A ${state.run}`)
    }
  })
})

test.describe('as the owner of workspace A', () => {
  test.use({ storageState: storageStateFor('ownerA') })

  test('regression: sidebar navigation keeps the workspace name and fetches the workspace once', async ({ page }) => {
    const ws = state.ownerA.workspaceId
    const name = `E2E A ${state.run}`
    let workspaceReads = 0
    page.on('request', (request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/workspaces/${ws}`) workspaceReads += 1
    })

    await page.goto(`/workspaces/${ws}`)
    await expect(brand(page)).toContainText(name)

    // Record any frame where the brand falls back to the "Workspace" placeholder.
    await page.evaluate(() => {
      const w = window as unknown as { __brandFallback: boolean }
      w.__brandFallback = false
      new MutationObserver(() => {
        const text = document.querySelector('aside a[href="/workspaces"]')?.textContent ?? ''
        if (text.includes('WorkspaceSwitch workspace')) w.__brandFallback = true
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })

    for (const [label, path] of [
      ['Purchase Orders', 'procurement'],
      ['Discrepancies', 'discrepancies'],
      ['Vendors', 'vendors'],
      ['Overview', ''],
    ] as const) {
      await page.locator('aside').getByRole('link', { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/workspaces/${ws}${path ? `/${path}` : ''}$`))
      await expect(brand(page)).toContainText(name)
    }

    expect(await page.evaluate(() => (window as unknown as { __brandFallback: boolean }).__brandFallback)).toBe(false)
    expect(workspaceReads).toBe(1)
  })
})
