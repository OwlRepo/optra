/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import { DiscrepancyReviewModal } from './discrepancy-review-modal'

const listDecisionsMock = vi.fn()
const recordDecisionMock = vi.fn()
const listRunsMock = vi.fn()
const downloadMock = vi.fn()

vi.mock('@/lib/api/procurement', () => ({
  listDiscrepancyDecisions: (...args: unknown[]) => listDecisionsMock(...args),
  recordDiscrepancyDecision: (...args: unknown[]) => recordDecisionMock(...args),
  listComparisonRuns: (...args: unknown[]) => listRunsMock(...args),
  downloadProcurementDocument: (...args: unknown[]) => downloadMock(...args),
}))

function makeFlag(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flag-1',
    workspaceId: 'ws-1',
    purchaseOrderId: 'po-1',
    invoiceId: 'inv-1',
    comparisonRunId: 'run-1',
    poLineItemId: 'po-line-1',
    invoiceLineItemId: 'inv-line-1',
    goodsReceiptLineItemId: null,
    sku: 'SKU-100',
    flagType: 'short_receipt',
    poValue: '10',
    receivedValue: '7',
    invoiceValue: '7',
    delta: '-3',
    poUnitPrice: null,
    invoiceUnitPrice: null,
    contractUnitPrice: null,
    contractTermId: null,
    reason: 'Three of ten arrived.',
    status: 'open',
    dismissedAt: null,
    dismissedBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    poLine: null,
    invoiceLine: null,
    receiptLine: null,
    ...overrides,
  }
}

function makeCitation(overrides: Record<string, unknown> = {}) {
  return {
    lineNumber: 7,
    sourceRow: 9,
    sourceSheet: null,
    extractionConfidence: null,
    documentId: 'po-doc-1',
    ...overrides,
  }
}

function makeDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dec-1',
    discrepancyFlagId: 'flag-1',
    comparisonRunId: 'run-1',
    actorUserId: 'user-1',
    actorEmail: 'reviewer@example.com',
    actorRole: 'admin',
    outcome: 'approved_exception',
    note: 'Agreed with the vendor by phone.',
    createdAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  }
}

function renderModal(props: Record<string, unknown> = {}) {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(DiscrepancyReviewModal, {
        open: true,
        onClose: vi.fn(),
        onDecided: vi.fn(),
        workspaceId: 'ws-1',
        canManage: true,
        flag: makeFlag(),
        ...props,
      } as never),
    ),
  )
}

