import { expect, type Page } from '@playwright/test'
import { photoKeysOfCatalog } from './db'
import type { Owner } from './state'
import { chooseFile, fixture, toast, waitForRow } from './ui'

// Multi-step flows more than one spec needs, done through the UI exactly as
// the dedicated specs do them. Each returns the id of what it created.

export async function uploadPurchaseOrder(page: Page, owner: Owner, fileName: string): Promise<string> {
  const file = fixture('po.csv', fileName)
  await page.goto(`/workspaces/${owner.workspaceId}/procurement`)
  await chooseFile(page, 'Upload purchase order', file)
  const dialog = page.getByRole('dialog')
  await dialog.locator('#po-vendor').selectOption(owner.vendorId)
  await dialog.locator('#po-number').fill(fileName.replace(/\.csv$/, '').toUpperCase())
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(toast(page, 'Purchase order uploaded')).toBeVisible()
  const row = await waitForRow<{ id: string; name: string; status: string }>(
    page,
    `/api/workspaces/${owner.workspaceId}/procurement/purchase-orders`,
    (candidate) => candidate.name === file.name,
    'done',
  )
  return row.id
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
