import { expect, test, type Page } from '@playwright/test'
import { loadState, storageStateFor, type SeedState } from '../support/state'

// The workspace onboarding tour (react-joyride). auth.setup.ts saves every
// session with the tour already marked done; each case clears that record first
// so the tour auto-starts, the way it does for a new user.

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})

const tourKey = (userId: string) => `optra.tour.v1:${userId}`

/** Clears the tour record on the web origin, then opens a workspace page so the tour auto-starts. */
async function openFresh(page: Page, userId: string, workspaceId: string, path = 'procurement') {
  await page.goto('/workspaces')
  await page.evaluate((key) => window.localStorage.removeItem(key), tourKey(userId))
  await page.goto(`/workspaces/${workspaceId}/${path}`)
}

const PROCUREMENT_H1 = 'Purchase orders, invoices & goods receipts'

const tooltip = (page: Page) => page.getByRole('alertdialog')
const skipButton = (page: Page) => tooltip(page).getByRole('button', { name: /^Skip/ })
const nextButton = (page: Page) => tooltip(page).getByRole('button', { name: 'Next', exact: true })
const finishButton = (page: Page) => tooltip(page).getByRole('button', { name: 'Finish', exact: true })
// The tooltip's own action buttons on the three interactive steps.
const ACTION_LABELS = ['Run comparison', 'Open price flag', 'Verify match'] as const
const actionButton = (page: Page, label: (typeof ACTION_LABELS)[number]) => tooltip(page).getByRole('button', { name: label, exact: true })
// The real controls on the sample stage, which the same steps spotlight.
const stageControl = (page: Page, label: (typeof ACTION_LABELS)[number]) =>
  label === 'Open price flag'
    ? page.getByRole('button', { name: 'Review sample price flag' })
    : page.getByRole('region', { name: /sample data/i }).getByRole('button', { name: label, exact: true })

/**
 * Walks the tour from the tooltip: Next on explanation steps; on the three
 * interactive steps either the tooltip's action button (keyboard path) or a real
 * tap on the spotlighted control. Stops when Finish shows.
 */
async function walkToFinish(page: Page, interactive: 'button' | 'control' = 'button') {
  for (let i = 0; i < 40; i += 1) {
    let actionable = finishButton(page).or(nextButton(page))
    for (const label of ACTION_LABELS) actionable = actionable.or(actionButton(page, label))
    await actionable.first().waitFor({ state: 'visible' })

    if (await finishButton(page).isVisible()) return
    let acted = false
    for (const label of ACTION_LABELS) {
      if (await actionButton(page, label).isVisible()) {
        if (interactive === 'button') await actionButton(page, label).click()
        else await stageControl(page, label).click()
        // The step advances when the scripted stage finishes; don't act on it twice.
        await expect(actionButton(page, label)).toBeHidden()
        acted = true
        break
      }
    }
    if (!acted) await nextButton(page).click()
  }
  throw new Error('tour did not reach Finish within 40 actions')
}

async function storedStatus(page: Page, userId: string) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as { status: string }).status : null
  }, tourKey(userId))
}

test.describe('as ownerA', () => {
  test.use({ storageState: storageStateFor('ownerA') })

  test('error: Skip tour ends it, and a reload does not show it again', async ({ page }) => {
    await openFresh(page, state.ownerA.userId, state.ownerA.workspaceId)
    await expect(skipButton(page)).toBeVisible()

    await skipButton(page).click()

    await expect(skipButton(page)).toHaveCount(0)
    expect(await storedStatus(page, state.ownerA.userId)).toBe('skipped')

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: PROCUREMENT_H1, exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(skipButton(page)).toHaveCount(0)
  })

  test('error: Esc ends the tour as skipped instead of advancing it', async ({ page }) => {
    await openFresh(page, state.ownerA.userId, state.ownerA.workspaceId)
    await expect(skipButton(page)).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(skipButton(page)).toHaveCount(0)
    expect(await storedStatus(page, state.ownerA.userId)).toBe('skipped')
  })

  test('edge: at 390px the run reaches Finish using tab-bar and centered steps', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openFresh(page, state.ownerA.userId, state.ownerA.workspaceId)
    await expect(skipButton(page)).toBeVisible()

    await walkToFinish(page)
    await finishButton(page).click()

    await expect(finishButton(page)).toHaveCount(0)
    expect(await storedStatus(page, state.ownerA.userId)).toBe('completed')
  })
})

test.describe('as memberA', () => {
  test.use({ storageState: storageStateFor('memberA') })

  test('edge: a member sees a centered upload explanation with no upload spotlight', async ({ page }) => {
    await openFresh(page, state.memberA.userId, state.memberA.workspaceId)
    await expect(skipButton(page)).toBeVisible()

    const explanation = page.getByText(/owners (and|or) admins/i)
    const heading = tooltip(page).getByRole('heading', { level: 2 })
    for (let i = 0; i < 10 && !(await explanation.first().isVisible()); i += 1) {
      const current = (await heading.textContent()) ?? ''
      await nextButton(page).click()
      // Wait for the next step to render before looking again.
      await heading.filter({ hasNotText: current }).waitFor()
    }

    await expect(explanation.first()).toBeVisible()
    // The control is not rendered for a member, so nothing can be spotlighted.
    await expect(page.locator('[data-tour="procurement-upload"]')).toHaveCount(0)
  })
})

test.describe('as ownerA, happy paths', () => {
  test.use({ storageState: storageStateFor('ownerA') })

  test('happy: a full run with real taps on Run comparison, the price flag and Verify match reaches Finish', async ({ page }) => {
    await openFresh(page, state.ownerA.userId, state.ownerA.workspaceId)
    await expect(skipButton(page)).toBeVisible()

    await walkToFinish(page, 'control')
    await finishButton(page).click()

    await expect(finishButton(page)).toHaveCount(0)
    expect(await storedStatus(page, state.ownerA.userId)).toBe('completed')

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(skipButton(page)).toHaveCount(0)
  })

  test('happy: the "Take the tour" button replays a finished tour', async ({ page }) => {
    // Storage state already holds a completed record: nothing auto-starts.
    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
    await expect(page.getByRole('heading', { level: 1, name: PROCUREMENT_H1, exact: true })).toBeVisible()
    await expect(skipButton(page)).toHaveCount(0)

    await page.locator('[data-tour="tour-replay"]').getByText('Take the tour').click()

    await expect(skipButton(page)).toBeVisible()
  })

  test('happy: no non-GET request reaches /api/workspaces/* while the tour and sample stage run', async ({ page }) => {
    const writes: string[] = []
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      // The Overview page itself marks its activity feed seen when the tour visits it; that is not the tour or the stage.
      if (pathname.endsWith('/events/mark-seen')) return
      if (request.method() !== 'GET' && pathname.startsWith('/api/workspaces/')) {
        writes.push(`${request.method()} ${request.url()}`)
      }
    })

    await openFresh(page, state.ownerA.userId, state.ownerA.workspaceId)
    await expect(skipButton(page)).toBeVisible()
    await walkToFinish(page)

    expect(writes).toEqual([])
  })
})
