/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@repo/ui'
import { BatchUploadDialog } from '@/components/procurement/batch-upload-dialog'

const pushMock = vi.fn()
const uploadPurchaseOrderMock = vi.fn()
const uploadInvoiceMock = vi.fn()
const uploadGoodsReceiptMock = vi.fn()
const uploadPurchaseOrderPhotosMock = vi.fn()
const uploadInvoicePhotosMock = vi.fn()
const uploadGoodsReceiptPhotosMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/lib/api/procurement', () => ({
  uploadPurchaseOrder: (...args: unknown[]) => uploadPurchaseOrderMock(...args),
  uploadInvoice: (...args: unknown[]) => uploadInvoiceMock(...args),
  uploadGoodsReceipt: (...args: unknown[]) => uploadGoodsReceiptMock(...args),
  uploadPurchaseOrderPhotos: (...args: unknown[]) => uploadPurchaseOrderPhotosMock(...args),
  uploadInvoicePhotos: (...args: unknown[]) => uploadInvoicePhotosMock(...args),
  uploadGoodsReceiptPhotos: (...args: unknown[]) => uploadGoodsReceiptPhotosMock(...args),
}))

type Tab = 'purchase-orders' | 'invoices' | 'goods-receipts'

const vendors = [
  { id: 'vendor-1', name: 'Nordwerk Interiors', contactInfo: null, createdAt: '2026-01-01T00:00:00.000Z' },
]

const purchaseOrders = [
  {
    id: 'po-1',
    name: 'po-march.csv',
    poNumber: 'PO-2026-1180',
    status: 'done',
    rowCount: 12,
    lastError: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    hasSourceFile: true,
    currency: 'USD',
  },
]

function csv(name: string) {
  return new File(['sku,qty\nA1,2'], name, { type: 'text/csv' })
}

function jpg(name: string) {
  return new File(['jpeg'], name, { type: 'image/jpeg' })
}

function renderDialog(props: Partial<React.ComponentProps<typeof BatchUploadDialog>> = {}) {
  const onClose = vi.fn()
  const onUploaded = vi.fn()
  const view = render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(BatchUploadDialog, {
        open: true,
        onClose,
        workspaceId: 'ws-1',
        tab: 'purchase-orders',
        vendors,
        purchaseOrders,
        onUploaded,
        ...props,
      } as never),
    ),
  )
  return { ...view, onClose, onUploaded }
}

const filesInput = () => screen.getByTestId('batch-files-input') as HTMLInputElement
const photosInput = () => screen.getByTestId('batch-photos-input') as HTMLInputElement
const rows = () => screen.getAllByRole('group')

function pick(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } })
}

function fillPo(row: HTMLElement, number: string) {
  fireEvent.change(within(row).getByLabelText('Vendor'), { target: { value: 'vendor-1' } })
  fireEvent.change(within(row).getByLabelText('PO number'), { target: { value: number } })
}

function fillInvoice(row: HTMLElement, number: string) {
  fireEvent.change(within(row).getByLabelText('Purchase order'), { target: { value: 'po-1' } })
  fireEvent.change(within(row).getByLabelText('Invoice number'), { target: { value: number } })
}

function fillGrn(row: HTMLElement, number: string) {
  fireEvent.change(within(row).getByLabelText('Purchase order'), { target: { value: 'po-1' } })
  fireEvent.change(within(row).getByLabelText('Goods receipt number'), { target: { value: number } })
}

const uploadButton = () => screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement

