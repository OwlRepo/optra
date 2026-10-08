/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import DiscrepanciesPage from './page'
import { WorkspaceProvider } from '@/components/workspace-context'

const pushMock = vi.fn()
const replaceMock = vi.fn()
const routerMock = { push: pushMock, replace: replaceMock }
const getWorkspaceMock = vi.fn()
const listDiscrepanciesMock = vi.fn()
const dismissDiscrepancyMock = vi.fn()
const logoutMock = vi.fn()
const listDecisionsMock = vi.fn()
const recordDecisionMock = vi.fn()
const listRunsMock = vi.fn()
const listPurchaseOrdersMock = vi.fn()
const listInvoicesMock = vi.fn()
const exportEvidenceTrailMock = vi.fn()

let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/discrepancies',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}))

vi.mock('@/lib/api/procurement', () => ({
  listDiscrepancies: (...args: unknown[]) => listDiscrepanciesMock(...args),
  dismissDiscrepancy: (...args: unknown[]) => dismissDiscrepancyMock(...args),
  // The review modal reaches for these through the same module.
  listDiscrepancyDecisions: (...args: unknown[]) => listDecisionsMock(...args),
  recordDiscrepancyDecision: (...args: unknown[]) => recordDecisionMock(...args),
  listComparisonRuns: (...args: unknown[]) => listRunsMock(...args),
  // C-3 #1: the pair chip looks the two documents up by id for their numbers.
  listPurchaseOrders: (...args: unknown[]) => listPurchaseOrdersMock(...args),
  listInvoices: (...args: unknown[]) => listInvoicesMock(...args),
  exportEvidenceTrail: (...args: unknown[]) => exportEvidenceTrailMock(...args),
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

function stubDesktop(matches: boolean) {
  return vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: matches && query === '(min-width: 1024px)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(WorkspaceProvider, { workspaceId: 'ws-1' }, React.createElement(DiscrepanciesPage, {
        params: { id: 'ws-1' },
      })),
    ),
  )
}

