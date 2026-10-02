import { expect, test } from '@playwright/test'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { rowFor, toast } from '../support/ui'

// Storyboard 03, frames 3.3–3.11: the behaviour and copy the workspace screens'
// alignment changed, proven in a real browser against the real stack. Pure
// restyling is the Vitest specs' and the design review's job, not this file's.
//
// Runs as owner A. Nothing here leaves state behind: the digest switch is put
// back, and no member is removed.

test.describe.configure({ mode: 'serial' })
test.use({ storageState: storageStateFor('ownerA') })

let state: SeedState
test.beforeAll(() => {
  state = loadState()
})

// Other specs share workspace A and may already have produced events, so the
// overview check accepts the feed or the empty state, whichever is true.
const EVENT_KEY =
  /^(document_ingested|document_failed|scrape_completed|scrape_failed|ticket_extracted|ticket_failed|comparison_flagged|comparison_failed)$/

test('edge: the overview shows its activity feed or the quiet empty state, and icon-free quick links', async ({ page }) => {
  const ws = state.ownerA.workspaceId
  await page.goto(`/workspaces/${ws}`)

  const header = page.locator('header').filter({ visible: true })
  await expect(header.getByText(`E2E A ${state.run}`, { exact: true })).toBeVisible()
  await expect(header.getByText('Workspace / Overview', { exact: true })).toBeVisible()

  const main = page.getByRole('main')
  for (const [label, path] of [
    ['Members', 'members'],
    ['Settings', 'settings'],
  ] as const) {
    const card = main.getByRole('link').filter({ has: page.getByRole('heading', { level: 3, name: label, exact: true }) })
    await expect(card).toHaveAttribute('href', `/workspaces/${ws}/${path}`)
    await expect(card).toContainText('→')
    await expect(card.locator('svg')).toHaveCount(0)
  }

  await expect(main.getByRole('heading', { level: 2, name: 'Activity', exact: true })).toBeVisible()
  await expect(main.getByText('No activity yet', { exact: true }).or(main.getByText(EVENT_KEY)).first()).toBeVisible()
})

test('regression: the email digest is a switch that flips aria-checked and saves', async ({ page }) => {
  await page.goto(`/workspaces/${state.ownerA.workspaceId}/settings`)

  const digest = page.getByRole('switch', { name: 'Email digest' })
  await expect(digest).toBeVisible()
  const before = await digest.getAttribute('aria-checked')
  expect(before === 'true' || before === 'false', 'aria-checked is a boolean string').toBe(true)
  const after = before === 'true' ? 'false' : 'true'

  await digest.click()
  await expect(toast(page, 'Digest settings updated')).toBeVisible()
  await expect(digest).toHaveAttribute('aria-checked', after)

  // Put it back so the run leaves workspace A's digest as it found it.
  await digest.click()
  await expect(digest).toHaveAttribute('aria-checked', before as string)
})

test('happy: a vendor row opens the detail page, which names both sections and links back to Vendors', async ({ page }) => {
  const ws = state.ownerA.workspaceId
  await page.goto(`/workspaces/${ws}/vendors`)

  const row = rowFor(page, 'E2E Vendor A')
  await expect(row.getByRole('link')).toHaveCount(1)
  await row.getByRole('link', { name: 'E2E Vendor A', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/workspaces/${ws}/vendors/${state.ownerA.vendorId}$`))

  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { level: 2, name: 'What this vendor has charged', exact: true })).toBeVisible()
  await expect(main.getByText('Price history', { exact: true }).first()).toBeVisible()
  await expect(main.getByRole('heading', { level: 2, name: 'What they say they sell', exact: true })).toBeVisible()
  await expect(main.getByText('Catalogs', { exact: true })).toBeVisible()

  await page.locator('header').filter({ visible: true }).getByRole('link', { name: 'Vendors', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/workspaces/${ws}/vendors$`))
  await expect(rowFor(page, 'E2E Vendor A')).toBeVisible()
})

test('happy: members carries the new invite copy and tags your own row "you"', async ({ page }) => {
  await page.goto(`/workspaces/${state.ownerA.workspaceId}/members`)

  await expect(
    page.getByText('Invites go out by email. The link joins them to this workspace as a member.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/Backend still enforces permissions/)).toHaveCount(0)

  const own = rowFor(page, state.ownerA.email)
  await expect(own.getByText('you', { exact: true })).toBeVisible()
  await expect(own.getByRole('button', { name: `Remove ${state.ownerA.email}` })).toHaveCount(0)

  // Visible only: clicking it would remove member A, whom other specs rely on.
  const member = rowFor(page, state.memberA.email)
  await expect(member.getByText('you', { exact: true })).toHaveCount(0)
  await expect(member.getByRole('button', { name: `Remove ${state.memberA.email}` })).toBeVisible()
})
