/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import ProcurementPage from './page'
import { WorkspaceProvider } from '@/components/workspace-context'

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
  uploadPurchaseOrderPhotos: vi.fn(),
  uploadInvoicePhotos: vi.fn(),
  uploadGoodsReceiptPhotos: vi.fn(),
  listDocumentLines: vi.fn(),
  reviewDocument: vi.fn(),
  documentPageUrl: (ws: string, kind: string, id: string, n: number) =>
    `/api/workspaces/${ws}/procurement/${kind}/${id}/pages/${n}`,
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

// The dialog and the review modal have their own specs. Here they are stubs
// that expose the props the page hands them, so this file proves the wiring
// (which tab, which lists, who may edit) and nothing else.
vi.mock('@/components/procurement/batch-upload-dialog', async () => {
  const React = await import('react')
  return {
    BatchUploadDialog: (props: {
      open: boolean
      onClose: () => void
      workspaceId: string
      tab: string
      vendors: unknown[]
      purchaseOrders: Array<{ id: string }>
      onUploaded: () => void
    }) =>
      React.createElement(
        'div',
        {
          'data-testid': 'batch-upload-dialog',
          'data-open': String(props.open),
          'data-tab': props.tab,
          'data-workspace-id': props.workspaceId,
          'data-vendor-count': String(props.vendors.length),
          'data-po-ids': props.purchaseOrders.map((po) => po.id).join(','),
        },
        props.open
          ? [
              React.createElement('button', { key: 'u', onClick: props.onUploaded }, 'stub uploaded'),
              React.createElement('button', { key: 'c', onClick: props.onClose }, 'stub close'),
            ]
          : null,
      ),
  }
})

vi.mock('@/components/procurement/document-review-modal', async () => {
  const React = await import('react')
  return {
    DocumentReviewModal: (props: {
      open: boolean
      onClose: () => void
      workspaceId: string
      kind: string
      docId: string
      canEdit: boolean
      onReviewed: () => void
    }) =>
      props.open
        ? React.createElement(
            'div',
            {
              'data-testid': 'document-review-modal',
              'data-kind': props.kind,
              'data-doc-id': props.docId,
              'data-can-edit': String(props.canEdit),
            },
            React.createElement('button', { onClick: props.onReviewed }, 'stub reviewed'),
            React.createElement('button', { onClick: props.onClose }, 'stub review close'),
          )
        : null,
  }
})

const dialog = () => screen.queryByTestId('batch-upload-dialog')
const dialogOpen = () => dialog()?.getAttribute('data-open') === 'true'

const photoPendingPo = {
  ...donePurchaseOrder,
  id: 'po-photo',
  name: 'po-photo.pdf',
  sourceKind: 'image',
  pageCount: 2,
  reviewRequired: true,
  reviewedAt: null,
}

const reviewedPhotoPo = {
  ...photoPendingPo,
  id: 'po-reviewed',
  name: 'po-reviewed.pdf',
  reviewedAt: '2026-10-05T00:00:00.000Z',
}

