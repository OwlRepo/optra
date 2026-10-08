import { expect, test, type Browser, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { uploadInvoiceFile, uploadPurchaseOrder } from '../support/flows'
import { loadState, storageStateFor, type Owner, type Role, type SeedState } from '../support/state'
import { bff, download, fixture } from '../support/ui'

// The evidence-trail export, driven as a person drives it: a button on the
// discrepancies page that downloads the current filter scope as an Excel file.
// Pairs are seeded in the shared workspaces the way procurement-core.spec.ts
// does, and every export is scoped to its own PO/invoice pair by the URL, so
// no test depends on another's flags.

let state: SeedState

async function pageAs(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(role) })
  return context.newPage()
}

async function comparedPair(page: Page, owner: Owner, label: string, invoiceFile: string) {
  const purchaseOrderId = await uploadPurchaseOrder(page, owner, `${label}-po-${state.run}.csv`)
  const invoiceId = await uploadInvoiceFile(
    page,
    owner,
    purchaseOrderId,
    fixture(invoiceFile, `${label}-invoice-${state.run}.csv`),
    `INV-${label.toUpperCase()}-${state.run}`,
  )
  const compared = await bff(page, `/api/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`, {
    method: 'POST',
    json: { purchaseOrderId, invoiceId },
  })
  expect(compared.status).toBe(201)
  return { purchaseOrderId, invoiceId }
}

const rowsOf = (bytes: Buffer, sheet: string) =>
  XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(bytes, { type: 'buffer' }).Sheets[sheet], { header: 1, defval: '' })

test.beforeAll(() => {
  state = loadState()
})

test.describe('evidence-trail export', () => {
  test("error: owner B cannot export workspace A's evidence, and gets no workbook", async ({ browser }) => {
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerA.workspaceId
    await page.goto(`/workspaces/${state.ownerB.workspaceId}/discrepancies`)

    const response = await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/export`)

    expect(response.status).toBe(403)
    expect(response.headers['content-type']).not.toContain('spreadsheetml')
    await page.context().close()
  })

  test('error: a malformed filter is refused 400 through the BFF and nothing downloads', async ({ browser }) => {
    const page = await pageAs(browser, 'ownerB')
    await page.goto(`/workspaces/${state.ownerB.workspaceId}/discrepancies`)

    const response = await bff(
      page,
      `/api/workspaces/${state.ownerB.workspaceId}/procurement/discrepancies/export?purchaseOrderId=not-a-uuid`,
    )

    expect(response.status).toBe(400)
    await page.context().close()
  })

  test('edge: a clean pair has no flags, so Export evidence is disabled', async ({ browser }) => {
    const page = await pageAs(browser, 'ownerB')
    const pair = await comparedPair(page, state.ownerB, 'export-clean', 'invoice-semicolon.csv')

    await page.goto(
      `/workspaces/${state.ownerB.workspaceId}/discrepancies?purchaseOrderId=${pair.purchaseOrderId}&invoiceId=${pair.invoiceId}`,
    )

    await expect(page.getByText('No discrepancies')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export evidence' })).toBeDisabled()
    await page.context().close()
  })

  test('edge: a member can export the flags they can already read', async ({ browser }) => {
    const owner = await pageAs(browser, 'ownerA')
    const pair = await comparedPair(owner, state.ownerA, 'export-member', 'invoice-mismatch.csv')
    await owner.context().close()

    const page = await pageAs(browser, 'memberA')
    await page.goto(
      `/workspaces/${state.ownerA.workspaceId}/discrepancies?purchaseOrderId=${pair.purchaseOrderId}&invoiceId=${pair.invoiceId}`,
    )
    await expect(page.getByRole('button', { name: 'Review discrepancy A1', exact: true })).toBeVisible()

    const got = await download(page, () => page.getByRole('button', { name: 'Export evidence' }).click())

    expect(got.filename).toMatch(/^optra-evidence-trail-\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(rowsOf(got.bytes, 'Flags').length).toBeGreaterThan(1)
    await page.context().close()
  })

  test('happy: Export evidence downloads a dated workbook with the Flags and Decisions sheets for the filtered pair', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const page = await pageAs(browser, 'ownerB')
    const pair = await comparedPair(page, state.ownerB, 'export-happy', 'invoice-mismatch.csv')
    await page.goto(
      `/workspaces/${state.ownerB.workspaceId}/discrepancies?purchaseOrderId=${pair.purchaseOrderId}&invoiceId=${pair.invoiceId}`,
    )
    await expect(page.getByRole('button', { name: 'Review discrepancy A1', exact: true })).toBeVisible()

    const got = await download(page, () => page.getByRole('button', { name: 'Export evidence' }).click())

    expect(got.filename).toMatch(/^optra-evidence-trail-\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(XLSX.read(got.bytes, { type: 'buffer' }).SheetNames).toEqual(['Flags', 'Decisions'])
    const flags = rowsOf(got.bytes, 'Flags')
    const header = flags[0] as string[]
    expect(header.slice(0, 5)).toEqual(['Flag ID', 'Created (UTC ISO)', 'Type', 'Status', 'SKU'])
    const a1 = flags.slice(1).find((row) => row[header.indexOf('SKU')] === 'A1') as unknown[]
    expect(a1, 'the A1 mismatch is in the export').toBeDefined()
    expect(a1[header.indexOf('PO source')]).toBe('row 2')
    expect(a1[header.indexOf('Invoice source')]).toBe('row 2')
    expect(rowsOf(got.bytes, 'Decisions')[0]).toEqual([
      'Flag ID',
      'SKU',
      'Outcome',
      'Note',
      'By',
      'Role',
      'At (UTC ISO)',
    ])
    await page.context().close()
  })
})
