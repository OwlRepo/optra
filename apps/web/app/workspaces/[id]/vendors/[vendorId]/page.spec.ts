/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import VendorDetailPage from './page'
import { WorkspaceProvider } from '@/components/workspace-context'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listVendorsMock = vi.fn()
const getVendorMock = vi.fn()
const listVendorPriceHistoryMock = vi.fn()
const getVendorExceptionSummaryMock = vi.fn()
const listCatalogsMock = vi.fn()
const uploadCatalogMock = vi.fn()
const scrapeCatalogMock = vi.fn()
const listCatalogItemsMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/vendors/vendor-1',
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}))

vi.mock('@/lib/api/catalog', () => ({
  listVendors: (...args: unknown[]) => listVendorsMock(...args),
  getVendor: (...args: unknown[]) => getVendorMock(...args),
  listVendorPriceHistory: (...args: unknown[]) => listVendorPriceHistoryMock(...args),
  getVendorExceptionSummary: (...args: unknown[]) => getVendorExceptionSummaryMock(...args),
  listCatalogs: (...args: unknown[]) => listCatalogsMock(...args),
  uploadCatalog: (...args: unknown[]) => uploadCatalogMock(...args),
  scrapeCatalog: (...args: unknown[]) => scrapeCatalogMock(...args),
  listCatalogItems: (...args: unknown[]) => listCatalogItemsMock(...args),
  catalogItemPhotoUrl: (workspaceId: string, itemId: string) =>
    `/api/workspaces/${workspaceId}/catalog-items/${itemId}/photo`,
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

const vendor = { id: 'vendor-1', name: 'Acme Supplies', contactInfo: 'orders@acme.com', createdAt: '2026-07-01T00:00:00.000Z' }

const readyCatalog = {
  id: 'cat-1',
  name: 'Spring price list',
  sourceKind: 'pdf',
  status: 'done',
  rowCount: 120,
  lastError: null,
  createdAt: '2026-07-01T00:00:00.000Z',
}

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(WorkspaceProvider, { workspaceId: 'ws-1' }, React.createElement(VendorDetailPage, { params: { id: 'ws-1', vendorId: 'vendor-1' } })),
    ),
  )
}

