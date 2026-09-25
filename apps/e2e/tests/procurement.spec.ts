import { expect, test, type Page } from '@playwright/test'
import { closeDb, storageKeyOf, type StoredTable } from '../support/db'
import { objectExists } from '../support/s3'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { chooseFile, download, fixture, oversized, toast, waitForRow, wrongType, type FilePayload, rowFor } from '../support/ui'

// The three procurement documents, each driven the way an owner does it:
// pick a file, fill the header, upload, wait for the parser, download the
// source back. Serial because the invoice and the receipt link to the PO the
// first test creates.

test.describe.configure({ mode: 'serial' })
test.use({ storageState: storageStateFor('ownerA') })

let state: SeedState
let purchaseOrderId: string

test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

type Kind = 'purchase-orders' | 'invoices' | 'goods-receipts'

const TABLE: Record<Kind, StoredTable> = {
  'purchase-orders': 'purchase_orders',
  invoices: 'invoices',
  'goods-receipts': 'goods_receipts',
}

const listUrl = (kind: Kind) => `/api/workspaces/${state.ownerA.workspaceId}/procurement/${kind}`

async function openTab(page: Page, tab: 'Purchase Orders' | 'Invoices' | 'Goods Receipts') {
  await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
  await page.getByRole('tab', { name: tab }).click()
}

/** Proves the three things that make an upload real: parsed, stored, and returned intact. */
async function expectParsedStoredAndDownloadable(page: Page, kind: Kind, file: FilePayload) {
  const row = await waitForRow<{ id: string; name: string; status: string }>(
    page,
    listUrl(kind),
    (candidate) => candidate.name === file.name,
    'done',
  )

  const key = await storageKeyOf(TABLE[kind], row.id)
  expect(key, 'the row records where its file lives').toBeTruthy()
  expect(await objectExists(key!), 'the object is really in storage').toBe(true)

  const tableRow = rowFor(page, file.name)
  await expect(tableRow.getByText('Ready')).toBeVisible()

  const got = await download(page, () =>
    tableRow.getByRole('button', { name: `Download ${file.name}` }).click(),
  )
  expect(got.filename).toBe(file.name)
  expect(got.bytes.equals(file.buffer), 'downloaded bytes equal the uploaded bytes').toBe(true)
  return row.id
}

test('a purchase order CSV uploads, parses, and its source downloads byte-for-byte', async ({ page }) => {
  const file = fixture('po.csv', `po-${state.run}.csv`)
  await openTab(page, 'Purchase Orders')
  await chooseFile(page, 'Upload purchase order', file)

  const dialog = page.getByRole('dialog')
  await dialog.locator('#po-vendor').selectOption(state.ownerA.vendorId)
  await dialog.locator('#po-number').fill(`PO-${state.run}`)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Purchase order uploaded')).toBeVisible()

  purchaseOrderId = await expectParsedStoredAndDownloadable(page, 'purchase-orders', file)
})

test('an invoice linked to that purchase order does the same', async ({ page }) => {
  const file = fixture('invoice.csv', `invoice-${state.run}.csv`)
  await openTab(page, 'Invoices')
  await chooseFile(page, 'Upload invoice', file)

  const dialog = page.getByRole('dialog')
  await dialog.locator('#invoice-po').selectOption(purchaseOrderId)
  await dialog.locator('#invoice-number').fill(`INV-${state.run}`)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Invoice uploaded')).toBeVisible()

  await expectParsedStoredAndDownloadable(page, 'invoices', file)
})

test('a goods receipt linked to that purchase order does the same', async ({ page }) => {
  const file = fixture('grn.csv', `grn-${state.run}.csv`)
  await openTab(page, 'Goods Receipts')
  await chooseFile(page, 'Upload goods receipt', file)

  const dialog = page.getByRole('dialog')
  await dialog.locator('#grn-po').selectOption(purchaseOrderId)
  await dialog.locator('#grn-number').fill(`GRN-${state.run}`)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Goods receipt uploaded')).toBeVisible()

  await expectParsedStoredAndDownloadable(page, 'goods-receipts', file)
})

test('a file that is not CSV, XLSX or PDF is refused with the reason', async ({ page }) => {
  // The input's `accept` is only a hint to the picker; the API is the guard.
  await openTab(page, 'Purchase Orders')
  await chooseFile(page, 'Upload purchase order', wrongType(`evil-${state.run}.exe`))

  const dialog = page.getByRole('dialog')
  await dialog.locator('#po-vendor').selectOption(state.ownerA.vendorId)
  await dialog.locator('#po-number').fill(`PO-EXE-${state.run}`)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()

  await expect(toast(page, 'Upload failed')).toBeVisible()
  await expect(page.getByText('Only CSV, XLSX, or PDF files are supported')).toBeVisible()
})

test('a file over the upload limit is refused with 413', async ({ page }) => {
  await openTab(page, 'Purchase Orders')
  await chooseFile(page, 'Upload purchase order', oversized(`big-${state.run}.csv`))

  const dialog = page.getByRole('dialog')
  await dialog.locator('#po-vendor').selectOption(state.ownerA.vendorId)
  await dialog.locator('#po-number').fill(`PO-BIG-${state.run}`)
  const upload = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/procurement/purchase-orders'),
  )
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()

  expect((await upload).status()).toBe(413)
  await expect(toast(page, 'Upload failed')).toBeVisible()
})
