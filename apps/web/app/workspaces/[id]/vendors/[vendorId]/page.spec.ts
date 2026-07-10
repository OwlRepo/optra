/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import VendorDetailPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listWorkspacesMock = vi.fn()
const listVendorsMock = vi.fn()
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
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

vi.mock('@/lib/api/catalog', () => ({
  listVendors: (...args: unknown[]) => listVendorsMock(...args),
  listCatalogs: (...args: unknown[]) => listCatalogsMock(...args),
  uploadCatalog: (...args: unknown[]) => uploadCatalogMock(...args),
  scrapeCatalog: (...args: unknown[]) => scrapeCatalogMock(...args),
  listCatalogItems: (...args: unknown[]) => listCatalogItemsMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

const vendor = { id: 'vendor-1', name: 'Acme Supplies', contactInfo: 'orders@acme.com', createdAt: '2026-07-01T00:00:00.000Z' }

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(VendorDetailPage, { params: { id: 'ws-1', vendorId: 'vendor-1' } }),
    ),
  )
}

describe('VendorDetailPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listWorkspacesMock.mockReset()
    listVendorsMock.mockReset()
    listCatalogsMock.mockReset()
    uploadCatalogMock.mockReset()
    scrapeCatalogMock.mockReset()
    listCatalogItemsMock.mockReset()
    logoutMock.mockReset()

    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listVendorsMock.mockResolvedValue([vendor])
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogsMock.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders loading skeleton before data resolves', async () => {
    let resolveCatalogs: (value: unknown) => void = () => {}
    listCatalogsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalogs = resolve
      }),
    )

    const { container } = renderPage()

    expect(container.querySelectorAll('[class*="bg-secondary"]').length).toBeGreaterThan(0)

    resolveCatalogs([])
    await screen.findByText('No catalogs yet')
  })

  it('renders empty state with correct copy and the vendor header', async () => {
    renderPage()

    expect(await screen.findByText('No catalogs yet')).toBeDefined()
    expect(screen.getByText("Upload a catalog file or scrape the vendor's website to build one.")).toBeDefined()
    expect(screen.getByText('Acme Supplies')).toBeDefined()
    expect(screen.getByText('orders@acme.com')).toBeDefined()
  })

  it('renders fetched catalogs with source, status badges, row counts, and inline error', async () => {
    listCatalogsMock.mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Spring price list',
        sourceKind: 'pdf',
        status: 'done',
        rowCount: 120,
        lastError: null,
        createdAt: '2026-07-01T00:00:00.000Z',
      },
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

  it('hides upload/scrape actions for member role and shows them for owner/admin', async () => {
    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })

    const view = renderPage()

    expect(await screen.findByText('No catalogs yet')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Upload catalog' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Scrape website' })).toBeNull()

    view.unmount()

    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'admin' }], nextCursor: null })
    renderPage()

    expect((await screen.findAllByRole('button', { name: 'Upload catalog' })).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Scrape website' }).length).toBeGreaterThan(0)
  })

  it('uploads a selected catalog file, shows a success toast, and refreshes the list', async () => {
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

  it('shows an error toast when catalog upload fails', async () => {
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

  it('starts a scrape from the modal, shows a success toast, and refreshes the list', async () => {
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

  it('disables the scrape submit button until the seed URL looks valid', async () => {
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

  it('shows an error toast when starting a scrape fails', async () => {
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

  it('shows catalog items as a photo grid (with text fallback) when View items is clicked', async () => {
    listCatalogsMock.mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Spring price list',
        sourceKind: 'pdf',
        status: 'done',
        rowCount: 2,
        lastError: null,
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ])
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
    expect(document.querySelectorAll('[data-testid="image-tile-fallback"]').length).toBe(2)
  })

  it('redirects to login when loading the vendor returns unauthorized', async () => {
    listCatalogsMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
