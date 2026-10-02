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
  catalogItemPhotoUrl: (workspaceId: string, itemId: string) =>
    `/api/workspaces/${workspaceId}/catalog-items/${itemId}/photo`,
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

  // B12. A discrepancy flag's "Find catalog matches" link carries both its PO
  // and its invoice line ids. The page searches by the PO line, so the list
  // must be scoped to that same line: the API ANDs both filters, and matches
  // stored under the PO line have no invoice line, so the list came back empty
  // right after "1 match found".
  describe('line scope (B12)', () => {
    it('edge: opened with only an invoice line id, lists matches for that invoice line', async () => {
      mockSearchParams = new URLSearchParams({ invoiceLineItemId: 'inv-line-98765432' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listCatalogMatchesMock.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        expect(listCatalogMatchesMock).toHaveBeenCalled()
      })
      for (const call of listCatalogMatchesMock.mock.calls) {
        expect(call[1]).toMatchObject({ invoiceLineItemId: 'inv-line-98765432' })
        expect(call[1]).not.toHaveProperty('poLineItemId')
      }
    })

    it('regression: after a search from a flag with both line ids, the refreshed list is scoped to the PO line it searched', async () => {
      mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678', invoiceLineItemId: 'inv-line-98765432' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listCatalogMatchesMock.mockResolvedValueOnce([]).mockResolvedValue([baseMatch])
      searchCatalogMatchesMock.mockResolvedValue({ matches: [baseMatch] })

      renderPage()

      fireEvent.click(await screen.findByRole('button', { name: 'Search all vendors' }))

      await waitFor(() => {
        expect(searchCatalogMatchesMock).toHaveBeenCalledWith('ws-1', { purchaseOrderLineItemId: 'po-line-12345678' })
        expect(screen.getByText(/Query item po-line-/)).toBeDefined()
      })
      const lastScope = listCatalogMatchesMock.mock.calls.at(-1)?.[1]
      expect(lastScope).toMatchObject({ poLineItemId: 'po-line-12345678' })
      expect(lastScope).not.toHaveProperty('invoiceLineItemId')
    })

    it('regression: opened from a flag with both line ids, lists matches for the PO line it searches', async () => {
      mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678', invoiceLineItemId: 'inv-line-98765432' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listCatalogMatchesMock.mockResolvedValue([baseMatch])

      renderPage()

      await waitFor(() => {
        expect(listCatalogMatchesMock).toHaveBeenCalled()
      })
      for (const call of listCatalogMatchesMock.mock.calls) {
        expect(call[1]).toMatchObject({ poLineItemId: 'po-line-12345678' })
        expect(call[1]).not.toHaveProperty('invoiceLineItemId')
      }
      expect(await screen.findByText(/Query item po-line-/)).toBeDefined()
    })
  })

  // B6. A search now saves the verdicts it got and counts the candidates the
  // model could not compare (`unjudged`). The success summary keeps its exact
  // wording; the skipped count gets its own warning so it cannot be missed.
  describe('unjudged candidates (B6)', () => {
    it('edge: a search with candidates left uncompared says how many in a separate warning', async () => {
      mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listCatalogMatchesMock.mockResolvedValue([baseMatch])
      searchCatalogMatchesMock.mockResolvedValue({ matches: [baseMatch], unjudged: 2 })

      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Search all vendors' }))

      await waitFor(() => {
        expect(screen.getByText('1 match found.')).toBeDefined()
        expect(screen.getByText('Some catalog items were not compared')).toBeDefined()
        expect(screen.getByText('2 catalog items could not be compared. Search again to retry.')).toBeDefined()
      })
    })

    it('edge: a verification with one candidate left uncompared says so in the singular', async () => {
      mockSearchParams = new URLSearchParams({ invoiceLineItemId: 'inv-line-98765432', vendorId: 'vendor-1' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listCatalogMatchesMock.mockResolvedValue([])
      verifyCatalogMatchesMock.mockResolvedValue({ matches: [], unjudged: 1 })

      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Verify against this vendor' }))

      await waitFor(() => {
        expect(screen.getByText('Verification complete')).toBeDefined()
        expect(screen.getByText('1 catalog item could not be compared. Search again to retry.')).toBeDefined()
      })
    })

    it('happy: a search with every candidate compared shows no warning', async () => {
      mockSearchParams = new URLSearchParams({ poLineItemId: 'po-line-12345678' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listCatalogMatchesMock.mockResolvedValue([baseMatch])
      searchCatalogMatchesMock.mockResolvedValue({ matches: [baseMatch], unjudged: 0 })

      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Search all vendors' }))

      await waitFor(() => {
        expect(screen.getByText('Search complete')).toBeDefined()
      })
      expect(screen.queryByText('Some catalog items were not compared')).toBeNull()
    })
  })

  describe('no access (B18)', () => {
    const denied = { statusCode: 403, message: 'Not a member of this workspace' }

    it('error: a non-member sees the no-access state, not an error toast', async () => {
      getWorkspaceMock.mockRejectedValue(denied)
      listCatalogMatchesMock.mockRejectedValue(denied)
      listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

      renderPage()

      expect(await screen.findByRole('heading', { name: "You don't have access to this workspace" })).toBeDefined()
      expect(screen.queryByText('Failed to load catalog matches')).toBeNull()
      expect(pushMock).not.toHaveBeenCalledWith('/login')
    })

    it('edge: a failure that is not a 403 still shows the error toast', async () => {
      getWorkspaceMock.mockRejectedValue({ statusCode: 500, message: 'Internal server error' })
      listCatalogMatchesMock.mockResolvedValue([])
      listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

      renderPage()

      expect(await screen.findByText('Failed to load catalog matches')).toBeDefined()
      expect(screen.queryByRole('heading', { name: "You don't have access to this workspace" })).toBeNull()
    })
  })
})
