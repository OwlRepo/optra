import { describe, expect, it } from 'vitest'
import {
  MAX_BATCH_FILES,
  addFiles,
  classifyFile,
  copyFromFirstRow,
  rowErrors,
  splitPhotoRow,
  type BatchRow,
} from '@/components/procurement/batch-upload-rows'

function file(name: string, type = '') {
  return new File(['x'], name, { type })
}

function row(partial: Partial<BatchRow> & { id: string }): BatchRow {
  return { kind: 'file', files: [file('a.csv')], header: {}, status: 'ready', ...partial }
}

function totalFiles(rows: BatchRow[]) {
  return rows.reduce((sum, r) => sum + r.files.length, 0)
}

describe('classifyFile', () => {
  it.each([
    ['error: a PDF on the goods-receipt tab is refused', 'grn.pdf', 'goods-receipts', null],
    ['error: an unsupported extension is refused', 'notes.txt', 'purchase-orders', null],
    ['error: a file with no extension is refused', 'README', 'invoices', null],
    ['edge: the extension match is case-insensitive', 'PO.CSV', 'purchase-orders', 'csv'],
    ['edge: only the last extension counts', 'scan.pdf.jpg', 'invoices', 'photo'],
    ['edge: HEIC is classified as a photo so the server can refuse it with its message', 'IMG_1.heic', 'purchase-orders', 'photo'],
    ['edge: a goods-receipt photo is allowed', 'receipt.webp', 'goods-receipts', 'photo'],
    ['happy: csv', 'po.csv', 'purchase-orders', 'csv'],
    ['happy: xlsx', 'inv.xlsx', 'invoices', 'xlsx'],
    ['happy: pdf on a purchase order', 'po.pdf', 'purchase-orders', 'pdf'],
    ['happy: pdf on an invoice', 'inv.pdf', 'invoices', 'pdf'],
    ['happy: jpg', 'a.jpg', 'purchase-orders', 'photo'],
    ['happy: jpeg', 'a.jpeg', 'purchase-orders', 'photo'],
    ['happy: png', 'a.png', 'invoices', 'photo'],
  ] as const)('%s', (_title, name, tab, expected) => {
    expect(classifyFile(file(name), tab)).toBe(expected)
  })
})

describe('addFiles', () => {
  it('error: a 6th file is refused with a message naming the 5-file limit and the rows stay as they were', () => {
    const start = addFiles([], ['1.csv', '2.csv', '3.csv', '4.csv', '5.csv'].map((n) => file(n)), 'purchase-orders').rows
    expect(totalFiles(start)).toBe(5)

    const result = addFiles(start, [file('6.csv')], 'purchase-orders')

    expect(result.error).toMatch(/5 files/)
    expect(result.rows).toEqual(start)
  })

  it('error: a batch that would cross 5 is refused whole, not truncated', () => {
    const start = addFiles([], [file('1.csv'), file('2.csv'), file('3.csv')], 'invoices').rows

    const result = addFiles(start, [file('4.csv'), file('5.csv'), file('6.csv')], 'invoices')

    expect(result.error).toMatch(/5 files/)
    expect(totalFiles(result.rows)).toBe(3)
  })

  it('error: a PDF on the goods-receipt tab is refused, names the file, and adds no row', () => {
    const result = addFiles([], [file('grn.pdf')], 'goods-receipts')

    expect(result.error).toMatch(/grn\.pdf/)
    expect(result.rows).toHaveLength(0)
  })

  it('error: an unsupported file is refused with its name; supported files picked with it are not added either', () => {
    const result = addFiles([], [file('po.csv'), file('notes.txt')], 'purchase-orders')

    expect(result.error).toMatch(/notes\.txt/)
    expect(result.rows).toHaveLength(0)
  })

  it('edge: exactly 5 files is accepted without an error', () => {
    const result = addFiles([], ['1.csv', '2.xlsx', '3.pdf', '4.csv', '5.csv'].map((n) => file(n)), 'purchase-orders')

    expect(result.error).toBeUndefined()
    expect(totalFiles(result.rows)).toBe(5)
  })

  it('edge: 5 photos picked together are one photo row and still count as 5 files', () => {
    const photos = [1, 2, 3, 4, 5].map((n) => file(`p${n}.jpg`, 'image/jpeg'))

    const result = addFiles([], photos, 'invoices')

    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].kind).toBe('photos')
    expect(result.rows[0].files).toHaveLength(5)
  })

  it('edge: photos picked together with a CSV give one file row and one photo row', () => {
    const result = addFiles(
      [],
      [file('po.csv'), file('p1.jpg', 'image/jpeg'), file('p2.png', 'image/png')],
      'purchase-orders',
    )

    expect(result.rows.map((r) => r.kind)).toEqual(['file', 'photos'])
    expect(result.rows[1].files.map((f) => f.name)).toEqual(['p1.jpg', 'p2.png'])
  })

  it('edge: photos added in a second pick are a second row, never merged into the first', () => {
    const first = addFiles([], [file('a.jpg'), file('b.jpg')], 'purchase-orders').rows

    const second = addFiles(first, [file('c.jpg')], 'purchase-orders').rows

    expect(second).toHaveLength(2)
    expect(second[0].files).toHaveLength(2)
    expect(second[1].files).toHaveLength(1)
  })

  it('edge: picking nothing changes nothing and raises no error', () => {
    const start = addFiles([], [file('a.csv')], 'purchase-orders').rows

    const result = addFiles(start, [], 'purchase-orders')

    expect(result.error).toBeUndefined()
    expect(result.rows).toEqual(start)
  })

  it('edge: every new row gets a distinct id and starts ready with no error', () => {
    const rows = addFiles([], [file('a.csv'), file('b.csv'), file('c.jpg')], 'purchase-orders').rows

    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
    for (const r of rows) {
      expect(r.status).toBe('ready')
      expect(r.error).toBeUndefined()
    }
  })

  it('edge: existing rows are kept in order and not mutated', () => {
    const start = addFiles([], [file('a.csv')], 'purchase-orders').rows
    const snapshot = structuredClone(start.map((r) => ({ ...r, files: r.files.length })))

    const rows = addFiles(start, [file('b.csv')], 'purchase-orders').rows

    expect(rows[0]).toBe(start[0])
    expect(rows).toHaveLength(2)
    expect(start.map((r) => ({ ...r, files: r.files.length }))).toEqual(snapshot)
  })

  it('regression: a PO or invoice row defaults the currency to USD, as the old single-file modals did', () => {
    expect(addFiles([], [file('a.csv')], 'purchase-orders').rows[0].header.currency).toBe('USD')
    expect(addFiles([], [file('a.csv')], 'invoices').rows[0].header.currency).toBe('USD')
  })

  it('regression: a goods-receipt row has no currency (a receipt records what arrived, not what it cost)', () => {
    expect(addFiles([], [file('a.csv')], 'goods-receipts').rows[0].header.currency).toBeUndefined()
  })
})

