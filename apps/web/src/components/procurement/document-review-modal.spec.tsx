/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import { DocumentReviewModal } from '@/components/procurement/document-review-modal'

const listDocumentLinesMock = vi.fn()
const reviewDocumentMock = vi.fn()

vi.mock('@/lib/api/procurement', () => ({
  listDocumentLines: (...args: unknown[]) => listDocumentLinesMock(...args),
  reviewDocument: (...args: unknown[]) => reviewDocumentMock(...args),
  documentPageUrl: (workspaceId: string, kind: string, docId: string, n: number) =>
    `/api/workspaces/${workspaceId}/procurement/${kind}/${docId}/pages/${n}`,
}))

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    name: 'po-photo.pdf',
    status: 'done',
    sourceKind: 'image',
    pageCount: 1,
    detectedKind: 'purchase_order',
    reviewRequired: true,
    reviewedAt: null,
    reviewedBy: null,
    ...overrides,
  }
}

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    lineNumber: 1,
    sku: 'A-100',
    description: 'Oak shelf',
    quantity: '10',
    unitPrice: '4.50',
    lineTotal: '45.00',
    uom: 'EA',
    extractionConfidence: 0.92,
    sourceKind: 'image-extraction',
    editedAt: null,
    editedBy: null,
    ...overrides,
  }
}

function pageOf(items: unknown[], document = makeDocument(), extra: Record<string, unknown> = {}) {
  return { document, items, page: 1, pageSize: 100, total: items.length, totalPages: 1, ...extra }
}

function renderModal(props: Record<string, unknown> = {}) {
  const onClose = vi.fn()
  const onReviewed = vi.fn()
  const view = render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(DocumentReviewModal, {
        open: true,
        onClose,
        workspaceId: 'ws-1',
        kind: 'purchase-orders',
        docId: 'doc-1',
        canEdit: true,
        onReviewed,
        ...props,
      } as never),
    ),
  )
  return { ...view, onClose, onReviewed }
}

const rowOf = (label: string) => screen.getByLabelText(label).closest('tr') as HTMLElement

