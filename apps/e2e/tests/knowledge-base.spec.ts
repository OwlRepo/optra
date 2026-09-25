import { expect, test, type Page } from '@playwright/test'
import { closeDb, rowExists, storageKeyOf } from '../support/db'
import { objectExists } from '../support/s3'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { bff, download, fixture, toast, waitForRow, type FilePayload, rowFor } from '../support/ui'

// Knowledge-base documents are the one storage path with the whole lifecycle
// in the UI: upload, ingest, single and bulk download, delete. Ingest embeds
// through the OpenAI stub, so a document reaches `done` exactly as it would in
// production.

test.describe.configure({ mode: 'serial' })
test.use({ storageState: storageStateFor('ownerA') })

let state: SeedState

test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

const kbPage = () => `/workspaces/${state.ownerA.workspaceId}/knowledge-bases/${state.ownerA.knowledgeBaseId}`
const documentsUrl = () =>
  `/api/workspaces/${state.ownerA.workspaceId}/knowledge-bases/${state.ownerA.knowledgeBaseId}/documents?pageSize=100`

type DocumentRow = { id: string; title: string; status: string }

async function uploadAndIngest(page: Page, file: FilePayload): Promise<DocumentRow> {
  await page.getByLabel('Upload document').setInputFiles(file)
  await expect(toast(page, 'Upload started')).toBeVisible()
  return waitForRow<DocumentRow>(page, documentsUrl(), (row) => row.title === file.name, 'done')
}

test('a document uploads, is ingested, and downloads byte-for-byte', async ({ page }) => {
  const file = fixture('kb-note.md', `note-${state.run}.md`)
  await page.goto(kbPage())
  const document = await uploadAndIngest(page, file)

  const key = await storageKeyOf('documents', document.id)
  expect(await objectExists(key!)).toBe(true)

  const row = rowFor(page, file.name)
  await expect(row.getByText('done')).toBeVisible()
  const got = await download(page, () => row.getByRole('button', { name: `Download ${file.name}` }).click())
  expect(got.filename).toBe(file.name)
  expect(got.bytes.equals(file.buffer)).toBe(true)
})

test('"Download selected" returns one zip holding every selected file', async ({ page }) => {
  const first = fixture('kb-note.md', `zip-a-${state.run}.md`)
  const second = fixture('kb-note-2.md', `zip-b-${state.run}.md`)
  await page.goto(kbPage())
  await uploadAndIngest(page, first)
  await uploadAndIngest(page, second)

  await page.getByLabel(`Select ${first.name}`).check()
  await page.getByLabel(`Select ${second.name}`).check()
  const got = await download(page, () => page.getByRole('button', { name: 'Download selected' }).click())

  expect(got.filename).toBe('documents.zip')
  expect(got.bytes.subarray(0, 4).toString('binary'), 'a zip local-file header').toBe('PK\x03\x04')
  // Stored names sit uncompressed in the zip's headers.
  expect(got.bytes.includes(Buffer.from(first.name))).toBe(true)
  expect(got.bytes.includes(Buffer.from(second.name))).toBe(true)
})

test('an HTML document downloads as an inert attachment, never inline', async ({ page }) => {
  // The file contains a <script>. Served inline from our own origin it would
  // run with the user's session - the reason these headers exist.
  const file = fixture('kb-page.html', `page-${state.run}.html`)
  await page.goto(kbPage())
  const document = await uploadAndIngest(page, file)

  const response = await bff(
    page,
    `/api/workspaces/${state.ownerA.workspaceId}/knowledge-bases/${state.ownerA.knowledgeBaseId}/documents/${document.id}/download`,
  )
  expect(response.status).toBe(200)
  expect(response.headers['content-type']).toBe('application/octet-stream')
  expect(response.headers['content-disposition']).toBe(`attachment; filename="${file.name}"`)
  expect(response.body).toBe(file.buffer.toString('utf8'))
})

test('deleting a document removes its row and its stored file', async ({ page }) => {
  const file = fixture('kb-note.md', `delete-${state.run}.md`)
  await page.goto(kbPage())
  const document = await uploadAndIngest(page, file)
  const key = await storageKeyOf('documents', document.id)
  expect(await objectExists(key!)).toBe(true)

  await page.getByRole('button', { name: `Delete ${file.name}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete document' }).click()
  await expect(toast(page, 'Document deleted')).toBeVisible()
  await expect(rowFor(page, file.name)).toHaveCount(0)

  expect(await rowExists('documents', document.id)).toBe(false)
  expect(await objectExists(key!), 'the object left storage with the row').toBe(false)
})

test('a file type the knowledge base cannot read is refused', async ({ page }) => {
  await page.goto(kbPage())
  await page.getByLabel('Upload document').setInputFiles({
    name: `payload-${state.run}.exe`,
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from('MZ'),
  })
  await expect(toast(page, 'Upload failed')).toBeVisible()
  await expect(page.getByText('Unsupported file type')).toBeVisible()
})
