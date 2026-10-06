import { expect, test, type Page } from '@playwright/test'
import { closeDb, storageKeyOf, type StoredTable } from '../support/db'
import { objectExists } from '../support/s3'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { batchRow, fillBatchRow, openBatchDialog, submitBatch, uploadInvoiceFile } from '../support/flows'
import {
  bff,
  bffBytes,
  bffUpload,
  chooseFiles,
  download,
  fixture,
  oversized,
  rowFor,
  toast,
  waitForRow,
  wrongType,
  type FilePayload,
} from '../support/ui'

// The three procurement documents, each driven the way an owner does it:
// open the batch dialog, add a file, fill the row's header, upload, wait for
// the parser, download the source back. Serial because the invoice and the receipt link to the PO the
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

  const raw = await bff(page, `${listUrl(kind)}/${row.id}/download`)
  expect(raw.headers['content-type']).toBe('application/octet-stream')
  expect(raw.headers['x-content-type-options'], 'nosniff survives the BFF').toBe('nosniff')
  return row.id
}

test('a purchase order CSV uploads, parses, and its source downloads byte-for-byte', async ({ page }) => {
  const file = fixture('po.csv', `po-${state.run}.csv`)
  await openBatchDialog(page, state.ownerA, 'purchase-orders')
  await chooseFiles(page, 'Add files', [file])
  const row = batchRow(page, file.name)
  await fillBatchRow(row, 'purchase-orders', state.ownerA.vendorId, `PO-${state.run}`)
  await submitBatch(page)
  await expect(row).toHaveAttribute('data-status', 'done')

  purchaseOrderId = await expectParsedStoredAndDownloadable(page, 'purchase-orders', file)
})

test('an invoice linked to that purchase order does the same', async ({ page }) => {
  const file = fixture('invoice.csv', `invoice-${state.run}.csv`)
  await openBatchDialog(page, state.ownerA, 'invoices')
  await chooseFiles(page, 'Add files', [file])
  const row = batchRow(page, file.name)
  await fillBatchRow(row, 'invoices', purchaseOrderId, `INV-${state.run}`)
  await submitBatch(page)
  await expect(row).toHaveAttribute('data-status', 'done')

  await expectParsedStoredAndDownloadable(page, 'invoices', file)
})

test('a goods receipt linked to that purchase order does the same', async ({ page }) => {
  const file = fixture('grn.csv', `grn-${state.run}.csv`)
  await openBatchDialog(page, state.ownerA, 'goods-receipts')
  await chooseFiles(page, 'Add files', [file])
  const row = batchRow(page, file.name)
  await fillBatchRow(row, 'goods-receipts', purchaseOrderId, `GRN-${state.run}`)
  await submitBatch(page)
  await expect(row).toHaveAttribute('data-status', 'done')

  await expectParsedStoredAndDownloadable(page, 'goods-receipts', file)
})

test('a price flag cites the PO row and the invoice row, and the source downloads', async ({ page }) => {
  // CSV row numbering: the header is row 1, so the first data line (A1) is row 2
  // (procurement-parse.processor.ts: `sourceRow: index + 2`).
  const invoiceFile = fixture('invoice-mismatch.csv', `invoice-mismatch-${state.run}.csv`)
  await openBatchDialog(page, state.ownerA, 'invoices')
  await chooseFiles(page, 'Add files', [invoiceFile])
  const invoiceRow = batchRow(page, invoiceFile.name)
  await fillBatchRow(invoiceRow, 'invoices', purchaseOrderId, `INV-MM-${state.run}`)
  await submitBatch(page)
  await expect(invoiceRow).toHaveAttribute('data-status', 'done')

  const invoice = await waitForRow<{ id: string; name: string; status: string }>(
    page,
    listUrl('invoices'),
    (candidate) => candidate.name === invoiceFile.name,
    'done',
  )

  const compared = await bff(page, `/api/workspaces/${state.ownerA.workspaceId}/procurement/discrepancies/compare`, {
    method: 'POST',
    json: { purchaseOrderId, invoiceId: invoice.id },
  })
  expect(compared.status).toBe(201)

  await page.goto(
    `/workspaces/${state.ownerA.workspaceId}/discrepancies?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoice.id}`,
  )
  await page.getByRole('button', { name: 'Review discrepancy A1' }).click()

  const review = page.getByRole('dialog')
  await expect(review.getByText('Source')).toBeVisible()
  await expect(review.getByText('PO row 2', { exact: true })).toBeVisible()
  await expect(review.getByText('Invoice row 2', { exact: true })).toBeVisible()
  await expect(review.getByText(/\bpage\b/i)).toHaveCount(0)

  const got = await download(page, () => review.getByRole('button', { name: /download/i }).first().click())
  expect(got.bytes.length, 'the cited source downloads').toBeGreaterThan(0)
})

