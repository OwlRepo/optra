import { expect, test } from '@playwright/test'
import { closeDb, rowExists, storageKeyOf } from '../support/db'
import { objectExists } from '../support/s3'
import { loadState, storageStateFor, type SeedState } from '../support/state'
import { chooseFile, fixture, toast, waitForRow, wrongType } from '../support/ui'

// Datasets are stored, profiled from storage by a Bull job, and deleted with
// their object - there is no download in the UI, so the object itself is the
// evidence.

test.describe.configure({ mode: 'serial' })
test.use({ storageState: storageStateFor('ownerA') })

let state: SeedState

test.beforeAll(() => {
  state = loadState()
})
test.afterAll(closeDb)

const datasetsPage = () => `/workspaces/${state.ownerA.workspaceId}/datasets`
const datasetsUrl = () => `/api/workspaces/${state.ownerA.workspaceId}/datasets`

test('a CSV dataset is stored, profiled, and deleted together with its file', async ({ page }) => {
  const file = fixture('dataset.csv', `sales-${state.run}.csv`)
  await page.goto(datasetsPage())
  await chooseFile(page, 'Upload dataset', file)
  await expect(toast(page, 'Dataset uploaded')).toBeVisible()

  const dataset = await waitForRow<{ id: string; name: string; status: string }>(
    page,
    datasetsUrl(),
    (row) => row.name === file.name,
    'done',
  )
  const key = await storageKeyOf('datasets', dataset.id)
  expect(await objectExists(key!)).toBe(true)

  const row = page.getByText(file.name, { exact: true })
  await expect(row).toBeVisible()
  await expect(page.getByText('Ready').first()).toBeVisible()

  await page.getByRole('button', { name: `Delete ${file.name}` }).click()
  await expect(toast(page, 'Dataset deleted')).toBeVisible()
  await expect(page.getByText(file.name, { exact: true })).toHaveCount(0)

  expect(await rowExists('datasets', dataset.id)).toBe(false)
  expect(await objectExists(key!), 'the object left storage with the row').toBe(false)
})

test('a file that is not CSV or XLSX is refused with the reason', async ({ page }) => {
  await page.goto(datasetsPage())
  await chooseFile(page, 'Upload dataset', wrongType(`notes-${state.run}.exe`))

  await expect(toast(page, 'Upload failed')).toBeVisible()
  await expect(page.getByText('Only CSV or XLSX files are supported for datasets')).toBeVisible()
})
