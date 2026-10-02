import { expect, test, type Browser, type Page } from '@playwright/test'
import { uploadInvoiceFile, uploadPurchaseOrder } from '../support/flows'
import { loadState, storageStateFor, type Role, type SeedState } from '../support/state'
import { bff, chooseFile, fixture, toast, waitForRow } from '../support/ui'

// Catalog upload and match review, driven as a person drives them. The happy
// path runs as owner B in workspace B (docs/ai/testing-strategy.md, "The browser
// harness"). The stub answers the comparison with a fixed verdict
// (stubs/openai-stub.ts), so the reason on screen is the stub's.

let state: SeedState

async function pageAs(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(role) })
  return context.newPage()
}

test.beforeAll(() => {
  state = loadState()
})

test.describe('catalog core', () => {
  test('error: a member has no catalog upload or scrape control, and the API refuses the upload', async ({ browser }) => {
    const page = await pageAs(browser, 'memberA')
    const ws = state.memberA.workspaceId
    await page.goto(`/workspaces/${ws}/vendors/${state.ownerA.vendorId}`)
    // The role badge renders only once membership has loaded, so the absences below are real.
    await expect(page.getByText('member', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload catalog' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Scrape website' })).toHaveCount(0)

    // The hidden button is a courtesy; the API is the guard.
    const status = await page.evaluate(async (url) => {
      const form = new FormData()
      form.append('file', new Blob(['sku,description\nA1,Widget\n'], { type: 'text/csv' }), 'member-catalog.csv')
      return (await fetch(url, { method: 'POST', body: form, credentials: 'same-origin' })).status
    }, `/api/workspaces/${ws}/vendors/${state.ownerA.vendorId}/catalogs`)
    expect(status).toBe(403)
    await page.context().close()
  })

  test('happy: a CSV catalog uploads, a PO line search shows the stub verdict with its reason, and dismissing it removes it from the open list', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const page = await pageAs(browser, 'ownerB')
    const ws = state.ownerB.workspaceId

    const catalogFile = fixture('catalog.csv', `catalog-core-${state.run}.csv`)
    await page.goto(`/workspaces/${ws}/vendors/${state.ownerB.vendorId}`)
    await chooseFile(page, 'Upload catalog', catalogFile)
    await expect(toast(page, 'Catalog uploaded')).toBeVisible()
    const catalog = await waitForRow<{ id: string; name: string; status: string; rowCount: number | null }>(
      page,
      `/api/workspaces/${ws}/vendors/${state.ownerB.vendorId}/catalogs`,
      (row) => row.name === catalogFile.name,
      'done',
    )
    expect(catalog.rowCount).toBe(2)

    // A real PO line to search from: its id is only exposed on a discrepancy flag.
    const purchaseOrderId = await uploadPurchaseOrder(page, state.ownerB, `catalog-core-po-${state.run}.csv`)
    const invoiceId = await uploadInvoiceFile(
      page,
      state.ownerB,
      purchaseOrderId,
      fixture('invoice-mismatch.csv', `catalog-core-invoice-${state.run}.csv`),
      `INV-CAT-CORE-${state.run}`,
    )
    const compared = await bff(page, `/api/workspaces/${ws}/procurement/discrepancies/compare`, {
      method: 'POST',
      json: { purchaseOrderId, invoiceId },
    })
    expect(compared.status).toBe(201)
    const a1 = (JSON.parse(compared.body).flags as { sku: string | null; poLineItemId: string | null }[]).find(
      (flag) => flag.sku === 'A1',
    )!
    const poLineItemId = a1.poLineItemId!

    // PO-line scope only: the flag row's own link also passes invoiceLineItemId
    // and the list then shows nothing (bug B12, fixed in its own slice).
    await page.goto(`/workspaces/${ws}/catalog-matches?poLineItemId=${poLineItemId}`)
    await page.getByRole('button', { name: 'Search all vendors' }).click()
    await expect(toast(page, 'Search complete')).toBeVisible()
    const summary = await page.getByText(/^\d+ match(es)? found\.$/).textContent()
    const found = Number(summary!.split(' ')[0])
    // 1 on a clean run: catalog.csv holds the only A1 item in workspace B. Kept
    // relative so a CI retry (retries: 1, same database) stays exact.
    expect(found).toBeGreaterThan(0)

    const dismissButtons = page.getByRole('button', { name: /^Dismiss match / })
    await expect(dismissButtons).toHaveCount(found)
    await expect(page.getByText('E2E stub match', { exact: true })).toHaveCount(found)

    const matchId = (await dismissButtons.first().getAttribute('aria-label'))!.replace('Dismiss match ', '')
    await dismissButtons.first().click()
    await expect(toast(page, 'Match dismissed')).toBeVisible()

    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('open')
    await expect(page.getByText('E2E stub match', { exact: true })).toHaveCount(found - 1)
    const open = JSON.parse(
      (await bff(page, `/api/workspaces/${ws}/catalog-matches?status=open&poLineItemId=${poLineItemId}`)).body,
    ) as { id: string }[]
    expect(open.map((match) => match.id)).not.toContain(matchId)
    expect(open).toHaveLength(found - 1)
    await page.context().close()
  })
})
