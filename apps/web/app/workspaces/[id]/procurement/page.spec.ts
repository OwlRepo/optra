/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const downloadProcurementDocumentMock = vi.fn()
const logoutMock = vi.fn()
const listVendorsMock = vi.fn()
const listGoodsReceiptsMock = vi.fn()
const uploadGoodsReceiptMock = vi.fn()

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
  listGoodsReceipts: (...args: unknown[]) => listGoodsReceiptsMock(...args),
  uploadGoodsReceipt: (...args: unknown[]) => uploadGoodsReceiptMock(...args),
  uploadPurchaseOrder: (...args: unknown[]) => uploadPurchaseOrderMock(...args),
  uploadInvoice: (...args: unknown[]) => uploadInvoiceMock(...args),
  compareDocuments: (...args: unknown[]) => compareDocumentsMock(...args),
  downloadProcurementDocument: (...args: unknown[]) => downloadProcurementDocumentMock(...args),
}))

vi.mock('@/lib/api/catalog', () => ({
  listVendors: (...args: unknown[]) => listVendorsMock(...args),
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
  hasSourceFile: true,
}

const doneInvoice = {
  id: 'inv-1',
  name: 'invoice-march.csv',
  status: 'done' as const,
  rowCount: 10,
  lastError: null,
  createdAt: '2026-07-02T00:00:00.000Z',
  hasSourceFile: true,
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
    listVendorsMock.mockReset()
    listGoodsReceiptsMock.mockReset()
    listGoodsReceiptsMock.mockResolvedValue([])
    uploadGoodsReceiptMock.mockReset()
    // Default for every test: one vendor exists, so the PO modal shows its form
    // rather than the "no vendors yet" empty state. Tests that care override it.
    listVendorsMock.mockResolvedValue([
      { id: 'vendor-1', name: 'Nordwerk Interiors', contactInfo: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    compareDocumentsMock.mockReset()
    downloadProcurementDocumentMock.mockReset()
    logoutMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
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

    // S3b: picking a file opens the header form instead of uploading, because
    // POLICY v1 #3's vendor cannot be read out of the document.
    const vendorSelect = await screen.findByLabelText('Vendor')
    fireEvent.change(vendorSelect, { target: { value: 'vendor-1' } })
    fireEvent.change(screen.getByLabelText('PO number'), { target: { value: 'PO-2026-1180' } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => {
      expect(uploadPurchaseOrderMock).toHaveBeenCalledWith('ws-1', file, {
        vendorId: 'vendor-1',
        poNumber: 'PO-2026-1180',
        currency: 'USD',
      })
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

    fireEvent.change(await screen.findByLabelText('Vendor'), { target: { value: 'vendor-1' } })
    fireEvent.change(screen.getByLabelText('PO number'), { target: { value: 'PO-2026-1180' } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    expect(await screen.findByText('Upload failed')).toBeDefined()
    expect(await screen.findByText('File type not supported')).toBeDefined()
  })

  // POLICY v1 #3 makes the vendor mandatory, so a workspace with none cannot
  // complete this form. Saying so beats letting the user submit into a 404.
  it('explains the dead end instead of uploading when the workspace has no vendors', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])
    listVendorsMock.mockResolvedValue([])

    renderPage()

    await screen.findByText('No purchase orders yet')

    const file = new File(['content'], 'po-march.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('No vendors yet')).toBeDefined()
    expect(uploadPurchaseOrderMock).not.toHaveBeenCalled()
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

  it('offers a source download only for rows that have stored bytes', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }] })
    listPurchaseOrdersMock.mockResolvedValue([
      donePurchaseOrder,
      { ...donePurchaseOrder, id: 'po-2', name: 'no-bytes.csv', hasSourceFile: false },
    ])
    listInvoicesMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => expect(screen.getByLabelText('Download po-march.csv')).toBeTruthy())
    expect(screen.queryByLabelText('Download no-bytes.csv')).toBeNull()
  })

  it('downloads a purchase order with its kind and id', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }] })
    listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
    listInvoicesMock.mockResolvedValue([])
    downloadProcurementDocumentMock.mockResolvedValue(undefined)

    renderPage()
    await waitFor(() => expect(screen.getByLabelText('Download po-march.csv')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Download po-march.csv'))

    await waitFor(() =>
      expect(downloadProcurementDocumentMock).toHaveBeenCalledWith('ws-1', 'purchase-orders', 'po-1'),
    )
  })

  // The list is member-readable and so is the file behind it, unlike upload
  // and compare which are owner/admin.
  it('shows the download control to a member', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'member' }] })
    listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
    listInvoicesMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => expect(screen.getByLabelText('Download po-march.csv')).toBeTruthy())
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

  // Frames 2.1–2.6. Declared in error > edge > regression > happy order. The
  // five regression cases are the pre-alignment tests whose setup or selectors
  // changed on purpose: the tabs now carry a count in their accessible name,
  // the skeleton no longer exposes a `shimmer` class, and Run comparison only
  // exists once a parsed PO and invoice exist (2.3 faded panel, C-3 #14).
  // Each keeps the behaviour it checked.
  describe('design alignment (frames 2.1–2.6)', () => {
    it('edge: a member is told who runs comparisons and gets no pickers', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([doneInvoice])

      renderPage()

      expect(await screen.findByText('Owners & admins run comparisons')).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull()
      expect(screen.queryByLabelText('Purchase order')).toBeNull()
      expect(screen.queryByLabelText('Invoice')).toBeNull()
      // Members have no pickers (owner decision), so the copy must not offer them.
      expect(screen.getByText('Running a comparison needs an owner or admin.')).toBeDefined()
      expect(screen.queryByText(/Members can pick documents/)).toBeNull()
    })

    it('edge: with nothing Ready the compare panel is faded, explains why, and offers no pickers', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      expect(
        await screen.findByText(
          'Selects list no documents and the button stays disabled until one PO and one invoice are Ready.',
        ),
      ).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull()
      expect(screen.queryByLabelText('Purchase order')).toBeNull()
    })

    it('edge: an owner sees the Run comparison step, not the member chip', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([doneInvoice])

      renderPage()

      expect(await screen.findByText('Review the exceptions')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Run comparison' })).toBeDefined()
      expect(screen.queryByText('Owners & admins run comparisons')).toBeNull()
    })

    it('edge: an empty tab labels its formats from the file input accept list', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('No purchase orders yet')
      expect(screen.getByText('csv / xlsx / pdf')).toBeDefined()

      fireEvent.click(screen.getByRole('tab', { name: /^Goods Receipts/ }))

      expect(await screen.findByText('No goods receipts yet')).toBeDefined()
      expect(screen.getByText('csv / xlsx')).toBeDefined()
    })

    it('edge: with no vendors the PO form is blocked by an amber prerequisite that links out to vendors', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])
      listVendorsMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('No purchase orders yet')
      const file = new File(['content'], 'po-march.csv', { type: 'text/csv' })
      fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })

      expect(await screen.findByText('Needs a vendor first')).toBeDefined()
      expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Go to vendors' }))
      expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/vendors')
    })

    it('edge: only a processing row pulses; a queued row waits without it', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([
        { ...donePurchaseOrder, id: 'po-p', name: 'parsing.pdf', status: 'processing', rowCount: null },
        { ...donePurchaseOrder, id: 'po-q', name: 'queued.csv', status: 'pending', rowCount: null },
      ])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('parsing.pdf')
      // C-3 #9: Badge marks a pulsing pill with `data-pulse` on its root.
      expect(screen.getByText('Processing').closest('[data-pulse]')).not.toBeNull()
      expect(screen.getByText('Queued').closest('[data-pulse]')).toBeNull()
    })

    it('regression: hides upload controls for a member and shows them for owner/admin', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([doneInvoice])
      listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'member' }], nextCursor: null })

      const view = renderPage()

      await screen.findByText('po-march.csv')
      expect(screen.queryByRole('button', { name: 'Upload purchase order' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull()

      view.unmount()

      listWorkspacesMock.mockResolvedValueOnce({ items: [{ id: 'ws-1', role: 'admin' }], nextCursor: null })
      renderPage()

      expect((await screen.findAllByRole('button', { name: 'Upload purchase order' })).length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'Run comparison' })).toBeDefined()
    })

    it('regression: shows a loading placeholder while the initial fetch is in flight', async () => {
      let resolveWorkspace: (value: unknown) => void = () => {}
      getWorkspaceMock.mockImplementation(
        () => new Promise((resolve) => { resolveWorkspace = resolve }),
      )
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      const { container } = renderPage()

      expect(container.querySelector('div[aria-busy="true"]')).not.toBeNull()
      resolveWorkspace({ id: 'ws-1', name: 'Acme' })

      await screen.findByText('No purchase orders yet')
      expect(container.querySelector('div[aria-busy="true"]')).toBeNull()
    })

    it('regression: renders empty state with correct copy for the active tab', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      expect(await screen.findByText('No purchase orders yet')).toBeDefined()
      expect(
        screen.getByText('Upload a CSV, XLSX, or PDF purchase order to compare it against an invoice.'),
      ).toBeDefined()

      fireEvent.click(screen.getByRole('tab', { name: /^Invoices/ }))

      expect(await screen.findByText('No invoices yet')).toBeDefined()
      expect(
        screen.getByText('Upload a CSV, XLSX, or PDF invoice to compare it against a purchase order.'),
      ).toBeDefined()
    })

    // S5. A receipt answers exactly one purchase order (POLICY v1 #2), so picking
    // a file opens the same kind of header form the invoice upload uses.
    it('regression: uploads a goods receipt against a chosen purchase order', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([])
      listGoodsReceiptsMock.mockResolvedValue([])
      uploadGoodsReceiptMock.mockResolvedValue({ id: 'grn-1', name: 'grn.csv', status: 'pending' })

      renderPage()

      fireEvent.click(await screen.findByRole('tab', { name: /^Goods Receipts/ }))

      const file = new File(['sku,qty received\nA1,8'], 'grn.csv', { type: 'text/csv' })
      const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[]
      const grnInput = inputs.find((input) => input.accept === '.csv,.xlsx')
      expect(grnInput).toBeDefined()
      fireEvent.change(grnInput as HTMLInputElement, { target: { files: [file] } })

      // Scoped by id: the compare section further down the page also labels a
      // select "Purchase order", so a label query matches two controls.
      const poSelect = await waitFor(() => {
        const el = document.querySelector('#grn-po')
        expect(el).not.toBeNull()
        return el as HTMLSelectElement
      })
      fireEvent.change(poSelect, { target: { value: 'po-1' } })
      fireEvent.change(screen.getByLabelText('Goods receipt number'), { target: { value: 'GRN-9001' } })
      fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

      await waitFor(() => {
        expect(uploadGoodsReceiptMock).toHaveBeenCalledWith('ws-1', file, {
          purchaseOrderId: 'po-1',
          grnNumber: 'GRN-9001',
        })
      })
      expect(await screen.findByText('Goods receipt uploaded')).toBeDefined()
    })

    // Same dead-end handling as the PO modal's no-vendors case: explain it rather
    // than letting the user submit into a guaranteed 404.
    it('regression: explains that a purchase order is needed before a receipt can be uploaded', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])
      listGoodsReceiptsMock.mockResolvedValue([])

      renderPage()

      fireEvent.click(await screen.findByRole('tab', { name: /^Goods Receipts/ }))

      const file = new File(['sku,qty received\nA1,8'], 'grn.csv', { type: 'text/csv' })
      const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[]
      const grnInput = inputs.find((input) => input.accept === '.csv,.xlsx')
      fireEvent.change(grnInput as HTMLInputElement, { target: { files: [file] } })

      expect(await screen.findByText('Needs a purchase order first')).toBeDefined()
      expect(screen.getAllByText('No purchase orders yet').length).toBeGreaterThan(0)
      expect(uploadGoodsReceiptMock).not.toHaveBeenCalled()
    })

    it('happy: each tab carries the count of the list it holds', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder, { ...donePurchaseOrder, id: 'po-2', name: 'po-april.csv' }])
      listInvoicesMock.mockResolvedValue([doneInvoice])
      listGoodsReceiptsMock.mockResolvedValue([])

      renderPage()

      const poTab = await screen.findByRole('tab', { name: /^Purchase Orders/ })
      expect(within(poTab).getByText('2')).toBeDefined()
      expect(within(screen.getByRole('tab', { name: /^Invoices/ })).getByText('1')).toBeDefined()
      expect(within(screen.getByRole('tab', { name: /^Goods Receipts/ })).getByText('0')).toBeDefined()
    })

    it('happy: the picked file is held, not uploaded, under the step-2 eyebrow', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('No purchase orders yet')
      const file = new File(['content'], 'po-march.csv', { type: 'text/csv' })
      fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })

      expect(await screen.findByText('held · not uploaded yet')).toBeDefined()
      expect(screen.getByText('Upload · step 2 of 2')).toBeDefined()
      expect(screen.getByText('po-march.csv')).toBeDefined()
      expect(uploadPurchaseOrderMock).not.toHaveBeenCalled()
    })

    it('edge: below lg the header shortens to the workspace name and "Purchase orders" (frame 4.2)', async () => {
      stubDesktop(false)
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      const banner = await screen.findByRole('banner')
      expect(await within(banner).findByText('Acme')).toBeDefined()
      expect(within(banner).getByRole('heading', { level: 1, name: 'Purchase orders' })).toBeDefined()
      expect(within(banner).queryByText('Acme / Matching')).toBeNull()
    })

    it('happy: the header names the workspace in the breadcrumb and capitalises the role', async () => {
      stubDesktop(true)
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      expect((await screen.findAllByText('Acme / Matching')).length).toBeGreaterThan(0)
      expect(screen.getAllByText('Owner').length).toBeGreaterThan(0)
    })

    // C-3 #13 / frame 4.2: below lg the active tab's upload is a full-width
    // button under the tabs (CSS hides one of the two per breakpoint; jsdom
    // renders both), and it opens the same file input.
    it('happy: the active tab offers its upload again as the mobile button under the tabs', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme' })
      listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-1', role: 'owner' }], nextCursor: null })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([doneInvoice])

      renderPage()

      fireEvent.click(await screen.findByRole('tab', { name: /^Invoices/ }))

      const buttons = await screen.findAllByRole('button', { name: 'Upload invoice' })
      expect(buttons).toHaveLength(2)
      const input = Array.from(document.querySelectorAll('input[type="file"]'))[0] as HTMLInputElement
      const click = vi.spyOn(input, 'click')
      fireEvent.click(buttons[0])
      expect(click).toHaveBeenCalled()
    })
  })

  // B14. A 403 on load used to fall through to the empty lists: an error toast,
  // then "No purchase orders yet" and the Compare card, as if the workspace
  // were simply empty.
  describe('no access (B14)', () => {
    function denyAccess() {
      const denied = { statusCode: 403, message: 'Not a member of this workspace' }
      getWorkspaceMock.mockRejectedValue(denied)
      listPurchaseOrdersMock.mockRejectedValue(denied)
      listInvoicesMock.mockRejectedValue(denied)
      listGoodsReceiptsMock.mockRejectedValue(denied)
      listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })
    }

    it('error: a non-member sees the no-access state, not an error toast', async () => {
      denyAccess()

      renderPage()

      expect(await screen.findByRole('heading', { name: "You don't have access to this workspace" })).toBeDefined()
      expect(screen.queryByText('Failed to load procurement documents')).toBeNull()
      expect(pushMock).not.toHaveBeenCalledWith('/login')
    })

    it('edge: a failure that is not a 403 still shows the error toast and the page', async () => {
      getWorkspaceMock.mockRejectedValue({ statusCode: 500, message: 'Internal server error' })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])
      listWorkspacesMock.mockResolvedValue({ items: [], nextCursor: null })

      renderPage()

      expect(await screen.findByText('Failed to load procurement documents')).toBeDefined()
      expect(screen.queryByRole('heading', { name: "You don't have access to this workspace" })).toBeNull()
    })

    it('regression: a non-member sees no empty lists, no compare card and no upload control', async () => {
      denyAccess()

      renderPage()

      await screen.findByRole('heading', { name: "You don't have access to this workspace" })
      expect(screen.queryByText('No purchase orders yet')).toBeNull()
      expect(screen.queryByText('Compare')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Upload purchase order' })).toBeNull()
      expect(screen.queryByRole('tablist')).toBeNull()
    })
  })
})
