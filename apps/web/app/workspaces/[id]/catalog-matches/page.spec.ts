/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import CatalogMatchesPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
let mockSearchParams = new URLSearchParams()
const getWorkspaceMock = vi.fn()
const listWorkspacesMock = vi.fn()
const listVendorsMock = vi.fn()
const listCatalogMatchesMock = vi.fn()
const searchCatalogMatchesMock = vi.fn()
const verifyCatalogMatchesMock = vi.fn()
const dismissCatalogMatchMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/catalog-matches',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

vi.mock('@/lib/api/catalog', () => ({
  listVendors: (...args: unknown[]) => listVendorsMock(...args),
  listCatalogMatches: (...args: unknown[]) => listCatalogMatchesMock(...args),
  searchCatalogMatches: (...args: unknown[]) => searchCatalogMatchesMock(...args),
  verifyCatalogMatches: (...args: unknown[]) => verifyCatalogMatchesMock(...args),
  dismissCatalogMatch: (...args: unknown[]) => dismissCatalogMatchMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(CatalogMatchesPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

const baseMatch = {
  id: 'match-1',
  matchType: 'sourcing' as const,
  queryPoLineItemId: 'po-line-12345678',
  queryInvoiceLineItemId: null,
  catalogItemId: 'catalog-item-abcdef12',
  vendorId: 'vendor-1',
  score: '0.82',
  isMatch: true,
  reason: 'Matches on description',
  status: 'open' as const,
  createdAt: '2026-07-01T00:00:00.000Z',
}

describe('CatalogMatchesPage', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listWorkspacesMock.mockReset()
    listVendorsMock.mockReset()
    listCatalogMatchesMock.mockReset()
    searchCatalogMatchesMock.mockReset()
    verifyCatalogMatchesMock.mockReset()
    dismissCatalogMatchMock.mockReset()
    logoutMock.mockReset()

    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listVendorsMock.mockResolvedValue([{ id: 'vendor-1', name: 'Acme Supply', contactInfo: null, createdAt: '2026-07-01T00:00:00.000Z' }])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the loading skeleton before data resolves', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([])

    renderPage()

    expect(document.querySelectorAll('[class*="shimmer"]').length).toBeGreaterThan(0)
    await screen.findByText('No catalog matches yet')
  })

  it('renders empty state with neutral copy when there are no matches yet', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No catalog matches yet')).toBeDefined()
  })

  it('renders fetched matches using PhotoCompare with fallback id labels', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([baseMatch])

    renderPage()

    expect(await screen.findByText(/Query item po-line-/)).toBeDefined()
    expect(screen.getByText(/Catalog item catalog-/)).toBeDefined()
    expect(screen.getByText('Matches on description')).toBeDefined()
  })

  it('hides search/verify controls and dismiss when no query params are present', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([baseMatch])

    renderPage()

    await screen.findByText(/Query item po-line-/)
    expect(screen.queryByRole('button', { name: 'Search all vendors' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Verify against this vendor' })).toBeNull()
  })

  it('shows "Search all vendors" for owner/admin when poLineItemId is present, hides it for member', async () => {
    mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678' })
    listCatalogMatchesMock.mockResolvedValue([])
    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    const view = renderPage()

    expect(await screen.findByRole('button', { name: 'Search all vendors' })).toBeDefined()
    view.unmount()

    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })
    renderPage()

    await screen.findByText('No catalog matches yet')
    expect(screen.queryByRole('button', { name: 'Search all vendors' })).toBeNull()
  })

  it('shows "Verify against this vendor" only when vendorId is also present', async () => {
    mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678', vendorId: 'vendor-1' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'admin' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([])

    renderPage()

    expect(await screen.findByRole('button', { name: 'Search all vendors' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Verify against this vendor' })).toBeDefined()
  })

  it('runs a search, shows a success toast, and refreshes the list', async () => {
    mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([baseMatch])
    searchCatalogMatchesMock.mockResolvedValue({ matches: [baseMatch] })

    renderPage()

    const searchButton = await screen.findByRole('button', { name: 'Search all vendors' })
    fireEvent.click(searchButton)

    await waitFor(() => {
      expect(searchCatalogMatchesMock).toHaveBeenCalledWith('ws-1', { purchaseOrderLineItemId: 'po-line-12345678' })
      expect(screen.getByText('Search complete')).toBeDefined()
      expect(screen.getByText(/Query item po-line-/)).toBeDefined()
    })
  })

  it('runs verification against a vendor and shows a success toast', async () => {
    mockSearchParams = new URLSearchParams({ invoiceLineItemId: 'inv-line-98765432', vendorId: 'vendor-1' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([])
    verifyCatalogMatchesMock.mockResolvedValue({ matches: [] })

    renderPage()

    const verifyButton = await screen.findByRole('button', { name: 'Verify against this vendor' })
    fireEvent.click(verifyButton)

    await waitFor(() => {
      expect(verifyCatalogMatchesMock).toHaveBeenCalledWith('ws-1', 'vendor-1', { invoiceLineItemId: 'inv-line-98765432' })
      expect(screen.getByText('Verification complete')).toBeDefined()
    })
  })

  it('shows an error toast reading the error message when search fails', async () => {
    mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([])
    searchCatalogMatchesMock.mockRejectedValue({ statusCode: 404, message: 'purchaseOrderLineItemId not found' })

    renderPage()

    const searchButton = await screen.findByRole('button', { name: 'Search all vendors' })
    fireEvent.click(searchButton)

    await waitFor(() => {
      expect(screen.getByText('purchaseOrderLineItemId not found')).toBeDefined()
    })
  })

  it('dismisses an open match for owner/admin and hides Dismiss for member', async () => {
    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock
      .mockResolvedValueOnce([baseMatch])
      .mockResolvedValueOnce([{ ...baseMatch, status: 'dismissed' }])
    dismissCatalogMatchMock.mockResolvedValue({ ...baseMatch, status: 'dismissed' })

    const view = renderPage()

    const dismissButton = await screen.findByRole('button', { name: 'Dismiss match match-1' })
    fireEvent.click(dismissButton)

    await waitFor(() => {
      expect(dismissCatalogMatchMock).toHaveBeenCalledWith('ws-1', 'match-1')
      expect(screen.getByText('Match dismissed')).toBeDefined()
    })

    view.unmount()

    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValueOnce([baseMatch])
    renderPage()

    await screen.findByText(/Query item po-line-/)
    expect(screen.queryByRole('button', { name: 'Dismiss match match-1' })).toBeNull()
  })

  it('refetches the list with new filters when the vendor or status Select changes', async () => {
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock
      .mockResolvedValueOnce([baseMatch])
      .mockResolvedValueOnce([])

    renderPage()

    await screen.findByText(/Query item po-line-/)
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'dismissed' } })

    await waitFor(() => {
      expect(listCatalogMatchesMock).toHaveBeenNthCalledWith(2, 'ws-1', { vendorId: undefined, status: 'dismissed' })
    })
  })

  it('redirects to login on a 401 from the initial load', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  it('redirects to login on a 401 from a search action', async () => {
    mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listCatalogMatchesMock.mockResolvedValue([])
    searchCatalogMatchesMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

    renderPage()

    const searchButton = await screen.findByRole('button', { name: 'Search all vendors' })
    fireEvent.click(searchButton)

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
