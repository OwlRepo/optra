import { expect, test } from '@playwright/test'
import { closeDb, photoKeysOfCatalog, storageKeyOf } from '../support/db'
import { objectExists } from '../support/s3'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { bff, chooseFile, fixture, toast, waitForRow, wrongType } from '../support/ui'

// A PDF catalog is the only way an item photo reaches storage in this suite:
// the parser renders each page to PNG, stores it, and the (stubbed) vision
// model's items point at that page. A CSV `photo_url` cannot be used - the
// SSRF guard refuses localhost, correctly, and there is no bypass.

test.describe.configure({ mode: 'serial' })
test.use({ storageState: storageStateFor('ownerA') })

let state: SeedState

test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

const vendorPage = () => `/workspaces/${state.ownerA.workspaceId}/vendors/${state.ownerA.vendorId}`
const catalogsUrl = () =>
  `/api/workspaces/${state.ownerA.workspaceId}/vendors/${state.ownerA.vendorId}/catalogs`

test('a PDF catalog parses into items whose photos render from storage', async ({ page }) => {
  const file = fixture('catalog.pdf', `catalog-${state.run}.pdf`)
  await page.goto(vendorPage())
  await chooseFile(page, 'Upload catalog', file)
  await expect(toast(page, 'Catalog uploaded')).toBeVisible()

  const catalog = await waitForRow<{ id: string; name: string; status: string }>(
    page,
    catalogsUrl(),
    (row) => row.name === file.name,
    'done',
  )
  const key = await storageKeyOf('catalogs', catalog.id)
  expect(await objectExists(key!), 'the uploaded PDF is in storage').toBe(true)
  const photos = await photoKeysOfCatalog(catalog.id)
  expect(photos.length, 'the parser stored a page image for the items').toBeGreaterThan(0)
  expect(await objectExists(photos[0].key)).toBe(true)

  // The vendor page does not poll; a person reloads.
  await page.reload()
  const row = page.getByRole('row').filter({ hasText: file.name })
  await expect(row.getByText('Ready')).toBeVisible()
  await row.getByRole('button', { name: 'View items' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('photo-grid-tile')).toHaveCount(2)
  const image = dialog.locator('img').first()
  await image.scrollIntoViewIfNeeded()
  // Decoded, not merely requested: a broken or non-image body leaves 0.
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)

  const photo = await bff(page, (await image.getAttribute('src'))!)
  expect(photo.status).toBe(200)
  expect(photo.headers['content-type']).toBe('image/png')
  expect(photo.headers['cache-control']).toContain('private')
})

test('a catalog file of the wrong type is refused with the reason', async ({ page }) => {
  await page.goto(vendorPage())
  await chooseFile(page, 'Upload catalog', wrongType(`catalog-${state.run}.exe`))

  await expect(toast(page, 'Upload failed')).toBeVisible()
  await expect(page.getByText('Only PDF, CSV, or XLSX files are supported')).toBeVisible()
})