describe('splitPhotoRow', () => {
  it('error: an unknown row id changes nothing', () => {
    const rows = [row({ id: 'r1', kind: 'photos', files: [file('a.jpg'), file('b.jpg')] })]

    expect(splitPhotoRow(rows, 'nope')).toEqual(rows)
  })

  it('edge: a file row is never split', () => {
    const rows = [row({ id: 'r1' })]

    expect(splitPhotoRow(rows, 'r1')).toEqual(rows)
  })

  it('edge: a photo row with one photo is already one document', () => {
    const rows = [row({ id: 'r1', kind: 'photos', files: [file('a.jpg')] })]

    expect(splitPhotoRow(rows, 'r1')).toEqual(rows)
  })

  it('edge: a 3-photo row becomes 3 one-photo rows in place, other rows untouched, total files unchanged', () => {
    const csv = row({ id: 'csv' })
    const photos = row({ id: 'ph', kind: 'photos', files: [file('a.jpg'), file('b.jpg'), file('c.jpg')] })
    const tail = row({ id: 'tail', files: [file('z.xlsx')] })

    const result = splitPhotoRow([csv, photos, tail], 'ph')

    expect(result).toHaveLength(5)
    expect(result[0]).toBe(csv)
    expect(result[4]).toBe(tail)
    expect(result.slice(1, 4).map((r) => r.files.map((f) => f.name))).toEqual([['a.jpg'], ['b.jpg'], ['c.jpg']])
    expect(result.slice(1, 4).every((r) => r.kind === 'photos' && r.status === 'ready')).toBe(true)
    expect(new Set(result.map((r) => r.id)).size).toBe(5)
    expect(totalFiles(result)).toBe(5)
  })

  it('edge: split rows keep the shared header fields but never the document number', () => {
    const photos = row({
      id: 'ph',
      kind: 'photos',
      files: [file('a.jpg'), file('b.jpg')],
      header: { vendorId: 'v1', currency: 'EUR', poNumber: 'PO-1' },
    })

    const result = splitPhotoRow([photos], 'ph')

    for (const r of result) {
      expect(r.header.vendorId).toBe('v1')
      expect(r.header.currency).toBe('EUR')
      expect(r.header.poNumber ?? '').toBe('')
    }
  })
})

