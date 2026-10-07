import { expect, type Locator, type Page } from '@playwright/test'
import { photoKeysOfCatalog } from './db'
import type { Owner } from './state'
import { chooseFile, chooseFiles, fixture, waitForRow, type FilePayload } from './ui'

// Multi-step flows more than one spec needs, done through the UI exactly as
// the dedicated specs do them. Each returns the id of what it created.

type Doc = { id: string; name: string; status: string }

export type DocTab = 'purchase-orders' | 'invoices' | 'goods-receipts'

const TAB_LABEL: Record<DocTab, 'Purchase Orders' | 'Invoices' | 'Goods Receipts'> = {
  'purchase-orders': 'Purchase Orders',
  invoices: 'Invoices',
  'goods-receipts': 'Goods Receipts',
}
const UPLOAD_BUTTON: Record<DocTab, string> = {
  'purchase-orders': 'Upload purchase order',
  invoices: 'Upload invoice',
  'goods-receipts': 'Upload goods receipt',
}
// Header fields of one batch-dialog row, by accessible label. A purchase order
// names its vendor; an invoice and a receipt name the purchase order they answer.
const LINK_LABEL: Record<DocTab, 'Vendor' | 'Purchase order'> = {
  'purchase-orders': 'Vendor',
  invoices: 'Purchase order',
  'goods-receipts': 'Purchase order',
}
const NUMBER_LABEL: Record<DocTab, 'PO number' | 'Invoice number' | 'Goods receipt number'> = {
  'purchase-orders': 'PO number',
  invoices: 'Invoice number',
  'goods-receipts': 'Goods receipt number',
}

/** Opens the procurement page on `tab` and the batch dialog from that tab's upload button. */
export async function openBatchDialog(page: Page, owner: Owner, tab: DocTab): Promise<void> {
  await page.goto(`/workspaces/${owner.workspaceId}/procurement`)
  if (tab !== 'purchase-orders') await page.getByRole('tab', { name: TAB_LABEL[tab] }).click()
  await page.getByRole('button', { name: UPLOAD_BUTTON[tab] }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

/**
 * One batch-dialog row, matched by its accessible name: the file name, or
 * "N photos" for photos picked together. Each row exposes
 * data-status="ready|uploading|done|error".
 */
export function batchRow(page: Page, name: string) {
  return page.getByRole('dialog').getByRole('group', { name, exact: true })
}

/** Fills the required header of a row: `link` is the vendor id (purchase order) or the purchase order id. */
export async function fillBatchRow(row: Locator, tab: DocTab, link: string, number: string): Promise<void> {
  await row.getByLabel(LINK_LABEL[tab]).selectOption(link)
  await row.getByLabel(NUMBER_LABEL[tab]).fill(number)
}

export async function submitBatch(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Upload', exact: true }).click()
}

/**
 * The dialog stays open after a run so every row's status stays readable;
 * close it as a person would before acting on the page behind it.
 */
export async function closeBatchDialog(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

async function uploadFileViaDialog(
  page: Page,
  owner: Owner,
  tab: DocTab,
  file: FilePayload,
  link: string,
  number: string,
): Promise<string> {
  await openBatchDialog(page, owner, tab)
  await chooseFiles(page, 'Add files', [file])
  const row = batchRow(page, file.name)
  await fillBatchRow(row, tab, link, number)
  await submitBatch(page)
  await expect(row).toHaveAttribute('data-status', 'done')
  await closeBatchDialog(page)
  const parsed = await waitForRow<Doc>(
    page,
    `/api/workspaces/${owner.workspaceId}/procurement/${tab}`,
    (candidate) => candidate.name === file.name,
    'done',
  )
  return parsed.id
}

export async function uploadPurchaseOrder(page: Page, owner: Owner, fileName: string): Promise<string> {
  const file = fixture('po.csv', fileName)
  return uploadFileViaDialog(page, owner, 'purchase-orders', file, owner.vendorId, fileName.replace(/\.csv$/, '').toUpperCase())
}

export async function uploadKnowledgeBaseDocument(page: Page, owner: Owner, fileName: string): Promise<string> {
  const file = fixture('kb-note.md', fileName)
  // [support-surfaces-off] was: page.goto the knowledge-base page and
  // setInputFiles on 'Upload document'. That page answers 404 while the
  // support surfaces are disabled, so upload through the same BFF route the
  // page calls (same multipart field, same session). Restore on re-enable.
  await page.goto(`/workspaces/${owner.workspaceId}/procurement`)
  const status = await page.evaluate(
    async ({ url, name, mimeType, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const form = new FormData()
      form.append('file', new File([bytes], name, { type: mimeType }))
      return (await fetch(url, { method: 'POST', body: form, credentials: 'same-origin' })).status
    },
    {
      url: `/api/workspaces/${owner.workspaceId}/knowledge-bases/${owner.knowledgeBaseId}/documents`,
      name: file.name,
      mimeType: file.mimeType,
      base64: file.buffer.toString('base64'),
    },
  )
  expect(status, 'knowledge-base upload through the BFF').toBeLessThan(300)
  const row = await waitForRow<{ id: string; title: string; status: string }>(
    page,
    `/api/workspaces/${owner.workspaceId}/knowledge-bases/${owner.knowledgeBaseId}/documents?pageSize=100`,
    (candidate) => candidate.title === file.name,
    'done',
  )
  return row.id
}

/** Uploads a PDF catalog and returns one of ITS items that has a stored photo. */
export async function uploadCatalogWithPhoto(
  page: Page,
  owner: Owner,
  fileName: string,
): Promise<{ itemId: string; photoKey: string }> {
  const file = fixture('catalog.pdf', fileName)
  await page.goto(`/workspaces/${owner.workspaceId}/vendors/${owner.vendorId}`)
  await chooseFile(page, 'Upload catalog', file)
  const catalog = await waitForRow<{ id: string; name: string; status: string }>(
    page,
    `/api/workspaces/${owner.workspaceId}/vendors/${owner.vendorId}/catalogs`,
    (candidate) => candidate.name === file.name,
    'done',
  )
  const [photo] = await photoKeysOfCatalog(catalog.id)
  return { itemId: photo.id, photoKey: photo.key }
}

/** Any purchase-order file (CSV, XLSX), through the batch dialog; resolves once it has parsed. */
export async function uploadPurchaseOrderFile(page: Page, owner: Owner, file: FilePayload, poNumber: string): Promise<string> {
  return uploadFileViaDialog(page, owner, 'purchase-orders', file, owner.vendorId, poNumber)
}

/** An invoice linked to `purchaseOrderId`, through the batch dialog; resolves once it has parsed. */
export async function uploadInvoiceFile(
  page: Page,
  owner: Owner,
  purchaseOrderId: string,
  file: FilePayload,
  invoiceNumber: string,
): Promise<string> {
  return uploadFileViaDialog(page, owner, 'invoices', file, purchaseOrderId, invoiceNumber)
}

/** A goods receipt linked to `purchaseOrderId`, through the batch dialog; resolves once it has parsed. */
export async function uploadGoodsReceiptFile(
  page: Page,
  owner: Owner,
  purchaseOrderId: string,
  file: FilePayload,
  grnNumber: string,
): Promise<string> {
  return uploadFileViaDialog(page, owner, 'goods-receipts', file, purchaseOrderId, grnNumber)
}