describe('DiscrepanciesPage', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    pushMock.mockReset()
    replaceMock.mockReset()
    getWorkspaceMock.mockReset()
    listDiscrepanciesMock.mockReset()
    dismissDiscrepancyMock.mockReset()
    logoutMock.mockReset()
    listDecisionsMock.mockReset().mockResolvedValue([])
    recordDecisionMock.mockReset().mockResolvedValue({})
    listRunsMock.mockReset().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })
    listPurchaseOrdersMock.mockReset().mockResolvedValue([])
    listInvoicesMock.mockReset().mockResolvedValue([])
    exportEvidenceTrailMock.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders fetched discrepancy flags with stat counts', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    listDiscrepanciesMock.mockResolvedValue(listOf([]))

    renderPage()

    expect(await screen.findByText('No discrepancies')).toBeDefined()
    expect(screen.getByText('Every checked line item matches.')).toBeDefined()
  })

  it('hides dismiss for member role and shows it for owner/admin', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha' })
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'owner' })

    const view = renderPage()

    expect(await screen.findByRole('button', { name: 'Dismiss discrepancy SKU-100' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Find catalog matches' })).toBeDefined()

    view.unmount()

    getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Alpha', role: 'member' })
    renderPage()

    await screen.findByText('SKU-100')
    expect(screen.queryByRole('button', { name: 'Dismiss discrepancy SKU-100' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Find catalog matches' })).toBeDefined()
  })

  it('builds the catalog-matches link using only the non-null line item id', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
    listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
    dismissDiscrepancyMock.mockRejectedValue({ message: 'Something went wrong' })

    renderPage()

    await screen.findByText('SKU-100')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss discrepancy SKU-100' }))

    expect(await screen.findByText('Failed to dismiss discrepancy')).toBeDefined()
    expect(screen.getByText('SKU-100')).toBeDefined()
  })

  it('pre-filters by purchaseOrderId and invoiceId from query params', async () => {
    mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
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
    listDiscrepanciesMock.mockResolvedValue(listOf([]))

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })

  // Frames 2.7–2.8. error > edge > regression > happy. The status-filter case
  // moved here from above: the filter is an All / Open / Dismissed segmented
  // control now, so it is driven through `radio` roles instead of a <select>.
  describe('design alignment (frames 2.7–2.8)', () => {
    it('error: a failed pair lookup keeps the ids on the chip and never blocks the list', async () => {
      mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
      listPurchaseOrdersMock.mockRejectedValue({ message: 'boom' })
      listInvoicesMock.mockRejectedValue({ message: 'boom' })

      renderPage()

      expect(await screen.findByText('SKU-100')).toBeDefined()
      expect(await screen.findByText('po-9 ↔ inv-9')).toBeDefined()
      await waitFor(() => expect(listPurchaseOrdersMock).toHaveBeenCalledWith('ws-1'))
      expect(screen.queryByText('Failed to load discrepancies')).toBeNull()
      expect(screen.queryByText('boom')).toBeNull()
    })

    it('edge: with no pair in the URL there is no pair chip and no document lookup', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

      renderPage()

      await screen.findByText('SKU-100')
      expect(screen.queryByRole('button', { name: 'Clear pair filter' })).toBeNull()
      expect(listPurchaseOrdersMock).not.toHaveBeenCalled()
      expect(listInvoicesMock).not.toHaveBeenCalled()
    })

    it('edge: while the pair lookup is in flight the chip shows the ids', async () => {
      mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
      listPurchaseOrdersMock.mockImplementation(() => new Promise(() => {}))
      listInvoicesMock.mockImplementation(() => new Promise(() => {}))

      renderPage()

      expect(await screen.findByText('po-9 ↔ inv-9')).toBeDefined()
    })

    it('edge: a pair document that is not found falls back to its id', async () => {
      mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
      listPurchaseOrdersMock.mockResolvedValue([{ id: 'po-9', name: 'po-9.csv', poNumber: 'PO-2026-1180' }])
      listInvoicesMock.mockResolvedValue([{ id: 'inv-other', name: 'other.csv', invoiceNumber: 'INV-1' }])

      renderPage()

      expect(await screen.findByText('PO-2026-1180 ↔ inv-9')).toBeDefined()
    })

    it('edge: × on the pair chip replaces the URL without purchaseOrderId and invoiceId', async () => {
      mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

      renderPage()

      fireEvent.click(await screen.findByRole('button', { name: 'Clear pair filter' }))

      expect(replaceMock).toHaveBeenCalledWith('/workspaces/ws-1/discrepancies')
      expect(pushMock).not.toHaveBeenCalled()
    })

    it('edge: a positive delta reads with a plus sign and a negative one keeps its minus (frame 2.7)', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([
        makeFlag({ id: 'f1', sku: 'S-1', flagType: 'price_mismatch', poValue: '1.80', invoiceValue: '2.05', delta: '0.25' }),
        makeFlag({ id: 'f2', sku: 'S-2', flagType: 'short_receipt', poValue: '6', receivedValue: '4', invoiceValue: '6', delta: '-2' }),
      ]))

      renderPage()

      expect(await screen.findByText('+0.25')).toBeDefined()
      expect(screen.getByText('-2')).toBeDefined()
      expect(screen.queryByText('0.25')).toBeNull()
    })

    it('edge: a dismissed row offers no Dismiss, even to an owner', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag({ status: 'dismissed' })]))

      renderPage()

      await screen.findByText('SKU-100')
      expect(screen.queryByRole('button', { name: 'Dismiss discrepancy SKU-100' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Review discrepancy SKU-100' })).toBeDefined()
    })

    it('regression: refetches with the status filter when changed', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

      renderPage()

      await screen.findByText('SKU-100')
      fireEvent.click(screen.getByRole('radio', { name: 'Dismissed' }))

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

    it('regression: switching back to All drops the status from the request', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

      renderPage()

      await screen.findByText('SKU-100')
      fireEvent.click(screen.getByRole('radio', { name: 'Dismissed' }))
      await waitFor(() => {
        expect(listDiscrepanciesMock).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ status: 'dismissed' }))
      })
      await screen.findByText('SKU-100')
      fireEvent.click(screen.getByRole('radio', { name: 'All' }))

      await waitFor(() => {
        expect(listDiscrepanciesMock).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ status: undefined }))
      })
    })

    // Any filter change restarts the queue: page 2 of the old filter is not a
    // meaningful place to land in the new one.
    it('regression: a status change returns to page 1', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()], { total: 40, totalPages: 2 }))

      renderPage()

      await screen.findByText('SKU-100')
      fireEvent.click(screen.getByLabelText('Next page'))
      await waitFor(() => {
        expect(listDiscrepanciesMock).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ page: 2 }))
      })
      await screen.findByText('SKU-100')
      fireEvent.click(screen.getByRole('radio', { name: 'Open' }))

      await waitFor(() => {
        expect(listDiscrepanciesMock).toHaveBeenLastCalledWith(
          'ws-1',
          expect.objectContaining({ status: 'open', page: 1 }),
        )
      })
    })

    it('regression: pagination stays hidden when nothing matched', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([]))

      renderPage()

      await screen.findByText('No discrepancies')
      expect(screen.queryByLabelText('Next page')).toBeNull()
    })

    it('happy: the pair chip names the PO and invoice by their numbers', async () => {
      mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
      listPurchaseOrdersMock.mockResolvedValue([{ id: 'po-9', name: 'po-8791.pdf', poNumber: 'PO-2026-1180' }])
      listInvoicesMock.mockResolvedValue([{ id: 'inv-9', name: 'inv-44120.pdf', invoiceNumber: 'INV-44120' }])

      renderPage()

      expect(await screen.findByText('PO-2026-1180 ↔ INV-44120')).toBeDefined()
    })

    it('happy: a pair document without a number is named by its file name', async () => {
      mockSearchParams = new URLSearchParams({ purchaseOrderId: 'po-9', invoiceId: 'inv-9' })
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
      listPurchaseOrdersMock.mockResolvedValue([{ id: 'po-9', name: 'legacy-po.csv', poNumber: null }])
      listInvoicesMock.mockResolvedValue([{ id: 'inv-9', name: 'legacy-inv.csv', invoiceNumber: null }])

      renderPage()

      expect(await screen.findByText('legacy-po.csv ↔ legacy-inv.csv')).toBeDefined()
    })

    it('happy: the row action reads "Matches" and keeps "Find catalog matches" as its name', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

      renderPage()

      const link = await screen.findByRole('link', { name: 'Find catalog matches' })
      expect(link.textContent).toBe('Matches')
      expect(link.getAttribute('href')).toBe(
        '/workspaces/ws-1/catalog-matches?poLineItemId=po-line-1&invoiceLineItemId=inv-line-1',
      )
    })

    it('happy: the all-clear empty state carries the teal "All clear" label', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([]))

      renderPage()

      expect(await screen.findByText('All clear')).toBeDefined()
      expect(screen.getByText('No discrepancies')).toBeDefined()
    })

    it('happy: the toolbar states how many flags exist and how many are shown', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()], { total: 40, totalPages: 2 }))

      renderPage()

      expect(await screen.findByText('40 flags · 1 shown')).toBeDefined()
    })

    it('edge: below lg the breadcrumb is the workspace name and the filter spans the width (frame 4.2)', async () => {
      stubDesktop(false)
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'member' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

      renderPage()

      const banner = await screen.findByRole('banner')
      expect(await within(banner).findByText('Alpha')).toBeDefined()
      expect(within(banner).queryByText('Alpha / Matching')).toBeNull()
      expect(screen.getByRole('radiogroup', { name: 'Filter by status' }).className).toContain('w-full')
      const count = screen.getByText('1 flag · 1 shown').className.split(/\s+/)
      expect(count).toEqual(expect.arrayContaining(['hidden', 'lg:inline']))
    })

    it('happy: the header breadcrumb reads "{workspace} / Matching"', async () => {
      stubDesktop(true)
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'member' })
      listDiscrepanciesMock.mockResolvedValue(listOf([]))

      renderPage()

      expect((await screen.findAllByText('Alpha / Matching')).length).toBeGreaterThan(0)
      expect(screen.getAllByText('Member').length).toBeGreaterThan(0)
    })
  })

  describe('no access (B18)', () => {
    const denied = { statusCode: 403, message: 'Not a member of this workspace' }

    it('error: a non-member sees the no-access state, not an error toast', async () => {
      getWorkspaceMock.mockRejectedValue(denied)
      listDiscrepanciesMock.mockRejectedValue(denied)

      renderPage()

      expect(await screen.findByRole('heading', { name: "You don't have access to this workspace" })).toBeDefined()
      expect(screen.queryByText('Failed to load discrepancies')).toBeNull()
      expect(pushMock).not.toHaveBeenCalledWith('/login')
    })

    it('edge: a failure that is not a 403 still shows the error toast', async () => {
      getWorkspaceMock.mockRejectedValue({ statusCode: 500, message: 'Internal server error' })
      listDiscrepanciesMock.mockResolvedValue(listOf([]))

      renderPage()

      // The workspace header loads once in the [id] layout (WorkspaceProvider),
      // so a failed workspace read toasts there.
      expect(await screen.findByText('Failed to load workspace')).toBeDefined()
      expect(screen.queryByRole('heading', { name: "You don't have access to this workspace" })).toBeNull()
    })
  })

  describe('evidence export', () => {
    it('error: a failed export toasts the reason, re-enables the button and keeps the list', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
      exportEvidenceTrailMock.mockRejectedValue({
        statusCode: 422,
        message: 'Too many flags to export at once; narrow the filters',
      })

      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Export evidence' }))

      expect(await screen.findByText('Failed to export evidence')).toBeDefined()
      expect(screen.getByText('Too many flags to export at once; narrow the filters')).toBeDefined()
      await waitFor(() => expect((screen.getByRole('button', { name: 'Export evidence' }) as HTMLButtonElement).disabled).toBe(false))
      expect(screen.getByText('SKU-100')).toBeDefined()
    })

    it('error: a 401 on export sends the user to login instead of toasting', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
      exportEvidenceTrailMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })

      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Export evidence' }))

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'))
      expect(screen.queryByText('Failed to export evidence')).toBeNull()
    })

    it('edge: the button is disabled when the scope has no flags, and a click does nothing', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([]))

      renderPage()
      const button = (await screen.findByRole('button', { name: 'Export evidence' })) as HTMLButtonElement

      expect(button.disabled).toBe(true)
      fireEvent.click(button)
      expect(exportEvidenceTrailMock).not.toHaveBeenCalled()
    })

    it('edge: a plain member sees the button too, since members can read every flag', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'member' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))

      renderPage()

      expect(await screen.findByRole('button', { name: 'Export evidence' })).toBeDefined()
    })

    it('edge: the button is disabled while the download is in flight, so it cannot double-fire', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()]))
      let finish: () => void = () => {}
      exportEvidenceTrailMock.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))

      renderPage()
      const button = (await screen.findByRole('button', { name: 'Export evidence' })) as HTMLButtonElement
      fireEvent.click(button)

      await waitFor(() => expect(button.disabled).toBe(true))
      fireEvent.click(button)
      expect(exportEvidenceTrailMock).toHaveBeenCalledTimes(1)
      finish()
      await waitFor(() => expect(button.disabled).toBe(false))
    })

    it('happy: exports the current filters, status and PO/invoice pair, not the visible page', async () => {
      mockSearchParams = new URLSearchParams('purchaseOrderId=po-1&invoiceId=inv-1')
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Alpha', role: 'owner' })
      listDiscrepanciesMock.mockResolvedValue(listOf([makeFlag()], { total: 40, totalPages: 2 }))

      renderPage()
      expect(await screen.findByText('SKU-100')).toBeDefined()
      fireEvent.click(screen.getByRole('radio', { name: 'Open' }))
      await waitFor(() => expect(listDiscrepanciesMock).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ status: 'open' })))
      fireEvent.click(await screen.findByRole('button', { name: 'Export evidence' }))

      await waitFor(() => expect(exportEvidenceTrailMock).toHaveBeenCalledTimes(1))
      const [workspaceId, filters] = exportEvidenceTrailMock.mock.calls[0]
      expect(workspaceId).toBe('ws-1')
      expect(filters).toEqual({ purchaseOrderId: 'po-1', invoiceId: 'inv-1', status: 'open' })
      expect(filters).not.toHaveProperty('page')
      expect(filters).not.toHaveProperty('pageSize')
    })
  })
})
