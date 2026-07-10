/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import ProcurementPage from './page'

const pushMock = vi.fn()
const routerMock = { push: pushMock }
const getWorkspaceMock = vi.fn()
const listWorkspacesMock = vi.fn()
const listPurchaseOrdersMock = vi.fn()
const listInvoicesMock = vi.fn()
const uploadPurchaseOrderMock = vi.fn()
const uploadInvoiceMock = vi.fn()
const compareDocumentsMock = vi.fn()
const logoutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/workspaces/ws-1/procurement',
}))

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
}))

vi.mock('@/lib/api/procurement', () => ({
  listPurchaseOrders: (...args: unknown[]) => listPurchaseOrdersMock(...args),
  listInvoices: (...args: unknown[]) => listInvoicesMock(...args),
  uploadPurchaseOrder: (...args: unknown[]) => uploadPurchaseOrderMock(...args),
  uploadInvoice: (...args: unknown[]) => uploadInvoiceMock(...args),
  compareDocuments: (...args: unknown[]) => compareDocumentsMock(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}))

const donePurchaseOrder = {
  id: 'po-1',
  name: 'po-march.csv',
  status: 'done' as const,
  rowCount: 12,
  lastError: null,
  createdAt: '2026-07-01T00:00:00.000Z',
}

const doneInvoice = {
  id: 'inv-1',
  name: 'invoice-march.csv',
  status: 'done' as const,
  rowCount: 10,
  lastError: null,
  createdAt: '2026-07-02T00:00:00.000Z',
}

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(ProcurementPage, {
        params: { id: 'ws-1' },
      }),
    ),
  )
}

describe('ProcurementPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    getWorkspaceMock.mockReset()
    listWorkspacesMock.mockReset()
    listPurchaseOrdersMock.mockReset()
    listInvoicesMock.mockReset()
    uploadPurchaseOrderMock.mockReset()
    uploadInvoiceMock.mockReset()
    compareDocumentsMock.mockReset()
    logoutMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a loading skeleton while the initial fetch is in flight', async () => {
    let resolveWorkspace: (value: unknown) => void = () => {}
    getWorkspaceMock.mockImplementation(
      () => new Promise((resolve) => { resolveWorkspace = resolve }),
    )
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])

    const { container } = renderPage()

    expect(container.querySelectorAll('[class*="shimmer"]').length).toBeGreaterThan(0)
    resolveWorkspace({ id: 'ws-1', name: 'Acme' })

    await screen.findByText('No purchase orders yet')
  })

  it('renders empty state with correct copy for the active tab', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No purchase orders yet')).toBeDefined()
    expect(
      screen.getByText('Upload a CSV, XLSX, or PDF purchase order to compare it against an invoice.'),
    ).toBeDefined()

    fireEvent.click(screen.getByRole('tab', { name: 'Invoices' }))

    expect(await screen.findByText('No invoices yet')).toBeDefined()
    expect(
      screen.getByText('Upload a CSV, XLSX, or PDF invoice to compare it against a purchase order.'),
    ).toBeDefined()
  })

  it('hides upload controls for a member and shows them for owner/admin', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])
    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })

    const view = renderPage()

    await screen.findByText('No purchase orders yet')
    expect(screen.queryByRole('button', { name: 'Upload purchase order' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull()

    view.unmount()

    listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'admin' }], nextCursor: null })
    renderPage()

    expect((await screen.findAllByRole('button', { name: 'Upload purchase order' })).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Run comparison' })).toBeDefined()
  })

  it('uploads a purchase order and shows a success toast after refreshing the list', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listPurchaseOrdersMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([donePurchaseOrder])
    listInvoicesMock.mockResolvedValue([])
    uploadPurchaseOrderMock.mockResolvedValue({ id: 'po-1', name: 'po-march.csv', status: 'pending' })

    renderPage()

    await screen.findByText('No purchase orders yet')

    const file = new File(['content'], 'po-march.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadPurchaseOrderMock).toHaveBeenCalledWith('ws-1', file)
      expect(screen.getAllByText('po-march.csv').length).toBeGreaterThan(0)
    })
    expect(await screen.findByText('Purchase order uploaded')).toBeDefined()
  })

  it('shows an error toast when upload fails', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])
    uploadPurchaseOrderMock.mockRejectedValue({ message: 'File type not supported' })

    renderPage()

    await screen.findByText('No purchase orders yet')

    const file = new File(['content'], 'po-march.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('Upload failed')).toBeDefined()
    expect(await screen.findByText('File type not supported')).toBeDefined()
  })

  it('runs a comparison and navigates to the discrepancies page with query params', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
    listInvoicesMock.mockResolvedValue([doneInvoice])
    compareDocumentsMock.mockResolvedValue({
      comparedAt: '2026-07-10T00:00:00.000Z',
      counts: { quantity_mismatch: 0, price_mismatch: 0, missing_on_invoice: 0, missing_on_po: 0 },
      flags: [],
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('po-march.csv').length).toBeGreaterThan(0)
    })

    fireEvent.change(screen.getByLabelText('Purchase order'), { target: { value: 'po-1' } })
    fireEvent.change(screen.getByLabelText('Invoice'), { target: { value: 'inv-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))

    await waitFor(() => {
      expect(compareDocumentsMock).toHaveBeenCalledWith('ws-1', { purchaseOrderId: 'po-1', invoiceId: 'inv-1' })
      expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/discrepancies?purchaseOrderId=po-1&invoiceId=inv-1')
    })
  })

  it('shows the exact backend error message verbatim when comparison fails', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
    listInvoicesMock.mockResolvedValue([doneInvoice])
    compareDocumentsMock.mockRejectedValue({ message: 'Invoice has not finished parsing yet' })

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('po-march.csv').length).toBeGreaterThan(0)
    })

    fireEvent.change(screen.getByLabelText('Purchase order'), { target: { value: 'po-1' } })
    fireEvent.change(screen.getByLabelText('Invoice'), { target: { value: 'inv-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))

    expect(await screen.findByText('Invoice has not finished parsing yet')).toBeDefined()
    expect(pushMock).not.toHaveBeenCalledWith(expect.stringContaining('/discrepancies'))
  })

  it('redirects to login on a 401 during initial load', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
    listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login')
    })
  })
})