describe('VendorDetailPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listVendorsMock.mockReset()
    getVendorMock.mockReset()
    listVendorPriceHistoryMock.mockReset()
    getVendorExceptionSummaryMock.mockReset()
    listCatalogsMock.mockReset()
    uploadCatalogMock.mockReset()
    scrapeCatalogMock.mockReset()
    listCatalogItemsMock.mockReset()
    logoutMock.mockReset()

    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    listVendorsMock.mockResolvedValue([vendor])
    getVendorMock.mockResolvedValue(vendor)
    listVendorPriceHistoryMock.mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0, skus: [] })
    getVendorExceptionSummaryMock.mockResolvedValue({ counts: {}, openTotal: 0, purchaseOrderCount: 0 })
    listCatalogsMock.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('error: shows an error toast when catalog upload fails', async () => {
    uploadCatalogMock.mockRejectedValue({ message: 'Catalog uploads are not enabled for this workspace' })

    renderPage()
    await screen.findByText('No catalogs yet')

    const file = new File(['%PDF-1.4'], 'sales.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Upload failed')).toBeDefined()
      expect(screen.getByText('Catalog uploads are not enabled for this workspace')).toBeDefined()
    })
  })

  it('error: shows an error toast when starting a scrape fails', async () => {
    scrapeCatalogMock.mockRejectedValue({ message: 'Scraping is not enabled for this workspace' })

    renderPage()
    await screen.findByText('No catalogs yet')

    fireEvent.click(screen.getAllByRole('button', { name: 'Scrape website' })[0] as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://acme.example.com/catalog' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start scrape' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to start scrape')).toBeDefined()
      expect(screen.getByText('Scraping is not enabled for this workspace')).toBeDefined()
    })
  })

  it('error: redirects to login when loading the vendor returns unauthorized', async () => {
    listCatalogsMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  // [RED] rewritten probe: C-0 skeletons no longer carry bg-secondary.
  it('edge: shows the catalog skeleton as a busy region until catalogs resolve', async () => {
    let resolveCatalogs: (value: unknown) => void = () => {}
    listCatalogsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalogs = resolve
      }),
    )

    const { container } = renderPage()

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    resolveCatalogs([])
    await screen.findByText('No catalogs yet')
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('edge: keeps Start scrape disabled until the seed URL looks valid', async () => {
    renderPage()
    await screen.findByText('No catalogs yet')

    fireEvent.click(screen.getAllByRole('button', { name: 'Scrape website' })[0] as HTMLButtonElement)
    const startButton = screen.getByRole('button', { name: 'Start scrape' }) as HTMLButtonElement
    expect(startButton.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'not-a-url' } })
    expect(startButton.disabled).toBe(true)
    expect(screen.getByText('Enter a valid URL starting with http:// or https://')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://acme.example.com' } })
    expect(startButton.disabled).toBe(false)
  })

  it('edge: hides upload/scrape actions for members and shows them for owner/admin', async () => {
    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'member' })

    const view = renderPage()

    expect(await screen.findByText('No catalogs yet')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Upload catalog' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Scrape website' })).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()

    view.unmount()

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'admin' })
    renderPage()

    expect((await screen.findAllByRole('button', { name: 'Upload catalog' })).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Scrape website' }).length).toBeGreaterThan(0)
  })

  // [RED] no "Price history" label exists today.
  it('edge: says nothing has been bought yet, under the Price history section and label', async () => {
    renderPage()

    expect(await screen.findByText('Nothing bought from this vendor yet')).toBeTruthy()
    expect(screen.getByText('Upload a purchase order against them and its prices will show up here.')).toBeTruthy()
    expect(screen.getAllByText('Price history')).toHaveLength(2)
  })

  // [RED] ranges live in the label sentence today.
  it('edge: the scrape modal puts depth and pages on one row with their ranges as a muted suffix', async () => {
    renderPage()
    await screen.findByText('No catalogs yet')

    fireEvent.click(screen.getAllByRole('button', { name: 'Scrape website' })[0] as HTMLButtonElement)

    expect(screen.getByLabelText('Max depth')).toBeDefined()
    expect(screen.getByLabelText('Max pages')).toBeDefined()
    expect(screen.getByText('0–5')).toBeDefined()
    expect(screen.getByText('1–2000')).toBeDefined()
    expect(screen.getByText('Both optional. The catalog fills in once the crawl finishes.')).toBeDefined()
    expect(screen.queryByText(/optional, 0-5/)).toBeNull()
    // C-3 #15: placeholders state the API's real defaults.
    expect(screen.getByLabelText('Max depth').getAttribute('placeholder')).toBe('3')
    expect(screen.getByLabelText('Max pages').getAttribute('placeholder')).toBe('500')
    expect(screen.getByText('Catalog source')).toBeDefined()
  })

  // [RED] amber 3.5: the two tables had no headers.
  it('regression: names the two sections "Price history" and "Catalogs"', async () => {
    renderPage()
    await screen.findByText('No catalogs yet')

    expect(screen.getByRole('heading', { level: 2, name: 'What this vendor has charged' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'What they say they sell' })).toBeDefined()
    expect(screen.getByText('Catalogs')).toBeDefined()
    expect(screen.getAllByText('Price history').length).toBeGreaterThan(0)
  })

  // [RED] amber 3.5: the page had no way back.
  it('regression: the breadcrumb links back to the Vendors list', async () => {
    renderPage()
    await screen.findByText('No catalogs yet')

    const back = screen.getAllByRole('link', { name: 'Vendors' }).filter((link) => link.closest('aside') === null)
    expect(back).toHaveLength(1)
    expect(back[0]?.getAttribute('href')).toBe('/workspaces/ws-1/vendors')
  })

  // [RED] Upload catalog comes first today.
  it('regression: header actions read secondary then primary, Scrape website before Upload catalog', async () => {
    listCatalogsMock.mockResolvedValue([readyCatalog])

    renderPage()
    await screen.findByText('Spring price list')

    const scrape = screen.getAllByRole('button', { name: 'Scrape website' })[0] as HTMLButtonElement
    const upload = screen.getAllByRole('button', { name: 'Upload catalog' })[0] as HTMLButtonElement
    expect(scrape.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // [RED] C-3 #11: caption is two lines under the photo (Mono SKU + description), plus the loaded count.
  it('regression: catalog items show the SKU in Mono with the description under each photo, and the loaded count', async () => {
    listCatalogsMock.mockResolvedValue([{ ...readyCatalog, rowCount: 2 }])
    listCatalogItemsMock.mockResolvedValue([
      { id: 'item-1', sku: 'SKU-1', description: 'Widget, 10-pack', photoStorageKey: 'catalogs/cat-1/item-1.jpg', sourcePageNumber: 1 },
      { id: 'item-2', sku: 'SKU-2', description: 'Gadget, single', photoStorageKey: null, sourcePageNumber: 2 },
    ])

    renderPage()
    await screen.findByText('Spring price list')

    fireEvent.click(screen.getByRole('button', { name: 'View items' }))

    await waitFor(() => {
      expect(listCatalogItemsMock).toHaveBeenCalledWith('ws-1', 'vendor-1', 'cat-1')
      expect(screen.getByText('Widget, 10-pack')).toBeDefined()
      expect(screen.getByText('Gadget, single')).toBeDefined()
    })
    expect(screen.getByText('SKU-1').className).toContain('font-mono')
    expect(screen.getByText('SKU-2').className).toContain('font-mono')
    expect(screen.getByText('2 items')).toBeDefined()
    // item-1 has a stored photo, so it renders an <img> pointed at the auth
    // proxy; only item-2 (photoStorageKey null) keeps the fallback tile.
    expect(document.querySelectorAll('[data-testid="image-tile-fallback"]').length).toBe(1)
    const photo = document.querySelector('img[alt="SKU-1"]')
    expect(photo?.getAttribute('src')).toBe('/api/workspaces/ws-1/catalog-items/item-1/photo')
  })

  it('happy: renders the empty state copy and the vendor header', async () => {
    renderPage()

    expect(await screen.findByText('No catalogs yet')).toBeDefined()
    expect(screen.getByText("Upload a catalog file or scrape the vendor's website to build one.")).toBeDefined()
    expect(screen.getByText('Acme Supplies')).toBeDefined()
    expect(screen.getByText('orders@acme.com')).toBeDefined()
  })

  it('happy: renders catalogs with source and status badges, row counts and the inline error', async () => {
    listCatalogsMock.mockResolvedValue([
      readyCatalog,
      {
        id: 'cat-2',
        name: 'Website crawl',
        sourceKind: 'scrape',
        status: 'failed',
        rowCount: null,
        lastError: 'Timed out fetching seed URL',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    ])

    renderPage()

    expect(await screen.findByText('Spring price list')).toBeDefined()
    expect(screen.getByText('120')).toBeDefined()
    expect(screen.getByText('Ready')).toBeDefined()
    expect(screen.getByText('Website crawl')).toBeDefined()
    expect(screen.getByText('Failed')).toBeDefined()
    expect(screen.getByText('Timed out fetching seed URL')).toBeDefined()
    expect(screen.getAllByText('Upload').length).toBeGreaterThan(0)
    expect(screen.getByText('Scrape')).toBeDefined()
  })

  it('happy: uploads a selected catalog file, toasts success and refreshes the list', async () => {
    uploadCatalogMock.mockResolvedValue({ id: 'cat-1', name: 'sales.pdf', status: 'pending' })

    renderPage()
    await screen.findByText('No catalogs yet')

    const file = new File(['%PDF-1.4'], 'sales.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadCatalogMock).toHaveBeenCalledWith('ws-1', 'vendor-1', file)
      expect(screen.getByText('Catalog uploaded')).toBeDefined()
    })
    expect(listCatalogsMock).toHaveBeenCalledTimes(2)
  })

  it('happy: starts a scrape from the modal, toasts success and refreshes the list', async () => {
    scrapeCatalogMock.mockResolvedValue({ id: 'cat-1', status: 'pending' })

    renderPage()
    await screen.findByText('No catalogs yet')

    fireEvent.click(screen.getAllByRole('button', { name: 'Scrape website' })[0] as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://acme.example.com/catalog' } })
    fireEvent.change(screen.getByLabelText('Max depth'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Max pages'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start scrape' }))

    await waitFor(() => {
      expect(scrapeCatalogMock).toHaveBeenCalledWith('ws-1', 'vendor-1', {
        seedUrl: 'https://acme.example.com/catalog',
        maxDepth: 2,
        maxPages: 50,
      })
      expect(screen.getByText('Scrape started')).toBeDefined()
    })
    expect(listCatalogsMock).toHaveBeenCalledTimes(2)
  })

  // S9. The vendor page had zero procurement data on it until now.
  it('happy: shows what the vendor charged against the agreed price, item SKUs in Mono, dates in ISO', async () => {
    getVendorExceptionSummaryMock.mockResolvedValue({
      counts: { contract_price_variance: 1 },
      openTotal: 3,
      purchaseOrderCount: 2,
    })
    listVendorPriceHistoryMock.mockResolvedValue({
      items: [
        {
          poLineItemId: 'line-1',
          purchaseOrderId: 'po-1',
          poNumber: 'PO-2026-1188',
          poName: 'po.csv',
          currency: 'USD',
          orderedAt: new Date(2026, 5, 1, 12, 0).toISOString(),
          recordedAt: new Date(2026, 5, 2, 12, 0).toISOString(),
          sku: 'DSK-1042',
          uom: null,
          quantity: '12',
          unitPrice: '542.79',
          contractUnitPrice: '489.00',
        },
        {
          poLineItemId: 'line-2',
          purchaseOrderId: 'po-2',
          poNumber: null,
          poName: 'older-po.csv',
          currency: 'USD',
          orderedAt: null,
          recordedAt: new Date(2026, 0, 2, 12, 0).toISOString(),
          sku: 'CHR-2201',
          uom: null,
          quantity: '12',
          unitPrice: '312.50',
          contractUnitPrice: '312.50',
        },
      ],
      page: 1,
      pageSize: 50,
      total: 2,
      totalPages: 1,
      skus: ['CHR-2201', 'DSK-1042'],
    })

    renderPage()

    const sku = await screen.findByText('DSK-1042')
    expect(sku.className).toContain('font-mono')
    expect(screen.getByText('542.79')).toBeTruthy()
    expect(screen.getByText('489.00')).toBeTruthy()
    // Ordered above contract: the gap is stated, not just implied.
    expect(screen.getByText('+53.79')).toBeTruthy()
    expect(screen.getByText('On contract')).toBeTruthy()
    // An order with no stated order date says so rather than passing the
    // upload date off as one.
    expect(screen.getByText(/uploaded/)).toBeTruthy()
    // C-3 #2: local ISO dates; the upload-date fallback keeps its label.
    expect(screen.getByText('2026-06-01')).toBeTruthy()
    expect(screen.getByText('2026-01-02 (uploaded)')).toBeTruthy()
    expect(screen.getByText('Open exceptions')).toBeTruthy()
    expect(screen.getByText('Priced off contract')).toBeTruthy()
  })

  it('happy: fetches the vendor by id instead of scanning every vendor in the workspace', async () => {
    renderPage()

    await screen.findByText('Acme Supplies')
    expect(getVendorMock).toHaveBeenCalledWith('ws-1', 'vendor-1')
    expect(listVendorsMock).not.toHaveBeenCalled()
  })

  describe('no access (B18)', () => {
    const denied = { statusCode: 403, message: 'Not a member of this workspace' }

    it('error: a non-member sees the no-access state, not an error toast', async () => {
      getWorkspaceMock.mockRejectedValue(denied)
      getVendorMock.mockRejectedValue(denied)
      listCatalogsMock.mockRejectedValue(denied)

      renderPage()

      expect(await screen.findByRole('heading', { name: "You don't have access to this workspace" })).toBeDefined()
      expect(screen.queryByText('Failed to load vendor')).toBeNull()
      expect(pushMock).not.toHaveBeenCalledWith('/login')
    })

    it('edge: a failure that is not a 403 still shows the error toast', async () => {
      getVendorMock.mockRejectedValue({ statusCode: 500, message: 'Internal server error' })

      renderPage()

      expect(await screen.findByText('Failed to load vendor')).toBeDefined()
      expect(screen.queryByRole('heading', { name: "You don't have access to this workspace" })).toBeNull()
    })
  })
})