describe('BatchUploadDialog', () => {
  beforeEach(() => {
    for (const mock of [
      pushMock,
      uploadPurchaseOrderMock,
      uploadInvoiceMock,
      uploadGoodsReceiptMock,
      uploadPurchaseOrderPhotosMock,
      uploadInvoicePhotosMock,
      uploadGoodsReceiptPhotosMock,
    ]) {
      mock.mockReset()
    }
    for (const mock of [uploadPurchaseOrderMock, uploadInvoiceMock, uploadGoodsReceiptMock]) {
      mock.mockResolvedValue({ id: 'doc-1', name: 'x', status: 'pending' })
    }
    for (const mock of [uploadPurchaseOrderPhotosMock, uploadInvoicePhotosMock, uploadGoodsReceiptPhotosMock]) {
      mock.mockResolvedValue({ id: 'doc-2', name: 'x.pdf', status: 'pending' })
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('error: a 6th file is refused with a message and no row is added', async () => {
    renderDialog()
    pick(filesInput(), ['1.csv', '2.csv', '3.csv', '4.csv', '5.csv'].map(csv))
    expect(rows()).toHaveLength(5)

    pick(filesInput(), [csv('6.csv')])

    expect(await screen.findByText(/5 files/)).toBeDefined()
    expect(rows()).toHaveLength(5)
  })

  it('error: a PDF on the goods-receipt tab is refused with a message and no row is added', async () => {
    renderDialog({ tab: 'goods-receipts' })

    pick(filesInput(), [new File(['%PDF'], 'grn.pdf', { type: 'application/pdf' })])

    expect(await screen.findByText(/grn\.pdf/)).toBeDefined()
    expect(screen.queryAllByRole('group')).toHaveLength(0)
  })

  it('error: a failed row shows its API message and a Retry while the other rows keep going', async () => {
    uploadPurchaseOrderMock
      .mockRejectedValueOnce({ message: 'File type not supported' })
      .mockResolvedValueOnce({ id: 'doc-b', name: 'b.csv', status: 'pending' })
    const { onUploaded } = renderDialog()
    pick(filesInput(), [csv('a.csv'), csv('b.csv')])
    fillPo(screen.getByRole('group', { name: 'a.csv' }), 'PO-A')
    fillPo(screen.getByRole('group', { name: 'b.csv' }), 'PO-B')

    fireEvent.click(uploadButton())

    await waitFor(() => expect(screen.getByRole('group', { name: 'b.csv' }).getAttribute('data-status')).toBe('done'))
    const failed = screen.getByRole('group', { name: 'a.csv' })
    expect(failed.getAttribute('data-status')).toBe('error')
    expect(within(failed).getByText('File type not supported')).toBeDefined()
    expect(uploadPurchaseOrderMock).toHaveBeenCalledTimes(2)
    expect(within(screen.getByRole('group', { name: 'b.csv' })).queryByRole('button', { name: /^Retry/ })).toBeNull()

    uploadPurchaseOrderMock.mockResolvedValueOnce({ id: 'doc-a', name: 'a.csv', status: 'pending' })
    fireEvent.click(within(failed).getByRole('button', { name: /^Retry/ }))

    await waitFor(() => expect(screen.getByRole('group', { name: 'a.csv' }).getAttribute('data-status')).toBe('done'))
    expect(uploadPurchaseOrderMock).toHaveBeenCalledTimes(3)
    expect(uploadPurchaseOrderMock.mock.calls[2][2]).toMatchObject({ poNumber: 'PO-A' })
    expect(onUploaded).toHaveBeenCalled()
  })

  it('error: a HEIC photo rejected by the server shows that message inline on its row', async () => {
    const message = 'HEIC/HEIF photos are not supported — export as JPEG and upload again'
    uploadPurchaseOrderPhotosMock.mockRejectedValue({ message })
    renderDialog()
    pick(photosInput(), [new File(['ftyp'], 'IMG_0001.heic', { type: 'image/heic' })])
    const row = screen.getByRole('group', { name: 'IMG_0001.heic' })
    fillPo(row, 'PO-H')

    fireEvent.click(uploadButton())

    await waitFor(() => expect(within(row).getByText(message)).toBeDefined())
    expect(row.getAttribute('data-status')).toBe('error')
  })

  it('error: Upload stays disabled until every row has its required header fields', () => {
    renderDialog()
    pick(filesInput(), [csv('a.csv'), csv('b.csv')])
    fillPo(screen.getByRole('group', { name: 'a.csv' }), 'PO-A')

    expect(uploadButton().disabled).toBe(true)

    fillPo(screen.getByRole('group', { name: 'b.csv' }), 'PO-B')

    expect(uploadButton().disabled).toBe(false)
  })

  it('error: with no files added yet Upload is disabled', () => {
    renderDialog()

    expect(uploadButton().disabled).toBe(true)
  })

  // POLICY v1 #3: the vendor is mandatory, so with none the form cannot be
  // completed. Say so instead of letting the user submit into a 404.
  it('error: with no vendors the PO tab explains the dead end, offers no pickers and links to vendors', () => {
    renderDialog({ vendors: [] })

    expect(screen.getByText('Needs a vendor first')).toBeDefined()
    expect(screen.getByText('No vendors yet')).toBeDefined()
    expect(screen.queryByTestId('batch-files-input')).toBeNull()
    expect(screen.queryByTestId('batch-photos-input')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Go to vendors' }))
    expect(pushMock).toHaveBeenCalledWith('/workspaces/ws-1/vendors')
    expect(uploadPurchaseOrderMock).not.toHaveBeenCalled()
  })

  it.each(['invoices', 'goods-receipts'] as const)(
    'error: with no purchase orders the %s tab says a purchase order is needed first',
    (tab) => {
      renderDialog({ tab, purchaseOrders: [] })

      expect(screen.getByText('Needs a purchase order first')).toBeDefined()
      expect(screen.getByText('No purchase orders yet')).toBeDefined()
      expect(screen.queryByTestId('batch-files-input')).toBeNull()
    },
  )

  it('edge: closed dialog renders nothing', () => {
    renderDialog({ open: false })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('edge: the photo picker is image/* and multiple, with no capture attribute (so the phone offers camera and library)', () => {
    renderDialog()

    expect(photosInput().getAttribute('accept')).toBe('image/*')
    expect(photosInput().multiple).toBe(true)
    expect(photosInput().hasAttribute('capture')).toBe(false)
  })

  it.each([
    ['purchase-orders', '.csv,.xlsx,.pdf'],
    ['invoices', '.csv,.xlsx,.pdf'],
    ['goods-receipts', '.csv,.xlsx'],
  ] as const)('edge: the %s file picker accepts %s and takes several files', (tab, accept) => {
    renderDialog({ tab })

    expect(filesInput().getAttribute('accept')).toBe(accept)
    expect(filesInput().multiple).toBe(true)
  })

  it('edge: photos picked together are one row; splitting makes one row per photo', () => {
    renderDialog()
    pick(photosInput(), [jpg('p1.jpg'), jpg('p2.jpg'), jpg('p3.jpg')])

    expect(rows()).toHaveLength(1)
    expect(screen.getByRole('group', { name: '3 photos' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Split into separate documents' }))

    expect(rows()).toHaveLength(3)
    expect(screen.getByRole('group', { name: 'p2.jpg' })).toBeDefined()
  })

  it('edge: a file row has no split control', () => {
    renderDialog()
    pick(filesInput(), [csv('a.csv')])

    expect(screen.queryByRole('button', { name: 'Split into separate documents' })).toBeNull()
  })

  it('edge: Copy from first row fills the shared fields on the others but never the PO number', () => {
    renderDialog()
    pick(filesInput(), [csv('a.csv'), csv('b.csv')])
    const first = screen.getByRole('group', { name: 'a.csv' })
    fillPo(first, 'PO-FIRST')
    fireEvent.change(within(first).getByLabelText('Currency'), { target: { value: 'EUR' } })

    fireEvent.click(screen.getByRole('button', { name: 'Copy from first row' }))

    const second = screen.getByRole('group', { name: 'b.csv' })
    expect((within(second).getByLabelText('Vendor') as HTMLSelectElement).value).toBe('vendor-1')
    expect((within(second).getByLabelText('Currency') as HTMLInputElement).value).toBe('EUR')
    expect((within(second).getByLabelText('PO number') as HTMLInputElement).value).toBe('')
  })

  it('edge: Copy from first row is offered only with two or more rows', () => {
    renderDialog()
    pick(filesInput(), [csv('a.csv')])

    expect(screen.queryByRole('button', { name: 'Copy from first row' })).toBeNull()

    pick(filesInput(), [csv('b.csv')])

    expect(screen.getByRole('button', { name: 'Copy from first row' })).toBeDefined()
  })

  it('edge: removing a row drops it and frees its slot in the 5-file limit', async () => {
    renderDialog()
    pick(filesInput(), ['1.csv', '2.csv', '3.csv', '4.csv', '5.csv'].map(csv))

    fireEvent.click(screen.getByRole('button', { name: 'Remove 1.csv' }))
    expect(rows()).toHaveLength(4)

    pick(filesInput(), [csv('6.csv')])
    expect(rows()).toHaveLength(5)
  })

  it('edge: each row starts ready and the picked file is held, not uploaded, until Upload', () => {
    renderDialog()
    pick(filesInput(), [csv('po-march.csv')])

    expect(screen.getByRole('group', { name: 'po-march.csv' }).getAttribute('data-status')).toBe('ready')
    expect(uploadPurchaseOrderMock).not.toHaveBeenCalled()
  })

  it('regression: a purchase-order row sends the same header as the old single-file modal, with the order date as ISO', async () => {
    const { onUploaded } = renderDialog()
    pick(filesInput(), [csv('po-march.csv')])
    const row = screen.getByRole('group', { name: 'po-march.csv' })
    fillPo(row, ' PO-2026-1180 ')
    fireEvent.change(within(row).getByLabelText(/Order date/), { target: { value: '2026-03-04' } })

    fireEvent.click(uploadButton())

    await waitFor(() => expect(uploadPurchaseOrderMock).toHaveBeenCalledTimes(1))
    expect(uploadPurchaseOrderMock).toHaveBeenCalledWith('ws-1', expect.any(File), {
      vendorId: 'vendor-1',
      poNumber: 'PO-2026-1180',
      currency: 'USD',
      orderedAt: '2026-03-04T00:00:00.000Z',
    })
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
  })

  it('regression: a blank order date is left out of the request (absent is not a guess)', async () => {
    renderDialog()
    pick(filesInput(), [csv('po.csv')])
    fillPo(screen.getByRole('group', { name: 'po.csv' }), 'PO-1')

    fireEvent.click(uploadButton())

    await waitFor(() => expect(uploadPurchaseOrderMock).toHaveBeenCalled())
    expect(uploadPurchaseOrderMock.mock.calls[0][2]).toEqual({ vendorId: 'vendor-1', poNumber: 'PO-1', currency: 'USD' })
  })

  it('regression: the currency is uppercased and trimmed like before', async () => {
    renderDialog()
    pick(filesInput(), [csv('po.csv')])
    const row = screen.getByRole('group', { name: 'po.csv' })
    fillPo(row, 'PO-1')
    fireEvent.change(within(row).getByLabelText('Currency'), { target: { value: 'eur' } })

    fireEvent.click(uploadButton())

    await waitFor(() => expect(uploadPurchaseOrderMock).toHaveBeenCalled())
    expect(uploadPurchaseOrderMock.mock.calls[0][2].currency).toBe('EUR')
  })

  it('happy: a mixed batch posts each row to its own endpoint, one after another, in row order', async () => {
    let releaseFirst: (value: unknown) => void = () => {}
    uploadPurchaseOrderMock.mockImplementationOnce(
      () => new Promise((resolve) => { releaseFirst = resolve }),
    )
    const { onUploaded } = renderDialog()
    const photoA = jpg('p1.jpg')
    const photoB = jpg('p2.jpg')
    pick(filesInput(), [csv('a.csv'), new File(['%PDF'], 'b.pdf', { type: 'application/pdf' })])
    pick(photosInput(), [photoA, photoB])
    fillPo(screen.getByRole('group', { name: 'a.csv' }), 'PO-A')
    fillPo(screen.getByRole('group', { name: 'b.pdf' }), 'PO-B')
    fillPo(screen.getByRole('group', { name: '2 photos' }), 'PO-C')

    fireEvent.click(uploadButton())

    // Sequential: while row 1 is in flight, rows 2 and 3 have not been sent.
    await waitFor(() => expect(uploadPurchaseOrderMock).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('group', { name: 'a.csv' }).getAttribute('data-status')).toBe('uploading')
    expect(uploadPurchaseOrderPhotosMock).not.toHaveBeenCalled()
    expect(uploadPurchaseOrderMock).toHaveBeenCalledTimes(1)

    releaseFirst({ id: 'doc-a', name: 'a.csv', status: 'pending' })

    await waitFor(() => expect(uploadPurchaseOrderPhotosMock).toHaveBeenCalledTimes(1))
    expect(uploadPurchaseOrderMock).toHaveBeenCalledTimes(2)
    expect((uploadPurchaseOrderMock.mock.calls[0][1] as File).name).toBe('a.csv')
    expect((uploadPurchaseOrderMock.mock.calls[1][1] as File).name).toBe('b.pdf')
    expect(uploadPurchaseOrderPhotosMock).toHaveBeenCalledWith('ws-1', [photoA, photoB], {
      vendorId: 'vendor-1',
      poNumber: 'PO-C',
      currency: 'USD',
    })
    await waitFor(() => {
      for (const group of rows()) expect(group.getAttribute('data-status')).toBe('done')
    })
    expect(onUploaded).toHaveBeenCalled()
  })

  it('happy: invoice rows go to uploadInvoice and uploadInvoicePhotos with the invoice header', async () => {
    renderDialog({ tab: 'invoices' })
    pick(filesInput(), [csv('inv.csv')])
    pick(photosInput(), [jpg('inv-1.jpg')])
    fillInvoice(screen.getByRole('group', { name: 'inv.csv' }), 'INV-1')
    fillInvoice(screen.getByRole('group', { name: 'inv-1.jpg' }), 'INV-2')

    fireEvent.click(uploadButton())

    await waitFor(() => expect(uploadInvoicePhotosMock).toHaveBeenCalledTimes(1))
    expect(uploadInvoiceMock).toHaveBeenCalledWith('ws-1', expect.any(File), {
      purchaseOrderId: 'po-1',
      invoiceNumber: 'INV-1',
      currency: 'USD',
    })
    expect(uploadInvoicePhotosMock).toHaveBeenCalledWith('ws-1', [expect.any(File)], {
      purchaseOrderId: 'po-1',
      invoiceNumber: 'INV-2',
      currency: 'USD',
    })
    expect(uploadPurchaseOrderMock).not.toHaveBeenCalled()
  })

  it('happy: goods-receipt rows go to uploadGoodsReceipt and uploadGoodsReceiptPhotos with no currency', async () => {
    renderDialog({ tab: 'goods-receipts' })
    pick(filesInput(), [csv('grn.csv')])
    pick(photosInput(), [jpg('grn-1.jpg')])
    fillGrn(screen.getByRole('group', { name: 'grn.csv' }), 'GRN-9001')
    fillGrn(screen.getByRole('group', { name: 'grn-1.jpg' }), 'GRN-9002')

    fireEvent.click(uploadButton())

    await waitFor(() => expect(uploadGoodsReceiptPhotosMock).toHaveBeenCalledTimes(1))
    expect(uploadGoodsReceiptMock).toHaveBeenCalledWith('ws-1', expect.any(File), {
      purchaseOrderId: 'po-1',
      grnNumber: 'GRN-9001',
    })
    expect(uploadGoodsReceiptPhotosMock).toHaveBeenCalledWith('ws-1', [expect.any(File)], {
      purchaseOrderId: 'po-1',
      grnNumber: 'GRN-9002',
    })
  })

  it('happy: the invoice and receipt PO picker labels each order with its number', () => {
    renderDialog({ tab: 'invoices' })
    pick(filesInput(), [csv('inv.csv')])

    const row = screen.getByRole('group', { name: 'inv.csv' })
    expect(within(row).getByRole('option', { name: 'PO-2026-1180 — po-march.csv' })).toBeDefined()
  })

  it('happy: Cancel/close calls onClose', () => {
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onClose).toHaveBeenCalled()
  })
})