test('a file that is not CSV, XLSX, PDF or a photo is refused with the reason', async ({ page }) => {
  // The dialog refuses an unsupported type before sending anything and names
  // the file; the API stays the guard for anything that bypasses the page.
  const file = wrongType(`evil-${state.run}.exe`)
  await openBatchDialog(page, state.ownerA, 'purchase-orders')
  await chooseFiles(page, 'Add files', [file])

  await expect(page.getByRole('dialog').getByText(file.name)).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('group')).toHaveCount(0)

  const direct = await bffUpload(
    page,
    `/api/workspaces/${state.ownerA.workspaceId}/procurement/purchase-orders`,
    [file],
    { vendorId: state.ownerA.vendorId, poNumber: `PO-EXE-${state.run}`, currency: 'USD' },
  )
  expect(direct.status).toBe(400)
  expect(JSON.parse(direct.body).message).toBe('Only CSV, XLSX, or PDF files are supported')
})

test('a file over the upload limit is refused with the limit named', async ({ page }) => {
  const file = oversized(`big-${state.run}.csv`)
  await openBatchDialog(page, state.ownerA, 'purchase-orders')
  await chooseFiles(page, 'Add files', [file])
  const row = batchRow(page, file.name)
  await fillBatchRow(row, 'purchase-orders', state.ownerA.vendorId, `PO-BIG-${state.run}`)
  const upload = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/procurement/purchase-orders'),
  )
  await submitBatch(page)

  const response = await upload
  expect(response.status()).toBe(413)
  expect((await response.json()).message).toBe('File exceeds 1MB upload limit')
  // What the person actually reads - not the framework's "File too large" - on the row that failed.
  await expect(row).toHaveAttribute('data-status', 'error')
  await expect(row.getByText('File exceeds 1MB upload limit')).toBeVisible()
  await expect(row.getByRole('button', { name: /^Retry/ })).toBeVisible()
})

