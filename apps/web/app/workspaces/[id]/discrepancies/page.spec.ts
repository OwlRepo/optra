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
const listDecisionsMock = vi.fn()
const recordDecisionMock = vi.fn()
const listRunsMock = vi.fn()

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
  // The review modal reaches for these through the same module.
  listDiscrepancyDecisions: (...args: unknown[]) => listDecisionsMock(...args),
  recordDiscrepancyDecision: (...args: unknown[]) => recordDecisionMock(...args),
  listComparisonRuns: (...args: unknown[]) => listRunsMock(...args),
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
    goodsReceiptLineItemId: null,
    sku: 'SKU-100',
    flagType: 'quantity_mismatch',
    poValue: '10',
    receivedValue: null,
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

// S7: the list is an offset page with server-computed counts, not a bare
// array. Wrapping here keeps each test stating only the flags it cares about.
function listOf(flags: ReturnType<typeof makeFlag>[], overrides: Record<string, unknown> = {}) {
  const counts: Record<string, number> = {
    quantity_mismatch: 0,
    price_mismatch: 0,
    missing_on_invoice: 0,
    missing_on_po: 0,
    short_receipt: 0,
    invoice_exceeds_received: 0,
    uom_mismatch: 0,
    currency_mismatch: 0,
  }
  for (const flag of flags) counts[flag.flagType as string] += 1
  return {
    items: flags,
    page: 1,
    pageSize: 20,
    total: flags.length,
    totalPages: flags.length === 0 ? 0 : 1,
    counts,
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
    listDecisionsMock.mockReset().mockResolvedValue([])
    recordDecisionMock.mockReset().mockResolvedValue({})
    listRunsMock.mockReset().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders fetched discrepancy flags with stat counts', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

    renderPage()

    expect(await screen.findByText('SKU-100')).toBeDefined()
    expect(screen.getByText('Quantity mismatch')).toBeDefined()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
  })

  // S6 widened the flag vocabulary from four types to eight. An unlabelled type
  // does not crash the page — it renders a blank badge — so nothing but a test
  // like this one notices when the API learns a word the UI does not know.
  it('labels every discrepancy type the API can return', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([
      makeFlag({ id: 'f1', sku: 'S-1', flagType: 'quantity_mismatch' }),
      makeFlag({ id: 'f2', sku: 'S-2', flagType: 'price_mismatch' }),
      makeFlag({ id: 'f3', sku: 'S-3', flagType: 'missing_on_invoice' }),
      makeFlag({ id: 'f4', sku: 'S-4', flagType: 'missing_on_po' }),
      makeFlag({ id: 'f5', sku: 'S-5', flagType: 'short_receipt' }),
      makeFlag({ id: 'f6', sku: 'S-6', flagType: 'invoice_exceeds_received' }),
      makeFlag({ id: 'f7', sku: 'S-7', flagType: 'uom_mismatch' }),
      makeFlag({ id: 'f8', sku: null, flagType: 'currency_mismatch' }),
    ]))

    renderPage()

    expect(await screen.findByText('Quantity mismatch')).toBeDefined()
    expect(screen.getByText('Price mismatch')).toBeDefined()
    // These two read identically on the badge and on their stat card, so the
    // badge is one of several matches rather than the only one.
    expect(screen.getAllByText('Missing on invoice').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Missing on PO').length).toBeGreaterThan(1)
    expect(screen.getByText('Short receipt')).toBeDefined()
    expect(screen.getByText('Billed above received')).toBeDefined()
    expect(screen.getByText('Unit mismatch')).toBeDefined()
    expect(screen.getByText('Currency mismatch')).toBeDefined()
  })

  // A short receipt without the received quantity is the one number the
  // reviewer is actually deciding on, so the table has to show all three.
  it('shows what was received alongside what was ordered and billed', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([
      // Three distinct numbers, so a page that dropped the received column
      // could not pass by rendering one of the other two twice.
      makeFlag({ flagType: 'short_receipt', poValue: '12', receivedValue: '7', invoiceValue: '9', delta: '-5' }),
    ]))

    renderPage()

    expect(await screen.findByText('Received')).toBeDefined()
    expect(screen.getByText('12')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
    expect(screen.getByText('9')).toBeDefined()
  })

  it('summarises receiving exceptions and needs-review flags in the stat cards', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([
      makeFlag({ id: 'f1', flagType: 'short_receipt' }),
      makeFlag({ id: 'f2', flagType: 'invoice_exceeds_received' }),
      makeFlag({ id: 'f3', flagType: 'uom_mismatch' }),
      makeFlag({ id: 'f4', sku: null, flagType: 'currency_mismatch' }),
    ]))

    renderPage()

    expect(await screen.findByText('Receiving exceptions')).toBeDefined()
    expect(screen.getByText('Needs review')).toBeDefined()
  })

  // S7. The cards used to be computed in the browser from the array it held.
  // Paginated, that reports the visible page and calls it the total — and the
  // total is the one number a reviewer uses to decide where to start.
  it('reads the stat counts from the server, not from the visible page', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(
      listOf([makeFlag({ flagType: 'price_mismatch' })], {
        total: 47,
        totalPages: 3,
        counts: {
          quantity_mismatch: 4,
          price_mismatch: 31,
          missing_on_invoice: 2,
          missing_on_po: 9,
          short_receipt: 5,
          invoice_exceeds_received: 6,
          uom_mismatch: 1,
          currency_mismatch: 0,
        },
      }),
    )

    renderPage()

    expect(await screen.findByText('Price mismatches')).toBeDefined()
    // 31, not the single flag on screen.
    expect(screen.getByText('31')).toBeDefined()
    // Receiving exceptions groups short_receipt + invoice_exceeds_received.
    expect(screen.getByText('11')).toBeDefined()
  })

  it('asks the server for the next page instead of slicing what it already has', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()], { total: 40, totalPages: 2 }))

    renderPage()
    expect(await screen.findByText('SKU-100')).toBeDefined()

    fireEvent.click(screen.getByLabelText('Next page'))

    await waitFor(() => {
      expect(listDiscrepanciesMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({ page: 2 }))
    })
  })

  // S7. The decision routes and their client functions shipped in S2 and had
  // no caller at all until now — a reviewer could only ever dismiss.
  it('opens a review panel for a row and records a decision against it', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Review discrepancy SKU-100' }))

    expect(await screen.findByText('Record a decision')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Credit agreed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }))

    await waitFor(() => {
      expect(recordDecisionMock).toHaveBeenCalledWith('ws-1', 'flag-1', {
        outcome: 'false_positive',
        note: 'Credit agreed.',
      })
    })
  })

  it('refetches the current page after a decision rather than trusting its copy', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()], { total: 40, totalPages: 2 }))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Review discrepancy SKU-100' }))
    fireEvent.change(await screen.findByLabelText('Decision note'), { target: { value: 'Done.' } })

    const callsBefore = listDiscrepanciesMock.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }))

    await waitFor(() => {
      expect(listDiscrepanciesMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('renders a positive-toned empty state when no discrepancies are found', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([]))

    renderPage()

    expect(await screen.findByText('No discrepancies')).toBeDefined()
    expect(screen.getByText('Every checked line item matches.')).toBeDefined()
  })

  it('hides dismiss for member role and shows it for owner/admin', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
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
    listDiscrepanciesMock.mockResolvedValue(listOf([
      makeFlag({ id: 'flag-2', sku: 'SKU-200', flagType: 'missing_on_po', poLineItemId: null, invoiceLineItemId: 'inv-line-2' }),
    ]))

    renderPage()

    const link = await screen.findByRole('link', { name: 'Find catalog matches' })
    expect(link.getAttribute('href')).toBe('/workspaces/ws-1/catalog-matches?invoiceLineItemId=inv-line-2')
  })

  // Since S7 the page refetches rather than splicing the row out locally: on a
  // paginated list a local removal leaves a short page and stale counts.
  it('dismisses a discrepancy and refetches the page', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValueOnce(listOf([makeFlag()])).mockResolvedValue(listOf([]))
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
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
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
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

    renderPage()

    await screen.findByText('SKU-100')
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'dismissed' } })

    await waitFor(() => {
      expect(listDiscrepanciesMock).toHaveBeenLastCalledWith('ws-1', {
        purchaseOrderId: undefined,
        invoiceId: undefined,
        status: 'dismissed',
        page: 1,
        pageSize: 20,
      })
    })
  })

  it('pre-filters by purchaseOrderId and invoiceId from query params', async () => {
    mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([]))

    renderPage()

    await waitFor(() => {
      expect(listDiscrepanciesMock).toHaveBeenCalledWith('ws-1', {
        purchaseOrderId: 'po-9',
        invoiceId: 'inv-9',
        status: undefined,
        page: 1,
        pageSize: 20,
      })
    })
  })

  it('redirects to login on unauthorized load error', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    listDiscrepanciesMock.mockResolvedValue(listOf([]))

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