describe('DocumentReviewModal', () => {
  beforeEach(() => {
    listDocumentLinesMock.mockReset().mockResolvedValue(pageOf([makeLine()]))
    reviewDocumentMock.mockReset().mockResolvedValue({ id: 'doc-1', reviewedAt: '2026-10-06T00:00:00.000Z', rowCount: 1 })
  })

  afterEach(() => {
    cleanup()
  })

  it('error: a failed save shows a toast with the reason and keeps the reviewer’s edits', async () => {
    reviewDocumentMock.mockRejectedValue({ message: 'already reviewed' })
    const { onReviewed, onClose } = renderModal()
    const quantity = (await screen.findByLabelText('Quantity line 1')) as HTMLInputElement
    fireEvent.change(quantity, { target: { value: '15' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findAllByText('already reviewed')).not.toHaveLength(0)
    // In-modal banner, not only a toast that may already be gone.
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('already reviewed')
    expect((screen.getByLabelText('Quantity line 1') as HTMLInputElement).value).toBe('15')
    expect(onReviewed).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('error: a failed load shows an in-modal error banner with Try again, no skeleton and no Confirm', async () => {
    listDocumentLinesMock.mockRejectedValue({ message: 'Document not found' })
    renderModal()

    const dialog = screen.getByRole('dialog')
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Document not found')
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('error: Try again reloads the document and shows the lines', async () => {
    listDocumentLinesMock.mockRejectedValueOnce({ message: 'Document not found' })
    renderModal()

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText('Quantity line 1')).toBeDefined()
    expect(listDocumentLinesMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('error: Confirm is disabled while there are no lines to confirm', async () => {
    listDocumentLinesMock.mockResolvedValue(pageOf([]))
    renderModal()

    await screen.findByText('No lines were read — add them or re-upload')

    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true)
    expect(reviewDocumentMock).not.toHaveBeenCalled()
  })

  it('edge: shows a loading skeleton (aria-busy) until the lines arrive', async () => {
    let release: (value: unknown) => void = () => {}
    listDocumentLinesMock.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    renderModal()

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByText('Loading the page and lines…')).toBeDefined()
    expect(screen.queryByLabelText('Quantity line 1')).toBeNull()

    release(pageOf([makeLine()]))

    await screen.findByLabelText('Quantity line 1')
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('edge: an empty read shows the empty state, not a table of blanks', async () => {
    listDocumentLinesMock.mockResolvedValue(pageOf([]))
    renderModal()

    expect(await screen.findByText('No lines were read — add them or re-upload')).toBeDefined()
    expect(screen.queryByLabelText('Quantity line 1')).toBeNull()
  })

  it('edge: a document the AI took for another kind shows the mismatch banner', async () => {
    listDocumentLinesMock.mockResolvedValue(pageOf([makeLine()], makeDocument({ detectedKind: 'invoice' })))
    renderModal({ kind: 'purchase-orders' })

    expect(await screen.findByText(/looks like an invoice/i)).toBeDefined()
  })

  it.each([
    ['matching kind', 'purchase_order', 'purchase-orders'],
    ['unknown kind', 'unknown', 'purchase-orders'],
    ['no detected kind', null, 'invoices'],
    ['matching receipt', 'goods_receipt', 'goods-receipts'],
  ] as const)('edge: no mismatch banner for %s', async (_title, detectedKind, kind) => {
    listDocumentLinesMock.mockResolvedValue(pageOf([makeLine()], makeDocument({ detectedKind })))
    renderModal({ kind })

    await screen.findByLabelText(kind === 'goods-receipts' ? 'Accepted line 1' : 'Quantity line 1')
    expect(screen.queryByText(/looks like an?/i)).toBeNull()
  })

  it('edge: a line read below 0.6 confidence is marked data-low-confidence="true"; 0.6, higher and unknown are not', async () => {
    listDocumentLinesMock.mockResolvedValue(
      pageOf([
        makeLine({ id: 'l1', lineNumber: 1, extractionConfidence: 0.59 }),
        makeLine({ id: 'l2', lineNumber: 2, extractionConfidence: 0.6 }),
        makeLine({ id: 'l3', lineNumber: 3, extractionConfidence: 0.95 }),
        makeLine({ id: 'l4', lineNumber: 4, extractionConfidence: null }),
      ]),
    )
    renderModal()
    await screen.findByLabelText('Quantity line 1')

    expect(rowOf('Quantity line 1').getAttribute('data-low-confidence')).toBe('true')
    for (const n of [2, 3, 4]) {
      expect(rowOf(`Quantity line ${n}`).getAttribute('data-low-confidence')).not.toBe('true')
    }
  })

  it('edge: a low-confidence row’s inputs are described by a screen-reader hint; other rows’ are not', async () => {
    listDocumentLinesMock.mockResolvedValue(
      pageOf([
        makeLine({ id: 'l1', lineNumber: 1, extractionConfidence: 0.3 }),
        makeLine({ id: 'l2', lineNumber: 2, extractionConfidence: 0.9 }),
      ]),
    )
    renderModal()
    const low = await screen.findByLabelText('Quantity line 1')

    const hintId = low.getAttribute('aria-describedby')
    expect(hintId).toBeTruthy()
    const hint = document.getElementById(hintId as string)
    expect(hint?.textContent).toBe('Low confidence — check against the page')
    expect(hint?.className).toContain('sr-only')
    expect(screen.getByLabelText('Quantity line 2').getAttribute('aria-describedby')).toBeNull()
  })

  it('edge: a document that did not come from photos shows no page image and no page tabs', async () => {
    listDocumentLinesMock.mockResolvedValue(pageOf([makeLine()], makeDocument({ sourceKind: 'csv', pageCount: 3 })))
    renderModal()

    await screen.findByLabelText('Quantity line 1')

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('edge: a member sees the lines read-only with no Confirm, Add line or Remove', async () => {
    renderModal({ canEdit: false })

    const quantity = (await screen.findByLabelText('Quantity line 1')) as HTMLInputElement
    expect(quantity.readOnly || quantity.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add line' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove line 1' })).toBeNull()
  })

  it('edge: an already reviewed document is read-only even for an owner', async () => {
    listDocumentLinesMock.mockResolvedValue(
      pageOf([makeLine()], makeDocument({ reviewedAt: '2026-10-05T00:00:00.000Z', reviewedBy: 'user-1' })),
    )
    renderModal({ canEdit: true })

    const quantity = (await screen.findByLabelText('Quantity line 1')) as HTMLInputElement
    expect(quantity.readOnly || quantity.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })

  it('edge: with more than 100 lines it loads every page, 100 at a time', async () => {
    const first = Array.from({ length: 100 }, (_, i) => makeLine({ id: `l${i + 1}`, lineNumber: i + 1 }))
    const second = [makeLine({ id: 'l101', lineNumber: 101 })]
    listDocumentLinesMock
      .mockResolvedValueOnce(pageOf(first, makeDocument(), { total: 101, totalPages: 2 }))
      .mockResolvedValueOnce(pageOf(second, makeDocument(), { page: 2, total: 101, totalPages: 2 }))
    renderModal()

    await screen.findByLabelText('Quantity line 101')

    expect(listDocumentLinesMock).toHaveBeenCalledTimes(2)
    expect(listDocumentLinesMock).toHaveBeenNthCalledWith(1, 'ws-1', 'purchase-orders', 'doc-1', { page: 1, pageSize: 100 })
    expect(listDocumentLinesMock).toHaveBeenNthCalledWith(2, 'ws-1', 'purchase-orders', 'doc-1', { page: 2, pageSize: 100 })
  })

  it('edge: a goods receipt edits received, accepted and rejected, with no price columns', async () => {
    listDocumentLinesMock.mockResolvedValue(
      pageOf(
        [makeLine({ unitPrice: null, lineTotal: null, quantity: null, quantityReceived: '8', quantityAccepted: '7', quantityRejected: '1' })],
        makeDocument({ detectedKind: 'goods_receipt' }),
      ),
    )
    renderModal({ kind: 'goods-receipts' })

    expect(((await screen.findByLabelText('Received line 1')) as HTMLInputElement).value).toBe('8')
    expect((screen.getByLabelText('Accepted line 1') as HTMLInputElement).value).toBe('7')
    expect((screen.getByLabelText('Rejected line 1') as HTMLInputElement).value).toBe('1')
    expect(screen.queryByLabelText('Unit price line 1')).toBeNull()
  })

  it('edge: does not fetch anything while closed', () => {
    renderModal({ open: false })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(listDocumentLinesMock).not.toHaveBeenCalled()
  })

  it('edge: a multi-page document gets page tabs that switch the image', async () => {
    listDocumentLinesMock.mockResolvedValue(pageOf([makeLine()], makeDocument({ pageCount: 3 })))
    renderModal()

    await screen.findByLabelText('Quantity line 1')
    expect(screen.getAllByRole('tab', { name: /^Page \d$/ })).toHaveLength(3)
    expect(screen.getByRole('img', { name: 'Page 1 of 3, photo of po-photo.pdf' }).getAttribute('src')).toBe(
      '/api/workspaces/ws-1/procurement/purchase-orders/doc-1/pages/1',
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Page 2' }))

    expect(screen.getByRole('img', { name: 'Page 2 of 3, photo of po-photo.pdf' }).getAttribute('src')).toBe(
      '/api/workspaces/ws-1/procurement/purchase-orders/doc-1/pages/2',
    )
  })

  it('regression: removing a line leaves it out of the confirmed payload', async () => {
    listDocumentLinesMock.mockResolvedValue(
      pageOf([makeLine({ id: 'l1', lineNumber: 1 }), makeLine({ id: 'l2', lineNumber: 2, sku: 'B-200' })]),
    )
    renderModal()
    await screen.findByLabelText('Quantity line 1')

    fireEvent.click(screen.getByRole('button', { name: 'Remove line 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(reviewDocumentMock).toHaveBeenCalledTimes(1))
    const lines = reviewDocumentMock.mock.calls[0][3].lines as Array<{ id?: string }>
    expect(lines.map((line) => line.id)).toEqual(['l2'])
  })

  it('happy: Confirm sends the edited lines and a line added by hand (no id), then reports reviewed', async () => {
    const { onReviewed } = renderModal()
    fireEvent.change(await screen.findByLabelText('Quantity line 1'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Unit price line 1'), { target: { value: '4.75' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add line' }))
    fireEvent.change(screen.getByLabelText('Description line 2'), { target: { value: 'Added by hand' } })
    fireEvent.change(screen.getByLabelText('Quantity line 2'), { target: { value: '3' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(reviewDocumentMock).toHaveBeenCalledTimes(1))
    const [workspaceId, kind, docId, body] = reviewDocumentMock.mock.calls[0]
    expect([workspaceId, kind, docId]).toEqual(['ws-1', 'purchase-orders', 'doc-1'])
    expect(body.lines).toHaveLength(2)
    expect(body.lines[0]).toMatchObject({ id: 'line-1', sku: 'A-100', quantity: '15', unitPrice: '4.75' })
    expect(body.lines[1]).toMatchObject({ description: 'Added by hand', quantity: '3' })
    expect('id' in body.lines[1]).toBe(false)
    await waitFor(() => expect(onReviewed).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('po-photo.pdf reviewed')).toBeDefined()
  })

  it('happy: shows the first page image beside the lines', async () => {
    renderModal()

    await screen.findByLabelText('Quantity line 1')

    expect(screen.getByRole('img', { name: 'Page 1 of 1, photo of po-photo.pdf' }).getAttribute('src')).toBe(
      '/api/workspaces/ws-1/procurement/purchase-orders/doc-1/pages/1',
    )
    expect(listDocumentLinesMock).toHaveBeenCalledWith('ws-1', 'purchase-orders', 'doc-1', { page: 1, pageSize: 100 })
  })
})
