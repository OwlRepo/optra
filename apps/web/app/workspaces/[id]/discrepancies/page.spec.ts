/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import DiscrepanciesPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listWorkspacesMock = vi.fn()
const listDiscrepanciesMock = vi.fn()
const dismissDiscrepancyMock = vi.fn()
const logoutMock = vi.fn()

let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/discrepancies',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

vi.mock('@/lib/api/procurement', () => ({
  listDiscrepancies: (...args: unknown[]) => listDiscrepanciesMock(...args),
  dismissDiscrepancy: (...args: unknown[]) => dismissDiscrepancyMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

function makeFlag(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'flag-1',
    workspaceId: 'ws-1',
    purchaseOrderId: 'po-1',
    invoiceId: 'inv-1',
    poLineItemId: 'po-line-1',
    invoiceLineItemId: 'inv-line-1',
    sku: 'SKU-100',
    flagType: 'quantity_mismatch',
    poValue: '10',
    invoiceValue: '8',
    delta: '-2',
    reason: 'Invoice quantity is lower than the PO quantity.',
    status: 'open',
    dismissedAt: null,
    dismissedBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(DiscrepanciesPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('DiscrepanciesPage', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listWorkspacesMock.mockReset()
    listDiscrepanciesMock.mockReset()
    dismissDiscrepancyMock.mockReset()
    logoutMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders fetched discrepancy flags with stat counts', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue([makeFlag()])

    renderPage()

    expect(await screen.findByText('SKU-100')).toBeDefined()
    expect(screen.getByText('Quantity mismatch')).toBeDefined()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
  })

  it('renders a positive-toned empty state when no discrepancies are found', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No discrepancies')).toBeDefined()
    expect(screen.getByText('Every checked line item matches.')).toBeDefined()
  })

  it('hides dismiss for member role and shows it for owner/admin', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listDiscrepanciesMock.mockResolvedValue([makeFlag()])
    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })

    const view = renderPage()

    expect(await screen.findByRole('button', { name: 'Dismiss discrepancy SKU-100' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Find catalog matches' })).toBeDefined()

    view.unmount()

    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })
    renderPage()

    await screen.findByText('SKU-100')
    expect(screen.queryByRole('button', { name: 'Dismiss discrepancy SKU-100' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Find catalog matches' })).toBeDefined()
  })

  it('builds the catalog-matches link using only the non-null line item id', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue([
      makeFlag({ id: 'flag-2', sku: 'SKU-200', flagType: 'missing_on_po', poLineItemId: null, invoiceLineItemId: 'inv-line-2' }),
    ])

    renderPage()

    const link = await screen.findByRole('link', { name: 'Find catalog matches' })
    expect(link.getAttribute('href')).toBe('/workspaces/ws-1/catalog-matches?invoiceLineItemId=inv-line-2')
  })

  it('dismisses a discrepancy and removes it from the list on success', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue([makeFlag()])
    dismissDiscrepancyMock.mockResolvedValue(makeFlag({ status: 'dismissed' }))

    renderPage()

    await screen.findByText('SKU-100')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss discrepancy SKU-100' }))

    await waitFor(() => {
      expect(dismissDiscrepancyMock).toHaveBeenCalledWith('ws-1', 'flag-1')
      expect(screen.getByText('No discrepancies')).toBeDefined()
    })
  })

  it('shows an error toast when dismiss fails', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue([makeFlag()])
    dismissDiscrepancyMock.mockRejectedValue({ message: 'Something went wrong' })

    renderPage()

    await screen.findByText('SKU-100')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss discrepancy SKU-100' }))

    expect(await screen.findByText('Failed to dismiss discrepancy')).toBeDefined()
    expect(screen.getByText('SKU-100')).toBeDefined()
  })

  it('refetches with the status filter when changed', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue([makeFlag()])

    renderPage()

    await screen.findByText('SKU-100')
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'dismissed' } })

    await waitFor(() => {
      expect(listDiscrepanciesMock).toHaveBeenLastCalledWith('ws-1', {
        purchaseOrderId: undefined,
        invoiceId: undefined,
        status: 'dismissed',
      })
    })
  })

  it('pre-filters by purchaseOrderId and invoiceId from query params', async () => {
    mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(listDiscrepanciesMock).toHaveBeenCalledWith('ws-1', {
        purchaseOrderId: 'po-9',
        invoiceId: 'inv-9',
        status: undefined,
      })
    })
  })

  it('redirects to login on unauthorized load error', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
