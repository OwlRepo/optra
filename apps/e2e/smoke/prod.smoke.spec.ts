import { expect, test, type Page } from '@playwright/test'
import { uploadKnowledgeBaseDocument, uploadPurchaseOrder } from '../support/flows'
import type { Owner } from '../support/state'
import { bff, chooseFile, download, fixture, rowFor, toast, waitForRow, wrongType } from '../support/ui'

// Proves the storage paths on the LIVE site, against the real object store.
// One login for the whole file (the login limit is shared site-wide), then
// each test writes, reads back and - where the product allows - deletes.
//
// What a run leaves behind: one purchase order (there is no delete for one in
// the product) named smoke-<run>.csv. Everything else it creates, it deletes.
// See docs/ops/prod-smoke.md.

test.describe.configure({ mode: 'serial' })

const run = `smoke-${Date.now().toString(36)}`
let page: Page
let smoke: Owner

function rowsOf<T>(body: string): T[] {
  const parsed = JSON.parse(body)
  return Array.isArray(parsed) ? parsed : (parsed.items ?? [])
}

async function findOrCreate(listUrl: string, name: string): Promise<string> {
  const existing = rowsOf<{ id: string; name: string }>((await bff(page, listUrl)).body).find(
    (row) => row.name === name,
  )
  if (existing) return existing.id
  const created = await bff(page, listUrl, { method: 'POST', json: { name } })
  expect(created.status, `create ${name}`).toBe(201)
  return JSON.parse(created.body).id
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.goto('/login')
  await page.locator('#email').fill(process.env.SMOKE_EMAIL!)
  await page.locator('#password').fill(process.env.SMOKE_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}\//)

  const workspaceId = new URL(page.url()).pathname.split('/')[2]
  smoke = {
    email: process.env.SMOKE_EMAIL!,
    password: '',
    userId: '',
    workspaceId,
    knowledgeBaseId: await findOrCreate(`/api/workspaces/${workspaceId}/knowledge-bases`, 'Smoke KB'),
    vendorId: await findOrCreate(`/api/workspaces/${workspaceId}/vendors`, 'Smoke Vendor'),
  }
})

test.afterAll(async () => {
  await page?.close()
})

test('a file type the product cannot read is refused before anything is stored', async () => {
  await page.goto(`/workspaces/${smoke.workspaceId}/knowledge-bases/${smoke.knowledgeBaseId}`)
  await page.getByLabel('Upload document').setInputFiles(wrongType(`${run}.exe`))
  await expect(toast(page, 'Upload failed')).toBeVisible()
  await expect(page.getByText('Unsupported file type')).toBeVisible()
})

test('a knowledge-base document round-trips through object storage and leaves with its row', async () => {
  const name = `${run}.md`
  const file = fixture('kb-note.md', name)
  const id = await uploadKnowledgeBaseDocument(page, smoke, name)
  const downloadUrl = `/api/workspaces/${smoke.workspaceId}/knowledge-bases/${smoke.knowledgeBaseId}/documents/${id}/download`

  const got = await download(page, () =>
    rowFor(page, name).getByRole('button', { name: `Download ${name}` }).click(),
  )
  expect(got.bytes.equals(file.buffer), 'the bytes that came back are the bytes that went in').toBe(true)

  const headers = (await bff(page, downloadUrl)).headers
  expect(headers['content-type']).toBe('application/octet-stream')
  expect(headers['x-content-type-options']).toBe('nosniff')

  await rowFor(page, name).getByRole('button', { name: `Delete ${name}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete document' }).click()
  await expect(toast(page, 'Document deleted')).toBeVisible()
  expect((await bff(page, downloadUrl)).status, 'gone after delete').toBe(404)
})

test('a dataset is stored, profiled and deleted', async () => {
  const file = fixture('dataset.csv', `${run}.csv`)
  await page.goto(`/workspaces/${smoke.workspaceId}/datasets`)
  await chooseFile(page, 'Upload dataset', file)
  await expect(toast(page, 'Dataset uploaded')).toBeVisible()
  await waitForRow<{ name: string; status: string }>(
    page,
    `/api/workspaces/${smoke.workspaceId}/datasets`,
    (row) => row.name === file.name,
    'done',
    90_000,
  )

  await page.getByRole('button', { name: `Delete ${file.name}` }).click()
  await expect(toast(page, 'Dataset deleted')).toBeVisible()
})

test('a purchase order uploads, parses, and its source downloads byte-for-byte', async () => {
  const name = `${run}.csv`
  const file = fixture('po.csv', name)
  await uploadPurchaseOrder(page, smoke, name)

  await expect(rowFor(page, name).getByText('Ready')).toBeVisible()
  const got = await download(page, () =>
    rowFor(page, name).getByRole('button', { name: `Download ${name}` }).click(),
  )
  expect(got.bytes.equals(file.buffer)).toBe(true)
})

test('a catalog photo is served from object storage as an image', async () => {
  const itemId = process.env.SMOKE_CATALOG_ITEM_ID
  test.skip(!itemId, 'set SMOKE_CATALOG_ITEM_ID to an item with a photo - see docs/ops/prod-smoke.md')

  const photo = await bff(page, `/api/workspaces/${smoke.workspaceId}/catalog-items/${itemId}/photo`)
  expect(photo.status).toBe(200)
  expect(photo.headers['content-type']).toMatch(/^image\/(png|jpeg|webp|gif|avif)$/)
  expect(photo.headers['x-content-type-options']).toBe('nosniff')
})

test('without a session every stored-file route is a 401', async ({ browser }) => {
  const stranger = await browser.newPage()
  await stranger.goto('/login')
  const ws = smoke.workspaceId
  for (const url of [
    `/api/workspaces/${ws}/procurement/purchase-orders/00000000-0000-4000-8000-000000000000/download`,
    `/api/workspaces/${ws}/knowledge-bases/${smoke.knowledgeBaseId}/documents/00000000-0000-4000-8000-000000000000/download`,
    `/api/workspaces/${ws}/catalog-items/00000000-0000-4000-8000-000000000000/photo`,
  ]) {
    expect((await bff(stranger, url)).status, url).toBe(401)
  }
  await stranger.close()
})
