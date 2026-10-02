import { expect, test, type Page } from '@playwright/test'
import { closeDb } from '../support/db'
import { uploadPurchaseOrder } from '../support/flows'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { bff, chooseFile, fixture, toast, waitForRow } from '../support/ui'

// The matching screens' aligned behaviour (frames 2.1, 2.7, 2.9, 2.11), driven
// the way an owner does it. Serial: one PO + one mismatched invoice are set up
// once, and every test reads the pair they make. The invoice bills A1 at 6.00
// against a 5.00 PO price, so the pair has exactly one flag, on A1.

test.describe.configure({ mode: 'serial' })
test.use({ storageState: storageStateFor('ownerA') })

let state: SeedState
let purchaseOrderId: string
let invoiceId: string

// `flows.uploadPurchaseOrder` sets the PO number to the upper-cased file stem.
const poFileName = () => `align-po-${state.run}.csv`
const poNumber = () => poFileName().replace(/\.csv$/, '').toUpperCase()
const invoiceNumber = () => `INV-ALIGN-${state.run}`

const procurementPage = () => `/workspaces/${state.ownerA.workspaceId}/procurement`
const pairDiscrepanciesPage = () =>
  `/workspaces/${state.ownerA.workspaceId}/discrepancies?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}`

async function uploadMismatchedInvoice(page: Page, fileName: string): Promise<string> {
  const file = fixture('invoice-mismatch.csv', fileName)
  await page.goto(procurementPage())
  await page.getByRole('tab', { name: 'Invoices' }).click()
  await chooseFile(page, 'Upload invoice', file)

  const dialog = page.getByRole('dialog')
  await dialog.locator('#invoice-po').selectOption(purchaseOrderId)
  await dialog.locator('#invoice-number').fill(invoiceNumber())
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Invoice uploaded')).toBeVisible()

  const row = await waitForRow<{ id: string; name: string; status: string }>(
    page,
    `/api/workspaces/${state.ownerA.workspaceId}/procurement/invoices`,
    (candidate) => candidate.name === file.name,
    'done',
  )
  return row.id
}

test.beforeAll(async ({ browser }) => {
  // Two uploads, each waiting on its parser.
  test.setTimeout(120_000)
  state = loadState()
  const context = await browser.newContext({ storageState: storageStateFor('ownerA') })
  const page = await context.newPage()
  purchaseOrderId = await uploadPurchaseOrder(page, state.ownerA, poFileName())
  invoiceId = await uploadMismatchedInvoice(page, `align-invoice-${state.run}.csv`)
  await context.close()
})
test.afterAll(closeDb)

test('happy: the Purchase Orders tab carries the count of the list it holds', async ({ page }) => {
  await page.goto(procurementPage())

  // Other specs upload into the same workspace concurrently, so the exact
  // number is not stable; at least the one uploaded above is.
  await expect(page.getByRole('tab', { name: /Purchase Orders/ })).toHaveText(/Purchase Orders\s*[1-9]\d*/)
})

test('happy: Run comparison lands on Discrepancies scoped to the pair, and × clears the scope', async ({ page }) => {
  await page.goto(procurementPage())
  await page.getByRole('combobox', { name: 'Purchase order', exact: true }).selectOption(purchaseOrderId)
  await page.getByRole('combobox', { name: 'Invoice', exact: true }).selectOption(invoiceId)
  await page.getByRole('button', { name: 'Run comparison' }).click()

  await expect(page).toHaveURL(new RegExp(`/discrepancies\\?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}$`))
  // C-3 #1: the chip names the pair by the numbers given at upload.
  await expect(page.getByText(`${poNumber()} ↔ ${invoiceNumber()}`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review discrepancy A1' })).toBeVisible()

  await page.getByRole('button', { name: 'Clear pair filter' }).click()

  await expect(page).not.toHaveURL(/purchaseOrderId=/)
  await expect(page.getByRole('button', { name: 'Clear pair filter' })).toHaveCount(0)
})

test('edge: a positive delta reads with a plus sign, as the frames write it', async ({ page }) => {
  await page.goto(pairDiscrepanciesPage())
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Review discrepancy A1' }) })
  await expect(row.getByText(/^\+1(\.0+)?$/)).toBeVisible()
})

test('happy: the status segmented control refetches Dismissed, then All', async ({ page }) => {
  await page.goto(pairDiscrepanciesPage())
  await expect(page.getByRole('button', { name: 'Review discrepancy A1' })).toBeVisible()

  const dismissed = page.waitForResponse(
    (response) =>
      response.url().includes('/procurement/discrepancies?') && response.url().includes('status=dismissed'),
  )
  await page.getByRole('radio', { name: 'Dismissed' }).click()
  await dismissed

  await expect(page.getByRole('radio', { name: 'Dismissed' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('No discrepancies')).toBeVisible()

  await page.getByRole('radio', { name: 'All', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review discrepancy A1' })).toBeVisible()
})

test('happy: an outcome picked from the radio cards is the decision recorded', async ({ page }) => {
  await page.goto(pairDiscrepanciesPage())
  await page.getByRole('button', { name: 'Review discrepancy A1' }).click()

  const review = page.getByRole('dialog')
  const outcomes = review.getByRole('radiogroup', { name: 'Outcome' })
  await expect(outcomes).toBeVisible()
  await expect(review.getByRole('radio', { name: 'False positive' })).toBeChecked()

  // The input is visually hidden; a person clicks the card, which is its label.
  await outcomes.getByText('Vendor dispute', { exact: true }).click()
  await expect(review.getByRole('radio', { name: 'Vendor dispute' })).toBeChecked()

  const note = `Raised with the vendor for a credit note (${state.run}).`
  await review.getByLabel('Decision note').fill(note)
  await review.getByRole('button', { name: 'Record decision' }).click()
  await expect(toast(page, 'Decision recorded')).toBeVisible()

  const ws = state.ownerA.workspaceId
  const list = JSON.parse(
    (await bff(page, `/api/workspaces/${ws}/procurement/discrepancies?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}`)).body,
  ) as { items: Array<{ id: string; sku: string | null }> }
  const flag = list.items.find((item) => item.sku === 'A1')
  expect(flag, 'the pair has its A1 flag').toBeDefined()

  const decisions = JSON.parse(
    (await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/${flag!.id}/decisions`)).body,
  ) as Array<{ outcome: string; note: string }>
  const latest = decisions[decisions.length - 1]
  expect(latest).toMatchObject({ outcome: 'vendor_dispute', note })
})

test('happy: Find catalog matches opens the list scoped to the line, named by a chip that × clears', async ({ page }) => {
  await page.goto(pairDiscrepanciesPage())
  await page.getByRole('link', { name: 'Find catalog matches' }).first().click()

  await expect(page).toHaveURL(/\/catalog-matches\?poLineItemId=/)
  await expect(page.getByText(/^PO line · /)).toBeVisible()

  await page.getByRole('button', { name: 'Clear line scope' }).click()

  await expect(page).not.toHaveURL(/poLineItemId=/)
  await expect(page.getByRole('button', { name: 'Clear line scope' })).toHaveCount(0)
})
