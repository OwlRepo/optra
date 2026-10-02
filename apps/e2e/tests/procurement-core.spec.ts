import { expect, test, type Browser, type Page } from '@playwright/test'
import { uploadGoodsReceiptFile, uploadInvoiceFile, uploadPurchaseOrder, uploadPurchaseOrderFile } from '../support/flows'
import { loadState, storageStateFor, type Role, type SeedState } from '../support/state'
import { bff, fixture, rowFor, toast } from '../support/ui'

// The procurement paths a launch rests on, driven as a person drives them.
// Mutating flows run as owner B in workspace B (docs/ai/testing-strategy.md,
// "The browser harness"). The member probe needs a flag in workspace A - the
// only workspace member A belongs to - so that test seeds A as owner A.

type Flag = {
  id: string
  sku: string | null
  flagType: string
  status: string
  reason: string
  poValue: string | null
  receivedValue: string | null
  invoiceValue: string | null
  comparisonRunId: string | null
  dismissedBy: string | null
}

type Decision = { outcome: string; note: string; actorRole: string; actorEmail: string | null }

let state: SeedState

async function pageAs(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(role) })
  return context.newPage()
}

test.beforeAll(() => {
  state = loadState()
})

test.describe('procurement core', () => {
  test('error: a member sees the discrepancy list but no dismiss or decision control', async ({ browser }) => {
    const owner = await pageAs(browser, 'ownerA')
    const ws = state.ownerA.workspaceId
    const purchaseOrderId = await uploadPurchaseOrder(owner, state.ownerA, `core-member-po-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(
      owner,
      state.ownerA,
      purchaseOrderId,
      fixture('invoice-mismatch.csv', `core-member-invoice-${state.run}.csv`),
      `INV-CORE-M-${state.run}`,
    )
    const compared = await bff(owner, `/api/workspaces/${ws}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId, invoiceId },
    })
    expect(compared.status).toBe(201)
    await owner.context().close()

    const page = await pageAs(browser, 'memberA')
    await page.goto(`/workspaces/${ws}/discrepancies?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}`)
    // The role badge renders only once membership has loaded, so the absences below are real.
    await expect(page.getByText('member', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Review discrepancy A1', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dismiss discrepancy A1', exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Review discrepancy A1', exact: true }).click()
    const review = page.getByRole('dialog')
    await expect(review.getByText('Only an owner or admin can record a decision on this discrepancy.')).toBeVisible()
    await expect(review.getByRole('button', { name: 'Record decision' })).toHaveCount(0)
    await expect(review.getByRole('textbox', { name: 'Decision note' })).toHaveCount(0)
    await page.context().close()
  })

  test("error: owner B opening workspace A's procurement page is told they are not a member and gets no controls", async ({
    browser,
  }) => {
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerA.workspaceId
    await page.goto(`/workspaces/${ws}/procurement`)

    await expect(toast(page, 'Failed to load procurement documents')).toBeVisible()
    await expect(page.getByText('Not a member of this workspace', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload purchase order' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Run comparison' })).toHaveCount(0)

    for (const url of [`/api/workspaces/${ws}`, `/api/workspaces/${ws}/procurement/purchase-orders`]) {
      const response = await bff(page, url)
      expect(response.status, url).toBe(403)
      expect(JSON.parse(response.body).message, url).toBe('Not a member of this workspace')
    }
    await page.context().close()
  })

  test('edge: an XLSX purchase order uploads and parses its rows', async ({ browser }) => {
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerB.workspaceId
    const file = fixture('po.xlsx', `core-po-${state.run}.xlsx`)
    const id = await uploadPurchaseOrderFile(page, state.ownerB, file, `PO-CORE-XLSX-${state.run}`)

    const listed = JSON.parse((await bff(page, `/api/workspaces/${ws}/procurement/purchase-orders`)).body) as {
      id: string
      status: string
      rowCount: number | null
    }[]
    expect(listed.find((doc) => doc.id === id)).toMatchObject({ status: 'done', rowCount: 2 })

    await page.reload()
    await expect(rowFor(page, file.name).getByText('Ready')).toBeVisible()
    await page.context().close()
  })

  test('edge: a semicolon-delimited invoice linked to its purchase order parses and compares clean', async ({ browser }) => {
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerB.workspaceId
    const purchaseOrderId = await uploadPurchaseOrder(page, state.ownerB, `core-semi-po-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(
      page,
      state.ownerB,
      purchaseOrderId,
      fixture('invoice-semicolon.csv', `core-semi-invoice-${state.run}.csv`),
      `INV-CORE-SEMI-${state.run}`,
    )

    const invoices = JSON.parse((await bff(page, `/api/workspaces/${ws}/procurement/invoices`)).body) as {
      id: string
      status: string
      rowCount: number | null
    }[]
    expect(invoices.find((doc) => doc.id === invoiceId)).toMatchObject({ status: 'done', rowCount: 2 })

    // Every quantity and price read correctly through the `;` columns, so the pair agrees exactly.
    const compared = await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId, invoiceId },
    })
    expect(compared.status).toBe(201)
    expect(JSON.parse(compared.body).flags).toEqual([])
    await page.context().close()
  })

  test('happy: PO, invoice and two split receipts compare three-way; a decision with a note dismisses a flag and stays on its run after a re-compare', async ({
    browser,
  }) => {
    test.setTimeout(150_000)
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerB.workspaceId

    const poFile = fixture('po.csv', `core-happy-po-${state.run}.csv`)
    const purchaseOrderId = await uploadPurchaseOrderFile(page, state.ownerB, poFile, `PO-CORE-HAPPY-${state.run}`)
    const invoiceFile = fixture('invoice-mismatch.csv', `core-happy-invoice-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(page, state.ownerB, purchaseOrderId, invoiceFile, `INV-CORE-HAPPY-${state.run}`)
    await uploadGoodsReceiptFile(
      page,
      state.ownerB,
      purchaseOrderId,
      fixture('grn-split-1.csv', `core-grn-1-${state.run}.csv`),
      `GRN-CORE-1-${state.run}`,
    )
    await uploadGoodsReceiptFile(
      page,
      state.ownerB,
      purchaseOrderId,
      fixture('grn-split-2.csv', `core-grn-2-${state.run}.csv`),
      `GRN-CORE-2-${state.run}`,
    )

    // Compare the way a person does: pick the pair, run it, land on its flags.
    await page.goto(`/workspaces/${ws}/procurement`)
    await page.locator('select[aria-label="Purchase order"]').selectOption({ label: poFile.name })
    await page.locator('select[aria-label="Invoice"]').selectOption({ label: invoiceFile.name })
    await page.getByRole('button', { name: 'Run comparison' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/workspaces/${ws}/discrepancies\\?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}$`),
    )

    const rowOf = (sku: string) =>
      page.getByRole('row').filter({ has: page.getByRole('button', { name: `Review discrepancy ${sku}`, exact: true }) })
    await expect(rowOf('A1').getByText('Price mismatch', { exact: true })).toBeVisible()
    await expect(rowOf('B2').getByText('Billed above received', { exact: true })).toBeVisible()

    // A1: accepted 6+4=10 = billed 10 = ordered 10, so only the price (5 vs 6) is flagged.
    // B2: accepted 2+1=3 < billed 4, so it is billed above received.
    const listUrl = `/api/workspaces/${ws}/procurement/discrepancies?purchaseOrderId=${purchaseOrderId}&invoiceId=${invoiceId}`
    const first = JSON.parse((await bff(page, listUrl)).body) as {
      items: Flag[]
      total: number
      counts: Record<string, number>
    }
    expect(first.total).toBe(2)
    expect(first.counts).toMatchObject({
      price_mismatch: 1,
      invoice_exceeds_received: 1,
      short_receipt: 0,
      quantity_mismatch: 0,
      missing_on_invoice: 0,
      missing_on_po: 0,
    })
    const a1 = first.items.find((flag) => flag.sku === 'A1')!
    const b2 = first.items.find((flag) => flag.sku === 'B2')!
    expect(a1.reason).toBe('Unit price mismatch for A1: PO=5 Invoice=6 (summed across 2 goods receipt lines)')
    expect(b2).toMatchObject({
      flagType: 'invoice_exceeds_received',
      status: 'open',
      poValue: '4',
      receivedValue: '3',
      invoiceValue: '4',
      reason: 'Invoice bills more than was accepted for B2: accepted 3, invoiced 4 (summed across 2 goods receipt lines)',
    })

    // Decide B2 with a note.
    await page.getByRole('button', { name: 'Review discrepancy B2', exact: true }).click()
    const review = page.getByRole('dialog')
    await expect(review.getByText('Three-way', { exact: true })).toBeVisible()
    await review.getByRole('combobox', { name: 'Outcome' }).selectOption('vendor_dispute')
    const note = `Billed 4, accepted 3 across two deliveries (${state.run}).`
    await review.getByRole('textbox', { name: 'Decision note' }).fill(note)
    await review.getByRole('button', { name: 'Record decision' }).click()
    await expect(toast(page, 'Decision recorded')).toBeVisible()
    await expect(review).toHaveCount(0)
    await expect(rowOf('B2').getByRole('button', { name: 'Dismiss discrepancy B2' })).toHaveCount(0)
    await expect(rowOf('A1').getByRole('button', { name: 'Dismiss discrepancy A1' })).toBeVisible()

    // The decision is on the record, attributed to who made it.
    await page.getByRole('button', { name: 'Review discrepancy B2', exact: true }).click()
    const decision = page.getByRole('dialog').getByRole('listitem').filter({ hasText: note })
    await expect(decision.getByText('Vendor dispute', { exact: true })).toBeVisible()
    await expect(decision.getByText(`${state.ownerB.email} (owner)`)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

    // A re-compare appends a run; it never rewrites the one a human decided (D15).
    const recompared = await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId, invoiceId },
    })
    expect(recompared.status).toBe(201)
    const second = JSON.parse(recompared.body) as { runId: string; flags: Flag[] }
    expect(second.runId).not.toBe(b2.comparisonRunId)
    expect(second.flags).toHaveLength(2)

    const decidedRun = JSON.parse((await bff(page, `${listUrl}&runId=${b2.comparisonRunId}`)).body) as { items: Flag[] }
    expect(decidedRun.items.find((flag) => flag.id === b2.id)).toMatchObject({
      status: 'dismissed',
      dismissedBy: state.ownerB.userId,
    })
    expect(decidedRun.items.find((flag) => flag.id === a1.id)).toMatchObject({ status: 'open' })

    const decisions = JSON.parse(
      (await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/${b2.id}/decisions`)).body,
    ) as Decision[]
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      outcome: 'vendor_dispute',
      note,
      actorRole: 'owner',
      actorEmail: state.ownerB.email,
    })
    await page.context().close()
  })
})