describe('DiscrepancyReviewModal', () => {
  beforeEach(() => {
    listDecisionsMock.mockReset().mockResolvedValue([])
    recordDecisionMock.mockReset().mockResolvedValue(makeDecision())
    listRunsMock.mockReset().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })
    downloadMock.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the three numbers the reviewer is deciding on', async () => {
    renderModal()

    expect(await screen.findByText('SKU-100')).toBeDefined()
    expect(screen.getByText('Ordered')).toBeDefined()
    expect(screen.getByText('Received')).toBeDefined()
    expect(screen.getByText('Billed')).toBeDefined()
    expect(screen.getByText('Three of ten arrived.')).toBeDefined()
  })

  // Oldest first: a later decision correcting an earlier one only makes sense
  // after it.
  it('lists the decision history oldest first, naming who decided and as what', async () => {
    listDecisionsMock.mockResolvedValue([
      makeDecision({ id: 'd1', note: 'First call.', createdAt: '2026-07-02T00:00:00.000Z' }),
      makeDecision({
        id: 'd2',
        outcome: 'resolved',
        note: 'Vendor credited us.',
        createdAt: '2026-07-03T00:00:00.000Z',
      }),
    ])

    renderModal()

    const first = await screen.findByText('First call.')
    const second = screen.getByText('Vendor credited us.')
    // Oldest first, asserted as document order rather than as two lookups that
    // would pass in either sequence.
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByText(/reviewer@example\.com/).length).toBe(2)
    // Each label also appears as a radio card in the outcome picker, so the
    // history entry is one of several matches rather than the only one.
    expect(screen.getAllByText('Approved exception').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Resolved').length).toBeGreaterThan(1)
  })

  it('falls back to the recorded role when the account behind a decision is gone', async () => {
    listDecisionsMock.mockResolvedValue([makeDecision({ actorUserId: null, actorEmail: null, actorRole: 'owner' })])

    renderModal()

    expect(await screen.findByText(/owner/)).toBeDefined()
  })

  it('shows this pair’s comparison runs', async () => {
    listRunsMock.mockResolvedValue({
      items: [
        {
          id: 'run-1',
          purchaseOrderId: 'po-1',
          invoiceId: 'inv-1',
          mode: 'three_way',
          strategyVersion: 1,
          status: 'succeeded',
          initiatedBy: 'user-1',
          initiatedByEmail: 'runner@example.com',
          poLineCount: 3,
          invoiceLineCount: 3,
          goodsReceiptLineCount: 3,
          flagCount: 2,
          startedAt: '2026-07-01T00:00:00.000Z',
          finishedAt: '2026-07-01T00:00:01.000Z',
          lastError: null,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    })

    renderModal()

    expect(await screen.findByText('Three-way')).toBeDefined()
    expect(screen.getByText(/runner@example\.com/)).toBeDefined()
    expect(listRunsMock).toHaveBeenCalledWith('ws-1', { purchaseOrderId: 'po-1', invoiceId: 'inv-1', pageSize: 5 })
  })

  // POLICY v1 #7: the note is required, and the API refuses a blank one. The
  // form should not make the reviewer discover that from a 400.
  it('will not submit a decision without a note', async () => {
    renderModal()

    const submit = (await screen.findByRole('button', { name: 'Record decision' })) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Checked the packing slip.' } })
    expect(submit.disabled).toBe(false)
  })

  it('surfaces the server’s refusal rather than a generic failure', async () => {
    recordDecisionMock.mockRejectedValue({ message: 'A decision note is required' })
    renderModal()

    fireEvent.change(await screen.findByLabelText('Decision note'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }))

    expect(await screen.findByText('A decision note is required')).toBeDefined()
  })

  // Reads are member-readable, writes are owner/admin — the form must match the
  // route rather than letting a member submit into a 403.
  it('shows history but no decision form to a member', async () => {
    listDecisionsMock.mockResolvedValue([makeDecision()])
    renderModal({ canManage: false })

    expect(await screen.findByText('Agreed with the vendor by phone.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull()
  })

  // S2. Where each side of the flag came from. Declared in error > edge >
  // regression > happy order; the existing cases above are the regression set.
  describe('source citations (S2)', () => {
    it('error: a failed source download toasts the reason and leaves the modal usable', async () => {
      downloadMock.mockRejectedValue({ message: 'Purchase order file is missing' })
      renderModal({ flag: makeFlag({ poLine: makeCitation() }) })

      fireEvent.click((await screen.findAllByRole('button', { name: /download/i }))[0])

      expect(await screen.findByText('Failed to download document')).toBeDefined()
      expect(screen.getByText('Purchase order file is missing')).toBeDefined()
      expect(screen.getByText('SKU-100')).toBeDefined()
    })

    it('edge: a citation with no source row and no confidence reads "PO line N"', async () => {
      renderModal({ flag: makeFlag({ poLine: makeCitation({ lineNumber: 4, sourceRow: null }) }) })

      expect(await screen.findByText('PO line 4')).toBeDefined()
    })

    it('edge: every citation null renders no Source block', async () => {
      renderModal()

      await screen.findByText('SKU-100')
      expect(screen.queryByText('Source')).toBeNull()
      expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
    })

    it('edge: an XLSX citation names the sheet and row', async () => {
      renderModal({ flag: makeFlag({ poLine: makeCitation({ sourceSheet: 'Orders' }) }) })

      expect(await screen.findByText('PO sheet Orders, row 9')).toBeDefined()
    })

    it('edge: a PDF citation says it was read from the PDF with a rounded confidence', async () => {
      renderModal({
        flag: makeFlag({ poLine: makeCitation({ sourceRow: null, extractionConfidence: 0.925 }) }),
      })

      expect(await screen.findByText('PO line 7 · read from PDF, 93% confidence')).toBeDefined()
    })

    it('edge: a confidence of 1 reads 100%', async () => {
      renderModal({
        flag: makeFlag({ invoiceLine: makeCitation({ sourceRow: null, extractionConfidence: 1, documentId: 'inv-doc-1' }) }),
      })

      expect(await screen.findByText('Invoice line 7 · read from PDF, 100% confidence')).toBeDefined()
    })

    it('edge: a photo line reads "read from photo" with a rounded confidence', async () => {
      renderModal({
        flag: makeFlag({
          poLine: makeCitation({ sourceRow: null, extractionConfidence: 0.925, sourceKind: 'image-extraction' }),
        }),
      })

      expect(await screen.findByText('PO line 7 · read from photo, 93% confidence')).toBeDefined()
    })

    it('edge: a line added during review reads "added by reviewer"', async () => {
      renderModal({
        flag: makeFlag({ invoiceLine: makeCitation({ sourceRow: null, sourceKind: 'manual', documentId: 'inv-doc-1' }) }),
      })

      expect(await screen.findByText('Invoice line 7 · added by reviewer')).toBeDefined()
    })

    it('edge: an edited line reads "edited by reviewer" and wins over every other source', async () => {
      renderModal({
        flag: makeFlag({
          poLine: makeCitation({
            sourceRow: null,
            extractionConfidence: 0.9,
            sourceKind: 'image-extraction',
            editedAt: '2026-10-06T09:00:00.000Z',
          }),
          receiptLine: makeCitation({
            sourceRow: null,
            sourceKind: 'manual',
            editedAt: '2026-10-06T09:00:00.000Z',
            documentId: 'grn-doc-1',
          }),
        }),
      })

      expect(await screen.findByText('PO line 7 · edited by reviewer')).toBeDefined()
      expect(screen.getByText('Receipt line 7 · edited by reviewer')).toBeDefined()
      expect(document.body.textContent ?? '').not.toMatch(/read from photo|added by reviewer/)
    })

    it('edge: a manual line outranks the photo wording when it carries a confidence', async () => {
      renderModal({
        flag: makeFlag({
          poLine: makeCitation({ sourceRow: null, extractionConfidence: 0.8, sourceKind: 'manual' }),
        }),
      })

      expect(await screen.findByText('PO line 7 · added by reviewer')).toBeDefined()
    })

    it('regression: a PDF citation with a null sourceKind and no edit keeps the PDF wording', async () => {
      renderModal({
        flag: makeFlag({
          poLine: makeCitation({ sourceRow: null, extractionConfidence: 0.925, sourceKind: null, editedAt: null }),
        }),
      })

      expect(await screen.findByText('PO line 7 · read from PDF, 93% confidence')).toBeDefined()
    })

    it('regression: no citation wording mentions a page', async () => {
      renderModal({
        flag: makeFlag({
          poLine: makeCitation(),
          invoiceLine: makeCitation({ sourceRow: null, extractionConfidence: 0.5, documentId: 'inv-doc-1' }),
          receiptLine: makeCitation({ documentId: 'grn-doc-1' }),
        }),
      })

      await screen.findByText('Source')
      expect(document.body.textContent ?? '').not.toMatch(/\bpage\b/i)
    })

    it('happy: a CSV citation reads "PO row 9" and its download fetches the purchase order', async () => {
      renderModal({ flag: makeFlag({ poLine: makeCitation() }) })

      expect(await screen.findByText('PO row 9')).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: /download/i }))

      await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('ws-1', 'purchase-orders', 'po-doc-1'))
    })

    it('happy: invoice and receipt sides cite their rows and download their own documents', async () => {
      renderModal({
        flag: makeFlag({
          invoiceLine: makeCitation({ sourceRow: 5, documentId: 'inv-doc-1' }),
          receiptLine: makeCitation({ sourceRow: 3, documentId: 'grn-doc-1' }),
        }),
      })

      expect(await screen.findByText('Invoice row 5')).toBeDefined()
      expect(screen.getByText('Receipt row 3')).toBeDefined()
      const buttons = screen.getAllByRole('button', { name: /download/i })
      expect(buttons).toHaveLength(2)
      buttons.forEach((button) => fireEvent.click(button))

      await waitFor(() => {
        expect(downloadMock).toHaveBeenCalledWith('ws-1', 'invoices', 'inv-doc-1')
        expect(downloadMock).toHaveBeenCalledWith('ws-1', 'goods-receipts', 'grn-doc-1')
      })
    })
  })

  // Frames 2.9–2.10. error > edge > regression > happy. The regression cases
  // moved here on purpose: the outcome is four radio cards now (was a
  // <select>), and the price rows read "unit price" in the Mono key/value
  // style the frame uses (was "Unit price").
  describe('design alignment (frames 2.9–2.10)', () => {
    it('error: a refused decision keeps the reviewer’s chosen outcome selected', async () => {
      recordDecisionMock.mockRejectedValue({ message: 'A decision note is required' })
      renderModal()

      fireEvent.click(await screen.findByRole('radio', { name: 'Vendor dispute' }))
      fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'x' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record decision' }))

      expect(await screen.findByText('A decision note is required')).toBeDefined()
      expect((screen.getByRole('radio', { name: 'Vendor dispute' }) as HTMLInputElement).checked).toBe(true)
    })

    it('edge: a header-level finding is titled as such and still names its flag type', async () => {
      renderModal({
        flag: makeFlag({ sku: null, flagType: 'currency_mismatch', poValue: 'USD', receivedValue: null, invoiceValue: 'CAD', delta: null }),
      })

      expect(await screen.findByText('Header-level finding')).toBeDefined()
      expect(screen.getByText('Currency mismatch')).toBeDefined()
      expect(screen.queryByText('delta')).toBeNull()
    })

    it('edge: a member gets an explicit Close in the read-only footer', async () => {
      const onClose = vi.fn()
      renderModal({ canManage: false, onClose })

      fireEvent.click(await screen.findByText('Close', { selector: 'button' }))

      expect(onClose).toHaveBeenCalled()
    })

    it('edge: a member sees the Read-only chip and no outcome choices', async () => {
      renderModal({ canManage: false })

      expect(await screen.findByText('Read-only')).toBeDefined()
      expect(screen.getByText('Only an owner or admin can record a decision on this discrepancy.')).toBeDefined()
      expect(screen.queryByRole('radiogroup', { name: 'Outcome' })).toBeNull()
    })

    it('regression: decision history and comparison runs stay lists, one item per entry', async () => {
      listDecisionsMock.mockResolvedValue([
        makeDecision({ id: 'd1', note: 'First call.', createdAt: '2026-07-02T00:00:00.000Z' }),
        makeDecision({ id: 'd2', outcome: 'resolved', note: 'Vendor credited us.', createdAt: '2026-07-03T00:00:00.000Z' }),
      ])

      renderModal()

      const entry = (await screen.findByText('Vendor credited us.')).closest('li')
      expect(entry).not.toBeNull()
      expect(entry?.closest('ol')?.querySelectorAll(':scope > li')).toHaveLength(2)
      expect(within(entry as HTMLElement).getByText('Resolved')).toBeDefined()
    })

    it('regression: records the outcome chosen from the radio cards with its note', async () => {
      const onDecided = vi.fn()
      renderModal({ onDecided })

      fireEvent.click(await screen.findByRole('radio', { name: 'Vendor dispute' }))
      fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Raised with the vendor.' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record decision' }))

      await waitFor(() => {
        expect(recordDecisionMock).toHaveBeenCalledWith('ws-1', 'flag-1', {
          outcome: 'vendor_dispute',
          note: 'Raised with the vendor.',
        })
        expect(onDecided).toHaveBeenCalled()
      })
    })

    it('regression: the outcome radio group defaults to False positive', async () => {
      renderModal()

      const group = await screen.findByRole('radiogroup', { name: 'Outcome' })
      expect(group).toBeDefined()
      expect(screen.getAllByRole('radio')).toHaveLength(4)
      expect((screen.getByRole('radio', { name: 'False positive' }) as HTMLInputElement).checked).toBe(true)
    })

    // S9. The unit price used to vanish whenever another exception outranked it.
    it('regression: shows the unit prices behind a flag that is not itself about price', async () => {
      renderModal({ flag: makeFlag({ poUnitPrice: '25', invoiceUnitPrice: '27.5' }) })

      expect(await screen.findByText('unit price')).toBeTruthy()
      expect(screen.getByText(/25/)).toBeTruthy()
      expect(screen.getByText(/27\.5/)).toBeTruthy()
    })

    it('regression: does not repeat the prices on a flag whose own numbers already are the prices', async () => {
      renderModal({
        flag: makeFlag({ flagType: 'price_mismatch', poValue: '25', invoiceValue: '27.5', poUnitPrice: '25', invoiceUnitPrice: '27.5' }),
      })

      await screen.findByText('Ordered')
      expect(screen.queryByText('unit price')).toBeNull()
    })

    it('regression: says nothing about price when neither side stated one', async () => {
      renderModal({ flag: makeFlag() })

      await screen.findByText('Ordered')
      expect(screen.queryByText('unit price')).toBeNull()
    })

    it('happy: the note is marked required', async () => {
      renderModal()

      expect(await screen.findByText('(required)')).toBeDefined()
    })

    it('happy: the header carries the flag-type pill and the status', async () => {
      renderModal()

      expect(await screen.findByText('Short receipt')).toBeDefined()
      expect(screen.getByText('Open')).toBeDefined()
      expect(screen.getByText('Review discrepancy')).toBeDefined()
    })

    it('happy: the delta line shows the finding’s delta', async () => {
      renderModal()

      expect(await screen.findByText('delta')).toBeDefined()
      expect(screen.getByText('-3')).toBeDefined()
    })

    // C-3 #5: the title is the SKU, but the dialog keeps its frame name.
    it('happy: the dialog is named "Review discrepancy" while its title is the SKU', async () => {
      renderModal()

      expect(await screen.findByRole('dialog', { name: 'Review discrepancy' })).toBeDefined()
      expect(screen.getByText('SKU-100')).toBeDefined()
    })
  })
})
