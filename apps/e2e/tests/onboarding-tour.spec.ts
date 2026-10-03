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

const skipButton = (page: Page) => page.getByRole('button', { name: /^Skip/ })
const nextButton = (page: Page) => page.getByRole('button', { name: 'Next', exact: true })
const finishButton = (page: Page) => page.getByRole('button', { name: 'Finish', exact: true })
const runButton = (page: Page) => page.getByRole('button', { name: 'Run comparison' })
const flagButton = (page: Page) => page.getByRole('button', { name: 'Review sample price flag' })
const verifyButton = (page: Page) => page.getByRole('button', { name: 'Verify match' })

/** Walks the tour: Next on explanation steps, a real tap on each interactive one, until Finish. */
async function walkToFinish(page: Page) {
  for (let i = 0; i < 40; i += 1) {
    const actionable = finishButton(page)
      .or(nextButton(page))
      .or(runButton(page))
      .or(flagButton(page))
      .or(verifyButton(page))
    await actionable.first().waitFor({ state: 'visible' })

    if (await finishButton(page).isVisible()) return
    if (await verifyButton(page).isVisible()) await verifyButton(page).click()
    else if (await flagButton(page).isVisible()) await flagButton(page).click()
    else if (await runButton(page).isVisible()) await runButton(page).click()
    else await nextButton(page).click()
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
    await expect(page.getByRole('heading', { level: 1, name: 'Purchase orders', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(skipButton(page)).toHaveCount(0)
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
    for (let i = 0; i < 10 && !(await explanation.first().isVisible()); i += 1) {
      await nextButton(page).click()
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

    await walkToFinish(page)
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
    await expect(page.getByRole('heading', { level: 1, name: 'Purchase orders', exact: true })).toBeVisible()
    await expect(skipButton(page)).toHaveCount(0)

    await page.locator('[data-tour="tour-replay"]').getByText('Take the tour').click()

    await expect(skipButton(page)).toBeVisible()
  })

  test('happy: no non-GET request reaches /api/workspaces/* while the tour and sample stage run', async ({ page }) => {
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/workspaces/')) {
        writes.push(`${request.method()} ${request.url()}`)
      }
    })

    await openFresh(page, state.ownerA.userId, state.ownerA.workspaceId)
    await expect(skipButton(page)).toBeVisible()
    await walkToFinish(page)

    expect(writes).toEqual([])
  })
})