describe('copyFromFirstRow', () => {
  it('edge: a single row is returned unchanged', () => {
    const rows = [row({ id: 'r1', header: { vendorId: 'v1', poNumber: 'PO-1' } })]

    expect(copyFromFirstRow(rows)).toEqual(rows)
  })

  it('edge: no rows is fine', () => {
    expect(copyFromFirstRow([])).toEqual([])
  })

  it('edge: copies vendor, currency, PO link and order date to the other rows', () => {
    const rows = [
      row({ id: 'r1', header: { vendorId: 'v1', currency: 'EUR', purchaseOrderId: 'po-9', orderedAt: '2026-01-02' } }),
      row({ id: 'r2', header: { vendorId: 'v9', currency: 'USD' } }),
      row({ id: 'r3', header: {} }),
    ]

    const result = copyFromFirstRow(rows)

    for (const r of result.slice(1)) {
      expect(r.header).toMatchObject({ vendorId: 'v1', currency: 'EUR', purchaseOrderId: 'po-9', orderedAt: '2026-01-02' })
    }
    expect(result[0]).toEqual(rows[0])
  })

  it.each([
    ['poNumber', 'PO-1'],
    ['invoiceNumber', 'INV-1'],
    ['grnNumber', 'GRN-1'],
  ] as const)('edge: never copies the document number (%s) and leaves a number a row already has', (field, value) => {
    const rows = [
      row({ id: 'r1', header: { vendorId: 'v1', [field]: value } }),
      row({ id: 'r2', header: { [field]: 'OWN-2' } }),
      row({ id: 'r3', header: {} }),
    ]

    const result = copyFromFirstRow(rows)

    expect(result[1].header[field]).toBe('OWN-2')
    expect(result[2].header[field] ?? '').toBe('')
    expect(result[2].header.vendorId).toBe('v1')
  })

  it('edge: a field the first row left blank does not wipe what another row already has', () => {
    const rows = [
      row({ id: 'r1', header: { vendorId: 'v1', currency: '' } }),
      row({ id: 'r2', header: { currency: 'GBP' } }),
    ]

    expect(copyFromFirstRow(rows)[1].header.currency).toBe('GBP')
  })
})

describe('rowErrors', () => {
  it('error: a purchase-order row with nothing filled needs a vendor and a PO number', () => {
    const errors = rowErrors(row({ id: 'r1', header: { currency: 'USD' } }), 'purchase-orders')

    expect(Object.keys(errors).sort()).toEqual(['poNumber', 'vendorId'])
  })

  it('error: an invoice row needs the purchase order and the invoice number', () => {
    const errors = rowErrors(row({ id: 'r1', header: { currency: 'USD' } }), 'invoices')

    expect(Object.keys(errors).sort()).toEqual(['invoiceNumber', 'purchaseOrderId'])
  })

  it('error: a goods-receipt row needs the purchase order and the receipt number, not a currency', () => {
    const errors = rowErrors(row({ id: 'r1', header: {} }), 'goods-receipts')

    expect(Object.keys(errors).sort()).toEqual(['grnNumber', 'purchaseOrderId'])
  })

  it('error: a whitespace-only document number counts as missing', () => {
    const errors = rowErrors(row({ id: 'r1', header: { vendorId: 'v1', poNumber: '   ', currency: 'USD' } }), 'purchase-orders')

    expect(Object.keys(errors)).toEqual(['poNumber'])
  })

  it('error: a blank currency on a PO or invoice is missing', () => {
    expect(
      Object.keys(rowErrors(row({ id: 'r1', header: { vendorId: 'v1', poNumber: 'PO-1', currency: ' ' } }), 'purchase-orders')),
    ).toEqual(['currency'])
    expect(
      Object.keys(rowErrors(row({ id: 'r1', header: { purchaseOrderId: 'po-1', invoiceNumber: 'I-1', currency: '' } }), 'invoices')),
    ).toEqual(['currency'])
  })

  it('edge: the same rules apply to a photo row', () => {
    const errors = rowErrors(row({ id: 'r1', kind: 'photos', files: [file('a.jpg')], header: { currency: 'USD' } }), 'purchase-orders')

    expect(Object.keys(errors).sort()).toEqual(['poNumber', 'vendorId'])
  })

  it('edge: the optional order date is never required', () => {
    const errors = rowErrors(row({ id: 'r1', header: { vendorId: 'v1', poNumber: 'PO-1', currency: 'USD' } }), 'purchase-orders')

    expect(errors).toEqual({})
  })
})

describe('MAX_BATCH_FILES (happy paths)', () => {
  it('happy: a batch holds at most 5 files', () => {
    expect(MAX_BATCH_FILES).toBe(5)
  })
})

describe('addFiles (happy paths)', () => {
  it('happy: a PDF is a file row on the PO tab', () => {
    const result = addFiles([], [file('po.pdf')], 'purchase-orders')

    expect(result.error).toBeUndefined()
    expect(result.rows[0]).toMatchObject({ kind: 'file', status: 'ready' })
    expect(result.rows[0].files.map((f) => f.name)).toEqual(['po.pdf'])
  })
})

describe('copyFromFirstRow (happy paths)', () => {
  it('happy: does not mutate the input rows', () => {
    const rows = [row({ id: 'r1', header: { vendorId: 'v1' } }), row({ id: 'r2', header: {} })]

    copyFromFirstRow(rows)

    expect(rows[1].header).toEqual({})
  })
})

describe('rowErrors (happy paths)', () => {
  it('happy: a complete row has no errors on any tab', () => {
    expect(rowErrors(row({ id: 'r', header: { vendorId: 'v1', poNumber: 'PO-1', currency: 'USD' } }), 'purchase-orders')).toEqual({})
    expect(rowErrors(row({ id: 'r', header: { purchaseOrderId: 'po-1', invoiceNumber: 'I-1', currency: 'USD' } }), 'invoices')).toEqual({})
    expect(rowErrors(row({ id: 'r', header: { purchaseOrderId: 'po-1', grnNumber: 'G-1' } }), 'goods-receipts')).toEqual({})
  })
})