const photoPendingInvoice = {
  ...doneInvoice,
  id: 'inv-photo',
  name: 'inv-photo.pdf',
  sourceKind: 'image',
  pageCount: 1,
  reviewRequired: true,
  reviewedAt: null,
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
      React.createElement(WorkspaceProvider, { workspaceId: 'ws-1' }, React.createElement(ProcurementPage, {
        params: { id: 'ws-1' },
      })),
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

  it('regression: an owner whose workspace is not on page 1 of listWorkspaces still gets the upload control', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
    listWorkspacesMock.mockResolvedValue({ items: [{ id: 'ws-other', role: 'owner' }], nextCursor: 'page-2' })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])

    renderPage()

    await screen.findByText('No purchase orders yet')
    expect((await screen.findAllByRole('button', { name: 'Upload purchase order' })).length).toBeGreaterThan(0)
  })

  // The header modals and their single-file handlers are gone: the upload
  // buttons open BatchUploadDialog (batch-upload-dialog.spec.tsx owns the
  // upload requests, the held-file rows, the error toast and the dead-end
  // states that used to be asserted here).
  it('happy: the upload button opens the batch dialog on the purchase-orders tab, and its onUploaded refreshes the list', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
    listPurchaseOrdersMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([donePurchaseOrder])
    listInvoicesMock.mockResolvedValue([])

    renderPage()

    await screen.findByText('No purchase orders yet')
    expect(dialogOpen()).toBe(false)
    expect(document.querySelector('input[type="file"]')).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Upload purchase order' })[0])

    expect(dialogOpen()).toBe(true)
    expect(dialog()?.getAttribute('data-tab')).toBe('purchase-orders')
    expect(dialog()?.getAttribute('data-workspace-id')).toBe('ws-1')
    expect(dialog()?.getAttribute('data-vendor-count')).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'stub uploaded' }))

    await waitFor(() => {
      expect(listPurchaseOrdersMock).toHaveBeenCalledTimes(2)
      expect(screen.getAllByText('po-march.csv').length).toBeGreaterThan(0)
    })
  })

  it('edge: closing the dialog closes it without refreshing', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])

    renderPage()

    await screen.findByText('No purchase orders yet')
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload purchase order' })[0])
    expect(dialogOpen()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'stub close' }))

    expect(dialogOpen()).toBe(false)
    expect(listPurchaseOrdersMock).toHaveBeenCalledTimes(1)
  })

  // POLICY v1 #3 dead end: the page's job is to hand the dialog the vendor
  // list; the dialog renders "No vendors yet" (dialog spec).
  it('edge: a workspace with no vendors hands the dialog an empty vendor list', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
    listPurchaseOrdersMock.mockResolvedValue([])
    listInvoicesMock.mockResolvedValue([])
    listVendorsMock.mockResolvedValue([])

    renderPage()

    await screen.findByText('No purchase orders yet')
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload purchase order' })[0])

    await waitFor(() => expect(dialog()?.getAttribute('data-vendor-count')).toBe('0'))
  })

  it('runs a comparison and navigates to the discrepancies page with query params', async () => {
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
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
    getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'member' })
    listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
    listInvoicesMock.mockResolvedValue([])

    renderPage()

    await waitFor(() => expect(screen.getByLabelText('Download po-march.csv')).toBeTruthy())
  })

  it('redirects to login on a 401 during initial load', async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' })
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
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'member' })
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
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
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
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([doneInvoice])

      renderPage()

      expect(await screen.findByText('Review the exceptions')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Run comparison' })).toBeDefined()
      expect(screen.queryByText('Owners & admins run comparisons')).toBeNull()
    })

    it('edge: an empty tab labels its formats from the file input accept list', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('No purchase orders yet')
      expect(screen.getByText('csv / xlsx / pdf')).toBeDefined()

      fireEvent.click(screen.getByRole('tab', { name: /^Goods Receipts/ }))

      expect(await screen.findByText('No goods receipts yet')).toBeDefined()
      expect(screen.getByText('csv / xlsx')).toBeDefined()
    })

    it('edge: only a processing row pulses; a queued row waits without it', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
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
      getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Acme', role: 'member' })

      const view = renderPage()

      await screen.findByText('po-march.csv')
      expect(screen.queryByRole('button', { name: 'Upload purchase order' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull()

      view.unmount()

      getWorkspaceMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Acme', role: 'admin' })
      renderPage()

      expect((await screen.findAllByRole('button', { name: 'Upload purchase order' })).length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'Run comparison' })).toBeDefined()
    })

    it('regression: shows a loading placeholder while the initial fetch is in flight', async () => {
      let resolveWorkspace: (value: unknown) => void = () => {}
      getWorkspaceMock.mockImplementation(
        () => new Promise((resolve) => { resolveWorkspace = resolve }),
      )
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      const { container } = renderPage()

      expect(container.querySelector('div[aria-busy="true"]')).not.toBeNull()
      resolveWorkspace({ id: 'ws-1', name: 'Acme', role: 'owner' })

      await screen.findByText('No purchase orders yet')
      expect(container.querySelector('div[aria-busy="true"]')).toBeNull()
    })

    it('regression: renders empty state with correct copy for the active tab', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      expect(await screen.findByText('No purchase orders yet')).toBeDefined()
      // Phone photos are accepted now, and the empty state says so.
      expect(screen.getByText(/photo/i).textContent).toMatch(/purchase order/i)

      fireEvent.click(screen.getByRole('tab', { name: /^Invoices/ }))

      expect(await screen.findByText('No invoices yet')).toBeDefined()
      expect(screen.getByText(/photo/i).textContent).toMatch(/invoice/i)
    })

    // S5. A receipt answers exactly one purchase order (POLICY v1 #2); the
    // header form lives in the dialog now, so the page's part is the tab and
    // the purchase-order list it hands over.
    it('regression: the goods-receipts upload opens the dialog on that tab with the purchase orders to link', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([])
      listGoodsReceiptsMock.mockResolvedValue([])

      renderPage()

      fireEvent.click(await screen.findByRole('tab', { name: /^Goods Receipts/ }))
      fireEvent.click(screen.getAllByRole('button', { name: 'Upload goods receipt' })[0])

      expect(dialogOpen()).toBe(true)
      expect(dialog()?.getAttribute('data-tab')).toBe('goods-receipts')
      expect(dialog()?.getAttribute('data-po-ids')).toBe('po-1')
    })

    it('regression: a workspace with no purchase orders hands the receipt dialog an empty list', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])
      listGoodsReceiptsMock.mockResolvedValue([])

      renderPage()

      fireEvent.click(await screen.findByRole('tab', { name: /^Goods Receipts/ }))
      fireEvent.click(screen.getAllByRole('button', { name: 'Upload goods receipt' })[0])

      expect(dialogOpen()).toBe(true)
      expect(dialog()?.getAttribute('data-po-ids')).toBe('')
    })

    it('regression: the invoices upload opens the dialog on the invoices tab', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([doneInvoice])

      renderPage()

      fireEvent.click(await screen.findByRole('tab', { name: /^Invoices/ }))
      fireEvent.click(screen.getAllByRole('button', { name: 'Upload invoice' })[0])

      expect(dialog()?.getAttribute('data-tab')).toBe('invoices')
      expect(dialogOpen()).toBe(true)
    })

    it('happy: each tab carries the count of the list it holds', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder, { ...donePurchaseOrder, id: 'po-2', name: 'po-april.csv' }])
      listInvoicesMock.mockResolvedValue([doneInvoice])
      listGoodsReceiptsMock.mockResolvedValue([])

      renderPage()

      const poTab = await screen.findByRole('tab', { name: /^Purchase Orders/ })
      expect(within(poTab).getByText('2')).toBeDefined()
      expect(within(screen.getByRole('tab', { name: /^Invoices/ })).getByText('1')).toBeDefined()
      expect(within(screen.getByRole('tab', { name: /^Goods Receipts/ })).getByText('0')).toBeDefined()
    })

    it('edge: below lg the header shortens to the workspace name and "Purchase orders" (frame 4.2)', async () => {
      stubDesktop(false)
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
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
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      expect((await screen.findAllByText('Acme / Matching')).length).toBeGreaterThan(0)
      expect(screen.getAllByText('Owner').length).toBeGreaterThan(0)
    })

    // C-3 #13 / frame 4.2: below lg the active tab's upload is a full-width
    // button under the tabs (CSS hides one of the two per breakpoint; jsdom
    // renders both), and it opens the same batch dialog.
    it('happy: the active tab offers its upload again as the mobile button under the tabs', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([doneInvoice])

      renderPage()

      fireEvent.click(await screen.findByRole('tab', { name: /^Invoices/ }))

      const buttons = await screen.findAllByRole('button', { name: 'Upload invoice' })
      expect(buttons).toHaveLength(2)
      expect(dialogOpen()).toBe(false)
      fireEvent.click(buttons[1])
      expect(dialogOpen()).toBe(true)
      expect(dialog()?.getAttribute('data-tab')).toBe('invoices')
    })

    it('regression: both upload buttons keep the data-tour anchors the onboarding tour targets', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('po-march.csv')
      expect(document.querySelector('button[data-tour="procurement-upload"]')).not.toBeNull()
      expect(document.querySelector('button[data-tour="procurement-upload-mobile"]')).not.toBeNull()
      expect(document.querySelector('[data-tour="procurement-tabs"]')).not.toBeNull()
      expect(document.querySelector('[data-tour="procurement-compare"]')).not.toBeNull()
    })
  })

  // Photo intake: AI-read documents wait for a human confirm before compare.
  describe('review gate (photo intake)', () => {
    it('error: a purchase order still parsing is not offered for review', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([{ ...photoPendingPo, status: 'processing', rowCount: null }])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('po-photo.pdf')
      expect(screen.queryByText('Needs review')).toBeNull()
      expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull()
    })

    it('error: a failed photo purchase order is not offered for review', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([{ ...photoPendingPo, status: 'failed', lastError: 'could not read' }])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('po-photo.pdf')
      expect(screen.queryByText('Needs review')).toBeNull()
      expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull()
    })

    it('edge: a reviewed photo document and an ordinary CSV show neither the badge nor Review', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([
        donePurchaseOrder,
        { ...donePurchaseOrder, id: 'po-flagless', name: 'old.csv', reviewRequired: false, reviewedAt: null },
        reviewedPhotoPo,
      ])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      await screen.findByText('po-reviewed.pdf')
      expect(screen.queryByText('Needs review')).toBeNull()
      expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull()
    })

    it('edge: compare pickers leave out documents pending review but keep reviewed ones', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([donePurchaseOrder, photoPendingPo, reviewedPhotoPo])
      listInvoicesMock.mockResolvedValue([doneInvoice, photoPendingInvoice])

      renderPage()

      const poSelect = (await screen.findByLabelText('Purchase order')) as HTMLSelectElement
      const invoiceSelect = screen.getByLabelText('Invoice') as HTMLSelectElement
      const names = (select: HTMLSelectElement) => Array.from(select.options).map((option) => option.textContent)
      expect(names(poSelect)).toEqual(['Select purchase order', 'po-march.csv', 'po-reviewed.pdf'])
      expect(names(invoiceSelect)).toEqual(['Select invoice', 'invoice-march.csv'])
    })

    it('edge: when the only done documents are pending review the compare panel stays faded', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock.mockResolvedValue([photoPendingPo])
      listInvoicesMock.mockResolvedValue([photoPendingInvoice])

      renderPage()

      await screen.findAllByText('po-photo.pdf')
      expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull()
      expect(screen.queryByLabelText('Purchase order')).toBeNull()
    })

    it('edge: a member sees the Needs review badge and can open the review read-only', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'member' })
      listPurchaseOrdersMock.mockResolvedValue([photoPendingPo])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      expect(await screen.findByText('Needs review')).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: 'Review po-photo.pdf' }))

      expect(screen.getByTestId('document-review-modal').getAttribute('data-can-edit')).toBe('false')
    })

    it('regression: the badge and Review sit on the receipts tab too, opening the review for that kind', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'admin' })
      listPurchaseOrdersMock.mockResolvedValue([])
      listInvoicesMock.mockResolvedValue([])
      listGoodsReceiptsMock.mockResolvedValue([{ ...photoPendingPo, id: 'grn-photo', name: 'grn-photo.pdf' }])

      renderPage()

      fireEvent.click(await screen.findByRole('tab', { name: /^Goods Receipts/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Review grn-photo.pdf' }))

      const modal = screen.getByTestId('document-review-modal')
      expect(modal.getAttribute('data-kind')).toBe('goods-receipts')
      expect(modal.getAttribute('data-doc-id')).toBe('grn-photo')
    })

    it('happy: a done photo document shows Needs review and Review opens the modal; reviewing refreshes the list', async () => {
      getWorkspaceMock.mockResolvedValue({ id: 'ws-1', name: 'Acme', role: 'owner' })
      listPurchaseOrdersMock
        .mockResolvedValueOnce([photoPendingPo])
        .mockResolvedValueOnce([{ ...photoPendingPo, reviewedAt: '2026-10-06T00:00:00.000Z' }])
      listInvoicesMock.mockResolvedValue([])

      renderPage()

      expect(await screen.findByText('Needs review')).toBeDefined()
      expect(screen.queryByTestId('document-review-modal')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Review po-photo.pdf' }))

      const modal = screen.getByTestId('document-review-modal')
      expect(modal.getAttribute('data-kind')).toBe('purchase-orders')
      expect(modal.getAttribute('data-doc-id')).toBe('po-photo')
      expect(modal.getAttribute('data-can-edit')).toBe('true')

      fireEvent.click(screen.getByRole('button', { name: 'stub reviewed' }))

      await waitFor(() => expect(screen.queryByText('Needs review')).toBeNull())
      expect(listPurchaseOrdersMock).toHaveBeenCalledTimes(2)
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

      renderPage()

      // The workspace header loads once in the [id] layout (WorkspaceProvider),
      // so a failed workspace read toasts there.
      expect(await screen.findByText('Failed to load workspace')).toBeDefined()
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