// Photo intake and batch upload. Its own serial chain: a photo PO, then the
// documents that answer it, then the review that unlocks the comparison.
test.describe('photo and batch intake', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  let csvPoId: string
  let photoPoId: string
  let photoPoName: string
  let photoInvoiceName: string

  const poUrl = () => `/api/workspaces/${state.ownerA.workspaceId}/procurement/purchase-orders`
  const photoRow = (page: Page, name: string) => rowFor(page, name)

  // Reads the pixel size straight out of the JPEG's start-of-frame marker.
  function jpegSize(bytes: Buffer): { width: number; height: number } {
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error('not a JPEG segment')
      const marker = bytes[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
      }
      offset += 2 + bytes.readUInt16BE(offset + 2)
    }
    throw new Error('no frame header')
  }

  test('error: a sixth file is refused with the limit named and nothing is added', async ({ page }) => {
    const files = [1, 2, 3, 4, 5, 6].map((n) => fixture('po.csv', `six-${n}-${state.run}.csv`))
    await openBatchDialog(page, state.ownerA, 'purchase-orders')

    await chooseFiles(page, 'Add files', files)

    await expect(page.getByRole('dialog').getByText(/5 files/)).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('group')).toHaveCount(0)
  })

  test('error: a HEIC photo is refused inline on its own row with the export-as-JPEG message', async ({ page }) => {
    const file = fixture('fake.heic', `scan-${state.run}.heic`)
    await openBatchDialog(page, state.ownerA, 'purchase-orders')
    await chooseFiles(page, 'Add photos', [file])
    const row = batchRow(page, file.name)
    await fillBatchRow(row, 'purchase-orders', state.ownerA.vendorId, `PO-HEIC-${state.run}`)

    await submitBatch(page)

    await expect(row).toHaveAttribute('data-status', 'error')
    await expect(row.getByText('HEIC/HEIF photos are not supported — export as JPEG and upload again')).toBeVisible()
    await expect(row.getByRole('button', { name: /^Retry/ })).toBeVisible()
  })

  test('error: the photos route refuses 6 files and a non-image behind a .jpg name', async ({ page }) => {
    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
    const header = { vendorId: state.ownerA.vendorId, poNumber: `PO-GUARD-${state.run}`, currency: 'USD' }
    const six = Array.from({ length: 6 }, (_, n) => fixture('po-photo.jpg', `page-${n + 1}.jpg`))
    const tooMany = await bffUpload(page, `${poUrl()}/photos`, six, header, 'files')
    expect(tooMany.status).toBe(400)
    expect(JSON.parse(tooMany.body).message).toBe('Too many files')

    const fake: FilePayload = { name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is plain text, not a JPEG') }
    const notAnImage = await bffUpload(page, `${poUrl()}/photos`, [fake], header, 'files')
    expect(notAnImage.status).toBe(400)
    expect(JSON.parse(notAnImage.body).message).toBe('Photo 1 is not a JPEG, PNG or WebP image')
  })

  test("error: workspace B cannot read A's photo lines or pages", async ({ browser, page }) => {
    // Seeds its own photo document through the same BFF route the dialog uses.
    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
    const upload = await bffUpload(
      page,
      `${poUrl()}/photos`,
      [fixture('po-photo.jpg', `idor-${state.run}.jpg`)],
      { vendorId: state.ownerA.vendorId, poNumber: `PO-IDOR-${state.run}`, currency: 'USD' },
      'files',
    )
    expect(upload.status).toBe(201)
    const docId = JSON.parse(upload.body).id as string

    const context = await browser.newContext({ storageState: storageStateFor('ownerB') })
    const other = await context.newPage()
    await other.goto(`/workspaces/${state.ownerB.workspaceId}/procurement`)

    const ownWorkspace = await bff(
      other,
      `/api/workspaces/${state.ownerB.workspaceId}/procurement/purchase-orders/${docId}/lines`,
    )
    expect(ownWorkspace.status, "A's document id under B's workspace").toBe(404)
    const foreign = await bff(other, `${poUrl()}/${docId}/lines`)
    expect(foreign.status, "A's workspace id as a non-member").toBe(403)
    const foreignPage = await bffBytes(other, `${poUrl()}/${docId}/pages/1`)
    expect(foreignPage.status).toBe(403)
    await context.close()
  })

  test('happy: a batch of a CSV and a phone photo uploads as two rows, both done, and the photo waits for review', async ({ page }) => {
    const csv = fixture('po.csv', `batch-po-${state.run}.csv`)
    const photo = fixture('po-photo.jpg', `batch-po-photo-${state.run}.jpg`)
    photoPoName = `batch-po-photo-${state.run}.pdf`
    await openBatchDialog(page, state.ownerA, 'purchase-orders')
    await chooseFiles(page, 'Add files', [csv])
    await chooseFiles(page, 'Add photos', [photo])
    const csvRow = batchRow(page, csv.name)
    const photoDialogRow = batchRow(page, photo.name)
    await fillBatchRow(csvRow, 'purchase-orders', state.ownerA.vendorId, `PO-BATCH-${state.run}`)
    await fillBatchRow(photoDialogRow, 'purchase-orders', state.ownerA.vendorId, `PO-PHOTO-${state.run}`)

    await submitBatch(page)

    await expect(csvRow).toHaveAttribute('data-status', 'done')
    await expect(photoDialogRow).toHaveAttribute('data-status', 'done')
    type Doc = { id: string; name: string; status: string; reviewRequired?: boolean; reviewedAt?: string | null; sourceKind?: string; pageCount?: number }
    const csvDoc = await waitForRow<Doc>(page, poUrl(), (d) => d.name === csv.name, 'done')
    const photoDoc = await waitForRow<Doc>(page, poUrl(), (d) => d.name === photoPoName, 'done')
    csvPoId = csvDoc.id
    photoPoId = photoDoc.id
    expect(csvDoc.reviewRequired).toBe(false)
    expect(photoDoc).toMatchObject({ reviewRequired: true, reviewedAt: null, sourceKind: 'image', pageCount: 1 })

    await page.keyboard.press('Escape')
    const photoTableRow = photoRow(page, photoPoName)
    await expect(photoTableRow.getByText('Needs review')).toBeVisible()
    await expect(photoTableRow.getByRole('button', { name: `Review ${photoPoName}` })).toBeVisible()
    await expect(photoRow(page, csv.name).getByText('Needs review')).toHaveCount(0)
  })

  test('edge: the stored page is upright, shrunk, free of EXIF/GPS, and out-of-range pages are 404', async ({ page }) => {
    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)

    const first = await bffBytes(page, `${poUrl()}/${photoPoId}/pages/1`)

    expect(first.status).toBe(200)
    expect(first.headers['content-type']).toBe('image/jpeg')
    expect(first.headers['x-content-type-options'], 'nosniff survives the BFF').toBe('nosniff')
    expect(first.headers['content-security-policy'], 'the sandbox CSP survives the BFF').toContain('sandbox')
    // Fixture: stored 400x300 with EXIF Orientation 6, so upright is 300 wide, 400 tall.
    expect(jpegSize(first.bytes)).toEqual({ width: 300, height: 400 })
    expect(first.bytes.includes(Buffer.from('Exif')), 'EXIF (and its GPS block) is gone').toBe(false)
    for (const n of [0, 2]) {
      expect((await bffBytes(page, `${poUrl()}/${photoPoId}/pages/${n}`)).status, `page ${n}`).toBe(404)
    }
  })

  test('edge: a purchase order pending review cannot be compared, and the pickers leave it out', async ({ page }) => {
    const invoice = fixture('invoice.csv', `batch-gate-invoice-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(page, state.ownerA, photoPoId, invoice, `INV-GATE-${state.run}`)

    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
    const poPicker = page.getByRole('combobox', { name: 'Purchase order' })
    await expect(poPicker.locator('option', { hasText: `batch-po-${state.run}.csv` })).toHaveCount(1)
    await expect(poPicker.locator('option', { hasText: photoPoName })).toHaveCount(0)

    const refused = await bff(page, `/api/workspaces/${state.ownerA.workspaceId}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId: photoPoId, invoiceId },
    })
    expect(refused.status).toBe(400)
    expect(JSON.parse(refused.body).message).toBe('Purchase order needs review before it can be compared')
    expect(csvPoId).toBeTruthy()
  })

  test('happy: the review modal shows the page image beside the lines and tints the low-confidence one', async ({ page }) => {
    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
    await photoRow(page, photoPoName).getByRole('button', { name: `Review ${photoPoName}` }).click()

    const modal = page.getByRole('dialog')
    const image = modal.getByRole('img', { name: /^Page 1 of \d+, photo of / })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    // The stub reads B2 at 0.45 confidence and A1 at 0.92.
    await expect(modal.getByLabel('Quantity line 2').locator('xpath=ancestor::tr')).toHaveAttribute('data-low-confidence', 'true')
    await expect(modal.getByLabel('Quantity line 1').locator('xpath=ancestor::tr')).not.toHaveAttribute('data-low-confidence', 'true')
  })

  test('happy: editing a quantity and pressing Confirm reviews the document and locks it', async ({ page }) => {
    await page.goto(`/workspaces/${state.ownerA.workspaceId}/procurement`)
    await photoRow(page, photoPoName).getByRole('button', { name: `Review ${photoPoName}` }).click()
    const modal = page.getByRole('dialog')
    await modal.getByLabel('Quantity line 1').fill('8')

    await modal.getByRole('button', { name: 'Confirm' }).click()

    await expect(toast(page, `${photoPoName} reviewed`)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(photoRow(page, photoPoName).getByText('Needs review')).toHaveCount(0)
    const lines = JSON.parse((await bff(page, `${poUrl()}/${photoPoId}/lines`)).body)
    expect(lines.document.reviewedAt).toBeTruthy()
    expect(Number(lines.items[0].quantity)).toBe(8)
    expect(lines.items[0].editedAt).toBeTruthy()
    expect(lines.items[1].editedAt).toBeNull()
    const again = await bff(page, `${poUrl()}/${photoPoId}/review`, { method: 'POST', json: { lines: [{ id: lines.items[0].id, quantity: '9' }] } })
    expect(again.status, 'a reviewed document is locked').toBe(409)
  })

  test('happy: a photo invoice is reviewed, compared, and the flag citation says photo and edited', async ({ page }) => {
    const photo = fixture('invoice-photo.png', `batch-inv-photo-${state.run}.png`)
    photoInvoiceName = `batch-inv-photo-${state.run}.pdf`
    await openBatchDialog(page, state.ownerA, 'invoices')
    await chooseFiles(page, 'Add photos', [photo])
    const row = batchRow(page, photo.name)
    await fillBatchRow(row, 'invoices', photoPoId, `INV-PHOTO-${state.run}`)
    await submitBatch(page)
    await expect(row).toHaveAttribute('data-status', 'done')
    await waitForRow<{ id: string; name: string; status: string }>(
      page,
      `/api/workspaces/${state.ownerA.workspaceId}/procurement/invoices`,
      (d) => d.name === photoInvoiceName,
      'done',
    )
    await page.keyboard.press('Escape')

    // Confirm with no edits: the reviewer read it back and agrees.
    await page.getByRole('button', { name: `Review ${photoInvoiceName}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(toast(page, `${photoInvoiceName} reviewed`)).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('tab', { name: 'Purchase Orders' }).click()
    await page.getByRole('combobox', { name: 'Purchase order' }).selectOption({ label: photoPoName })
    await page.getByRole('combobox', { name: 'Invoice' }).selectOption({ label: photoInvoiceName })
    await page.getByRole('button', { name: 'Run comparison' }).click()
    await expect(page).toHaveURL(/\/discrepancies\?purchaseOrderId=/)

    // The PO's A1 was edited 10 -> 8; the invoice's A1 was read from the photo at 91%.
    await page.getByRole('button', { name: 'Review discrepancy A1' }).click()
    const review = page.getByRole('dialog')
    await expect(review.getByText('PO line 1 · edited by reviewer', { exact: true })).toBeVisible()
    await expect(review.getByText('Invoice line 1 · read from photo, 91% confidence', { exact: true })).toBeVisible()
  })

  test('edge: a photo goods receipt is read as received, accepted and rejected', async ({ page }) => {
    const photo = fixture('receipt-photo.webp', `batch-grn-photo-${state.run}.webp`)
    const docName = `batch-grn-photo-${state.run}.pdf`
    await openBatchDialog(page, state.ownerA, 'goods-receipts')
    await chooseFiles(page, 'Add photos', [photo])
    const row = batchRow(page, photo.name)
    await fillBatchRow(row, 'goods-receipts', photoPoId, `GRN-PHOTO-${state.run}`)
    await submitBatch(page)
    await expect(row).toHaveAttribute('data-status', 'done')
    await waitForRow<{ id: string; name: string; status: string }>(
      page,
      `/api/workspaces/${state.ownerA.workspaceId}/procurement/goods-receipts`,
      (d) => d.name === docName,
      'done',
    )
    await page.keyboard.press('Escape')

    await photoRow(page, docName).getByRole('button', { name: `Review ${docName}` }).click()

    const modal = page.getByRole('dialog')
    await expect(modal.getByLabel('Received line 2')).toHaveValue(/^4/)
    await expect(modal.getByLabel('Accepted line 2')).toHaveValue(/^3/)
    await expect(modal.getByLabel('Rejected line 2')).toHaveValue(/^1/)
  })
})
