import { expect, test } from '@playwright/test'
import { closeDb, storageKeyOf } from '../support/db'
import { uploadCatalogWithPhoto, uploadKnowledgeBaseDocument, uploadPurchaseOrder } from '../support/flows'
import { removeObject } from '../support/s3'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { bff, toast } from '../support/ui'

// What the product does when a row says there is a file and storage says there
// is not - deleted by hand, lost with a bucket, never copied across (exactly
// what happened to six dummy files in the 2026-09-25 move to Backblaze B2).
// Each test uploads through the UI, removes the object behind the product's
// back, and asks for it again.
//
// Runs as owner B: no other spec writes to workspace B, so removing an object
// here can never pull a file out from under a spec running in parallel.

test.describe.configure({ mode: 'serial' })
test.use({ storageState: storageStateFor('ownerB') })

let state: SeedState

test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

test('a purchase order whose file vanished is a 404 with a reason, and the page says so', async ({ page }) => {
  const name = `gone-po-${state.run}.csv`
  const id = await uploadPurchaseOrder(page, state.ownerB, name)
  await removeObject((await storageKeyOf('purchase_orders', id))!)

  const response = await bff(
    page,
    `/api/workspaces/${state.ownerB.workspaceId}/procurement/purchase-orders/${id}/download`,
  )
  expect(response.status).toBe(404)
  expect(JSON.parse(response.body).message).toBe('Purchase order file is missing')
  expect(response.body, 'the storage key stays inside the API').not.toContain('/procurement/')

  await page.getByRole('button', { name: `Download ${name}` }).click()
  await expect(toast(page, 'Failed to download document')).toBeVisible()
})

test('a knowledge-base document whose file vanished is a 404 with a reason', async ({ page }) => {
  const id = await uploadKnowledgeBaseDocument(page, state.ownerB, `gone-${state.run}.md`)
  await removeObject((await storageKeyOf('documents', id))!)

  const response = await bff(
    page,
    `/api/workspaces/${state.ownerB.workspaceId}/knowledge-bases/${state.ownerB.knowledgeBaseId}/documents/${id}/download`,
  )
  expect(response.status).toBe(404)
  expect(JSON.parse(response.body).message).toBe('Document file is missing')
})

test('a catalog photo whose object vanished is a 404 with a reason', async ({ page }) => {
  const { itemId, photoKey } = await uploadCatalogWithPhoto(page, state.ownerB, `gone-catalog-${state.run}.pdf`)
  await removeObject(photoKey)

  const response = await bff(page, `/api/workspaces/${state.ownerB.workspaceId}/catalog-items/${itemId}/photo`)
  expect(response.status).toBe(404)
  expect(JSON.parse(response.body).message).toBe('Catalog item photo is missing')
})

test('a malformed id is a 400 on every stored-file route, never a 500', async ({ page }) => {
  await page.goto('/')
  const ws = state.ownerB.workspaceId
  for (const url of [
    `/api/workspaces/${ws}/procurement/purchase-orders/not-a-uuid/download`,
    `/api/workspaces/${ws}/knowledge-bases/${state.ownerB.knowledgeBaseId}/documents/not-a-uuid/download`,
    `/api/workspaces/${ws}/knowledge-bases/not-a-uuid/documents/00000000-0000-4000-8000-000000000000/download`,
    `/api/workspaces/${ws}/catalog-items/not-a-uuid/photo`,
  ]) {
    expect((await bff(page, url)).status, url).toBe(400)
  }
})
