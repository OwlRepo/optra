/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import { DiscrepancyReviewModal } from './discrepancy-review-modal'

const listDecisionsMock = vi.fn()
const recordDecisionMock = vi.fn()
const listRunsMock = vi.fn()

vi.mock('@/lib/api/procurement', () => ({
  listDiscrepancyDecisions: (...args: unknown[]) => listDecisionsMock(...args),
  recordDiscrepancyDecision: (...args: unknown[]) => recordDecisionMock(...args),
  listComparisonRuns: (...args: unknown[]) => listRunsMock(...args),
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
    reason: 'Three of ten arrived.',
    status: 'open',
    dismissedAt: null,
    dismissedBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
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
    // Each label also appears as an <option> in the outcome picker, so the
    // badge is one of several matches rather than the only one.
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

  it('records the chosen outcome with its note', async () => {
    const onDecided = vi.fn()
    renderModal({ onDecided })

    fireEvent.change(await screen.findByLabelText('Outcome'), { target: { value: 'vendor_dispute' } })
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
})
