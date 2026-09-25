import { expect, test, type Browser, type Page } from '@playwright/test'
import { closeDb, photoKeysOfWorkspace } from '../support/db'
import { loadState, storageStateFor, type Role, type SeedState } from '../support/state'
import { bff, chooseFile, fixture, toast, waitForRow } from '../support/ui'

// Workspace isolation on every route that serves stored bytes. Owner A creates
// one of each; then owner B - who owns a different workspace - and member A -
// who can read A but not write it - probe them through the real BFF.
//
// The rule being proven: tenant scoping is on the ROW, and a miss is a 404,
// never a 403, so an id from another workspace cannot even be confirmed to
// exist.

test.describe.configure({ mode: 'serial' })

let state: SeedState
const ids = { purchaseOrder: '', document: '', catalogItem: '' }

async function pageAs(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(role) })
  return context.newPage()
}

test.beforeAll(async ({ browser }) => {
  state = loadState()
  const page = await pageAs(browser, 'ownerA')
  const ws = state.ownerA.workspaceId

  const po = fixture('po.csv', `access-po-${state.run}.csv`)
  await page.goto(`/workspaces/${ws}/procurement`)
  await chooseFile(page, 'Upload purchase order', po)
  const dialog = page.getByRole('dialog')
  await dialog.locator('#po-vendor').selectOption(state.ownerA.vendorId)
  await dialog.locator('#po-number').fill(`PO-ACCESS-${state.run}`)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Purchase order uploaded')).toBeVisible()
  ids.purchaseOrder = (
    await waitForRow<{ id: string; name: string; status: string }>(
      page,
      `/api/workspaces/${ws}/procurement/purchase-orders`,
      (row) => row.name === po.name,
      'done',
    )
  ).id

  const note = fixture('kb-note.md', `access-${state.run}.md`)
  await page.goto(`/workspaces/${ws}/knowledge-bases/${state.ownerA.knowledgeBaseId}`)
  await page.getByLabel('Upload document').setInputFiles(note)
  ids.document = (
    await waitForRow<{ id: string; title: string; status: string }>(
      page,
      `/api/workspaces/${ws}/knowledge-bases/${state.ownerA.knowledgeBaseId}/documents?pageSize=100`,
      (row) => row.title === note.name,
      'done',
    )
  ).id

  const catalog = fixture('catalog.pdf', `access-catalog-${state.run}.pdf`)
  await page.goto(`/workspaces/${ws}/vendors/${state.ownerA.vendorId}`)
  await chooseFile(page, 'Upload catalog', catalog)
  await waitForRow<{ name: string; status: string }>(
    page,
    `/api/workspaces/${ws}/vendors/${state.ownerA.vendorId}/catalogs`,
    (row) => row.name === catalog.name,
    'done',
  )
  ids.catalogItem = (await photoKeysOfWorkspace(ws))[0].id

  await page.context().close()
})
test.afterAll(closeDb)

test('owner A can read all three, which is what makes the probes below meaningful', async ({ browser }) => {
  const page = await pageAs(browser, 'ownerA')
  await page.goto('/')
  const ws = state.ownerA.workspaceId
  for (const url of [
    `/api/workspaces/${ws}/procurement/purchase-orders/${ids.purchaseOrder}/download`,
    `/api/workspaces/${ws}/knowledge-bases/${state.ownerA.knowledgeBaseId}/documents/${ids.document}/download`,
    `/api/workspaces/${ws}/catalog-items/${ids.catalogItem}/photo`,
  ]) {
    expect((await bff(page, url)).status, url).toBe(200)
  }
})

test("another workspace's ids are a 404 on every stored-file route, even in the prober's own workspace", async ({
  browser,
}) => {
  const page = await pageAs(browser, 'ownerB')
  await page.goto('/')
  const ws = state.ownerB.workspaceId
  for (const url of [
    `/api/workspaces/${ws}/procurement/purchase-orders/${ids.purchaseOrder}/download`,
    `/api/workspaces/${ws}/knowledge-bases/${state.ownerB.knowledgeBaseId}/documents/${ids.document}/download`,
    `/api/workspaces/${ws}/catalog-items/${ids.catalogItem}/photo`,
  ]) {
    expect((await bff(page, url)).status, url).toBe(404)
  }
})

test("a stranger addressing workspace A directly is refused before any row is read", async ({ browser }) => {
  const page = await pageAs(browser, 'ownerB')
  await page.goto('/')
  const ws = state.ownerA.workspaceId
  for (const url of [
    `/api/workspaces/${ws}/procurement/purchase-orders/${ids.purchaseOrder}/download`,
    `/api/workspaces/${ws}/knowledge-bases/${state.ownerA.knowledgeBaseId}/documents/${ids.document}/download`,
    `/api/workspaces/${ws}/catalog-items/${ids.catalogItem}/photo`,
  ]) {
    expect((await bff(page, url)).status, url).toBe(403)
  }
})

test('a member can download but cannot upload', async ({ browser }) => {
  const page = await pageAs(browser, 'memberA')
  const ws = state.memberA.workspaceId
  await page.goto(`/workspaces/${ws}/procurement`)
  await expect(page.getByRole('heading', { name: 'Uploaded purchase orders' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload purchase order' })).toHaveCount(0)

  expect(
    (await bff(page, `/api/workspaces/${ws}/procurement/purchase-orders/${ids.purchaseOrder}/download`)).status,
  ).toBe(200)

  // The hidden button is a courtesy; the API is the guard.
  const status = await page.evaluate(async (url) => {
    const form = new FormData()
    form.append('file', new Blob(['sku,qty\nA1,1\n'], { type: 'text/csv' }), 'member.csv')
    return (await fetch(url, { method: 'POST', body: form, credentials: 'same-origin' })).status
  }, `/api/workspaces/${ws}/procurement/purchase-orders`)
  expect(status).toBe(403)
})

test('no session: every stored-file route answers 401', async ({ page }) => {
  await page.goto('/login')
  const ws = state.ownerA.workspaceId
  for (const url of [
    `/api/workspaces/${ws}/procurement/purchase-orders/${ids.purchaseOrder}/download`,
    `/api/workspaces/${ws}/knowledge-bases/${state.ownerA.knowledgeBaseId}/documents/${ids.document}/download`,
    `/api/workspaces/${ws}/catalog-items/${ids.catalogItem}/photo`,
  ]) {
    expect((await bff(page, url)).status, url).toBe(401)
  }
})
