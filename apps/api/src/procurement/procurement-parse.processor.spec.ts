import { randomUUID } from 'crypto'
import { HttpException } from '@nestjs/common'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq, like } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import {
  db,
  goodsReceiptLineItems,
  goodsReceipts,
  invoiceLineItems,
  invoices,
  pool,
  poLineItems,
  purchaseOrders,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { EXTRACTOR_VERSION } from '@repo/ai'
import { ProcurementParseProcessor } from './procurement-parse.processor'
import { ProcurementExtractionService } from './procurement-extraction.service'
import { ProcurementParseService } from './procurement-parse.service'
import { ProcurementCompareService } from './procurement-compare.service'
import { StorageService } from '../storage/storage.service'
import { StorageObjectNotFoundError } from '../storage/storage.errors'

// Bull job shape the processor reads: attemptsMade counts prior failed attempts,
// opts.attempts is the configured total. Missing opts means a single attempt.
function job(
  id: string,
  data: { kind: 'purchase_order' | 'invoice' | 'goods_receipt'; id: string },
  attemptsMade = 0,
  attempts = 3,
) {
  return { id, data, attemptsMade, opts: { attempts } } as any
}

const mockEmbedQuery = jest.fn()

jest.mock('@repo/ai', () => ({
  EXTRACTOR_VERSION: 'procurement-extraction@1',
  IMAGE_EXTRACTOR_VERSION: 'procurement-image-extraction@1',
  embedQuery: (...args: unknown[]) => mockEmbedQuery(...args),
  ProcurementExtractionUnsupportedError: class ProcurementExtractionUnsupportedError extends Error {
    constructor(message = 'PDF has no extractable text — scanned or image-only PDFs are not supported yet') {
      super(message)
      this.name = 'ProcurementExtractionUnsupportedError'
    }
  },
  ProcurementExtractionEmptyError: class ProcurementExtractionEmptyError extends Error {
    constructor(message = 'No line items were found in this document') {
      super(message)
      this.name = 'ProcurementExtractionEmptyError'
    }
  },
  ProcurementExtractionRefusalError: class ProcurementExtractionRefusalError extends Error {
    constructor(message = 'Model refused procurement extraction request') {
      super(message)
      this.name = 'ProcurementExtractionRefusalError'
    }
  },
}))

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(poLineItems).where(eq(poLineItems.workspaceId, membership.workspaceId))
      await db.delete(invoiceLineItems).where(eq(invoiceLineItems.workspaceId, membership.workspaceId))
      await db.delete(goodsReceiptLineItems).where(eq(goodsReceiptLineItems.workspaceId, membership.workspaceId))
      await db.delete(goodsReceipts).where(eq(goodsReceipts.workspaceId, membership.workspaceId))
      await db.delete(invoices).where(eq(invoices.workspaceId, membership.workspaceId))
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

describe('ProcurementParseProcessor', () => {
  const prefix = `procurement-parse-proc-spec-${Date.now()}-`
  let dir: string
  let storage: { getToTempFile: jest.Mock; save: jest.Mock; getBuffer: jest.Mock }
  let extraction: { extract: jest.Mock; extractFromImages: jest.Mock }
  let parseService: { reconcile: jest.Mock }
  let compareService: { enqueueForDocument: jest.Mock }
  let processor: ProcurementParseProcessor
  const originalPdfFlag = process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = 'true'
    dir = mkdtempSync(join(tmpdir(), 'procurement-parse-proc-spec-'))
    storage = {
      getToTempFile: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('jpeg page bytes')),
    }
    extraction = { extract: jest.fn(), extractFromImages: jest.fn() }
    parseService = { reconcile: jest.fn().mockResolvedValue(undefined) }
    compareService = { enqueueForDocument: jest.fn().mockResolvedValue(undefined) }
    processor = new ProcurementParseProcessor(
      storage as unknown as StorageService,
      extraction as unknown as ProcurementExtractionService,
      parseService as unknown as ProcurementParseService,
      compareService as unknown as ProcurementCompareService,
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (originalPdfFlag === undefined) delete process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED
    else process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = originalPdfFlag
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedWorkspace(email: string, name: string) {
    const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
    const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    return workspace
  }

  async function seedPo(csvContent: string, workspaceId: string, name = 'po.csv') {
    const csvPath = join(dir, `${randomUUID()}.csv`)
    writeFileSync(csvPath, csvContent)
    storage.getToTempFile.mockResolvedValue(csvPath)

    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId, name, storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    return po
  }

  // Same as seedPo but for bytes that are not CSV text (xlsx, pdf).
  async function seedPoBuffer(buffer: Buffer, workspaceId: string, name: string) {
    const filePath = join(dir, `${randomUUID()}-${name}`)
    writeFileSync(filePath, buffer)
    storage.getToTempFile.mockResolvedValue(filePath)

    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId, name, storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    return po
  }

  async function seedGoodsReceipt(csvContent: string, workspaceId: string, name = 'grn.csv') {
    const csvPath = join(dir, `${randomUUID()}.csv`)
    writeFileSync(csvPath, csvContent)
    storage.getToTempFile.mockResolvedValue(csvPath)

    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId, name: 'linked-po.csv', status: 'done' })
      .returning()
    const [grn] = await db
      .insert(goodsReceipts)
      .values({
        workspaceId,
        purchaseOrderId: po.id,
        name,
        storageKey: `k/${randomUUID()}`,
        status: 'pending',
      })
      .returning()

    return grn
  }

  describe('goods receipts (S5)', () => {
    it('writes receipt lines to goods_receipt_line_items and not to invoice_line_items', async () => {
      const workspace = await seedWorkspace(`${prefix}grn@example.com`, prefix)
      const grn = await seedGoodsReceipt(
        ['sku,description,qty received,qty accepted,qty rejected,uom', 'A1,Widget,10,8,2,box'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-grn', { kind: 'goods_receipt', id: grn.id }))

      const lines = await db
        .select()
        .from(goodsReceiptLineItems)
        .where(eq(goodsReceiptLineItems.goodsReceiptId, grn.id))
      expect(lines).toHaveLength(1)
      expect(lines[0].sku).toBe('A1')
      expect(lines[0].quantityReceived).toBe('10')
      expect(lines[0].quantityAccepted).toBe('8')
      expect(lines[0].quantityRejected).toBe('2')
      expect(lines[0].uom).toBe('box')

      // The failure the exhaustiveness refactor exists to prevent.
      const strays = await db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.workspaceId, workspace.id))
      expect(strays).toHaveLength(0)

      const [header] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, grn.id))
      expect(header.status).toBe('done')
      expect(header.rowCount).toBe(1)
    })

    // §1B and POLICY v1 #14: missing receiving data is never zero. If these
    // land as '0', S6 reports rejections that never happened.
    it('stores NULL, not zero, for quantities the source does not state', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-null@example.com`, prefix)
      const grn = await seedGoodsReceipt(['sku,qty received', 'A1,8'].join('\n'), workspace.id)

      await processor.handleParse(job('job-grn-null', { kind: 'goods_receipt', id: grn.id }))

      const [line] = await db
        .select()
        .from(goodsReceiptLineItems)
        .where(eq(goodsReceiptLineItems.goodsReceiptId, grn.id))
      expect(line.quantityReceived).toBe('8')
      expect(line.quantityAccepted).toBeNull()
      expect(line.quantityRejected).toBeNull()
    })

    // A receipt whose only quantity column is a plain "Qty" still means received.
    it('reads a plain Qty column as the received quantity', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-plain@example.com`, prefix)
      const grn = await seedGoodsReceipt(['sku,qty', 'A1,5'].join('\n'), workspace.id)

      await processor.handleParse(job('job-grn-plain', { kind: 'goods_receipt', id: grn.id }))

      const [line] = await db
        .select()
        .from(goodsReceiptLineItems)
        .where(eq(goodsReceiptLineItems.goodsReceiptId, grn.id))
      expect(line.quantityReceived).toBe('5')
    })

    it('records the row position so a reviewer can find the line in the file', async () => {
      const workspace = await seedWorkspace(`${prefix}grn-prov@example.com`, prefix)
      const grn = await seedGoodsReceipt(
        ['sku,qty received', '', 'A1,8'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-grn-prov', { kind: 'goods_receipt', id: grn.id }))

      const [line] = await db
        .select()
        .from(goodsReceiptLineItems)
        .where(eq(goodsReceiptLineItems.goodsReceiptId, grn.id))
      // Header is file line 1, the blank line is 2, so this row is 3 — S3a made
      // source_row the real position in the file, blanks included.
      expect(line.sourceRow).toBe(3)
      expect(line.sourceKind).toBe('csv')
    })
  })

  it('parses PO line items, infers mapped fields, and marks done', async () => {
    const workspace = await seedWorkspace(`${prefix}po@example.com`, prefix)
    const po = await seedPo(
      ['sku,description,qty,unit price', 'A1,Widget,10,5.00', 'B2,Gadget,3,9.99'].join('\n'),
      workspace.id,
    )

    await processor.handleParse({ id: 'job-1', data: { kind: 'purchase_order', id: po.id } } as any)

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(2)

    const items = await db
      .select()
      .from(poLineItems)
      .where(eq(poLineItems.purchaseOrderId, po.id))
      .orderBy(poLineItems.lineNumber)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      sku: 'A1',
      description: 'Widget',
      quantity: '10',
      unitPrice: '5.00',
      workspaceId: workspace.id,
      sourceKind: 'csv',
    })
    expect(items[0].rawRow).toEqual({ sku: 'A1', description: 'Widget', qty: '10', 'unit price': '5.00' })

    expect(mockEmbedQuery).not.toHaveBeenCalled()
    expect(extraction.extract).not.toHaveBeenCalled()
  })

  describe('provenance (S3a)', () => {
    it('records the true source row even when blank rows precede a line', async () => {
      const workspace = await seedWorkspace(`${prefix}prov-row@example.com`, prefix)
      // Row 1 is the header, row 2 blank, so A1 is row 3 and B2 is row 5.
      const po = await seedPo(
        ['sku,description,qty,unit price', '', 'A1,Widget,10,5.00', '', 'B2,Gadget,3,9.99'].join('\n'),
        workspace.id,
      )

      await processor.handleParse({ id: 'job-prov-row', data: { kind: 'purchase_order', id: po.id } } as any)

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)

      expect(items).toHaveLength(2)
      // lineNumber counts kept lines; sourceRow points into the actual file.
      expect(items[0]).toMatchObject({ sku: 'A1', lineNumber: 1, sourceRow: 3 })
      expect(items[1]).toMatchObject({ sku: 'B2', lineNumber: 2, sourceRow: 5 })
      expect(items[0].sourceSheet).toBeNull()
      expect(items[0].extractionConfidence).toBeNull()
      expect(items[0].extractorVersion).toBeNull()
    })

    it('captures a unit of measure from the source file', async () => {
      const workspace = await seedWorkspace(`${prefix}prov-uom@example.com`, prefix)
      const po = await seedPo(
        ['sku,description,qty,uom,unit price', 'A1,Widget,10,box,5.00'].join('\n'),
        workspace.id,
      )

      await processor.handleParse({ id: 'job-prov-uom', data: { kind: 'purchase_order', id: po.id } } as any)

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item.uom).toBe('box')
    })

    it('records the sheet name an XLSX row came from', async () => {
      const workspace = await seedWorkspace(`${prefix}prov-sheet@example.com`, prefix)
      const sheet = XLSX.utils.json_to_sheet([{ sku: 'A1', description: 'Widget', qty: '10', 'unit price': '5.00' }])
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Order Lines')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse({ id: 'job-prov-sheet', data: { kind: 'purchase_order', id: po.id } } as any)

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item.sourceSheet).toBe('Order Lines')
      expect(item.sourceRow).toBe(2)
    })

    it('promotes the model confidence and stamps the extractor version on a PDF', async () => {
      const workspace = await seedWorkspace(`${prefix}prov-pdf@example.com`, prefix)
      const po = await seedPoBuffer(Buffer.from('%PDF-1.4 marker'), workspace.id, 'po.pdf')
      extraction.extract.mockResolvedValue({
        items: [
          { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', confidence: 0.92 },
          { sku: 'B2', description: 'Gadget', quantity: '1', unitPrice: '2.00', lineTotal: '2.00', confidence: null },
        ],
      })

      await processor.handleParse({ id: 'job-prov-pdf', data: { kind: 'purchase_order', id: po.id } } as any)

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)

      expect(items[0].extractionConfidence).toBe('0.92')
      expect(items[0].extractorVersion).toBe(EXTRACTOR_VERSION)
      expect(items[1].extractionConfidence).toBeNull()
      // A PDF has no spreadsheet coordinates.
      expect(items[0].sourceRow).toBeNull()
      expect(items[0].sourceSheet).toBeNull()
    })
  })

  it('parses invoice line items into invoice_line_items', async () => {
    const workspace = await seedWorkspace(`${prefix}inv@example.com`, prefix)
    const csvPath = join(dir, `${randomUUID()}.csv`)
    writeFileSync(csvPath, ['sku,qty,unit price', 'A1,10,5.00'].join('\n'))
    storage.getToTempFile.mockResolvedValue(csvPath)
    const [invoice] = await db
      .insert(invoices)
      .values({ workspaceId: workspace.id, name: 'invoice.csv', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-2', data: { kind: 'invoice', id: invoice.id } } as any)

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice.id))
    expect(updated.status).toBe('done')

    const items = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id))
    expect(items).toHaveLength(1)
    expect(items[0].sku).toBe('A1')
  })

  it('parses an XLSX PO in memory and never overwrites the stored original', async () => {
    const workspace = await seedWorkspace(`${prefix}po-xlsx@example.com`, prefix)
    const worksheet = XLSX.utils.json_to_sheet([{ sku: 'A1', qty: 5 }])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const xlsxPath = join(dir, `${randomUUID()}.xlsx`)
    writeFileSync(xlsxPath, buffer)
    storage.getToTempFile.mockResolvedValue(xlsxPath)

    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.xlsx', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-xlsx', data: { kind: 'purchase_order', id: po.id } } as any)

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('done')
    expect(storage.save).not.toHaveBeenCalled()

    const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
    expect(items).toHaveLength(1)
    expect(items[0].sku).toBe('A1')
    expect(items[0].sourceKind).toBe('xlsx')
  })

  it('fails cleanly when the purchase order row has no storageKey', async () => {
    const workspace = await seedWorkspace(`${prefix}po-nokey@example.com`, prefix)
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-3', data: { kind: 'purchase_order', id: po.id } } as any)

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('storageKey')
  })

  it('re-running parse for the same PO replaces line items rather than duplicating them', async () => {
    const workspace = await seedWorkspace(`${prefix}po-rerun@example.com`, prefix)
    const po = await seedPo(['sku,qty', 'A1,10'].join('\n'), workspace.id)

    await processor.handleParse({ id: 'job-4a', data: { kind: 'purchase_order', id: po.id } } as any)

    const csvPath2 = join(dir, `${randomUUID()}.csv`)
    writeFileSync(csvPath2, ['sku,qty', 'A1,10'].join('\n'))
    storage.getToTempFile.mockResolvedValue(csvPath2)
    await processor.handleParse({ id: 'job-4b', data: { kind: 'purchase_order', id: po.id } } as any)

    const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
    expect(items).toHaveLength(1)
  })

  it('parses a PDF PO via the extraction service and marks done with sourceKind pdf-extraction', async () => {
    const workspace = await seedWorkspace(`${prefix}po-pdf@example.com`, prefix)
    const pdfPath = join(dir, `${randomUUID()}.pdf`)
    writeFileSync(pdfPath, 'fake pdf bytes')
    storage.getToTempFile.mockResolvedValue(pdfPath)
    extraction.extract.mockResolvedValue({
      items: [
        { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', confidence: 0.92 },
        { sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '9.99', lineTotal: null, confidence: null },
      ],
    })

    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.pdf', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-pdf', data: { kind: 'purchase_order', id: po.id } } as any)

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(2)

    expect(extraction.extract).toHaveBeenCalledWith(pdfPath, workspace.id)
    // XLSX->CSV conversion is the only thing that ever calls storage.save — a
    // PDF taking that branch would be a real bug (Papa.parse on PDF bytes).
    expect(storage.save).not.toHaveBeenCalled()

    const items = await db
      .select()
      .from(poLineItems)
      .where(eq(poLineItems.purchaseOrderId, po.id))
      .orderBy(poLineItems.lineNumber)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      sku: 'A1',
      description: 'Widget',
      quantity: '10',
      unitPrice: '5.00',
      sourceKind: 'pdf-extraction',
    })
    expect(items[0].rawRow).toMatchObject({ sku: 'A1', confidence: 0.92 })
  })

  it('marks the PDF PO failed with a clear lastError when the document has no extractable text', async () => {
    const { ProcurementExtractionUnsupportedError } = jest.requireMock('@repo/ai') as {
      ProcurementExtractionUnsupportedError: new (message?: string) => Error
    }
    const workspace = await seedWorkspace(`${prefix}po-pdf-scan@example.com`, prefix)
    const pdfPath = join(dir, `${randomUUID()}.pdf`)
    writeFileSync(pdfPath, 'fake scanned pdf bytes')
    storage.getToTempFile.mockResolvedValue(pdfPath)
    extraction.extract.mockRejectedValue(new ProcurementExtractionUnsupportedError())

    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'scan.pdf', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await processor.handleParse({ id: 'job-pdf-scan', data: { kind: 'purchase_order', id: po.id } } as any)

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('not supported yet')

    const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
    expect(items).toHaveLength(0)
  })

  it('rethrows a transient failure before the last attempt and leaves the row processing', async () => {
    const workspace = await seedWorkspace(`${prefix}po-transient@example.com`, prefix)
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()
    storage.getToTempFile.mockRejectedValue(new Error('socket hang up'))

    await expect(processor.handleParse(job('job-t1', { kind: 'purchase_order', id: po.id }, 0, 3))).rejects.toThrow(
      'socket hang up',
    )

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('processing')
    expect(row.lastError).toBeNull()
  })

  it('marks the row failed with a client-safe reference on the last transient attempt, and still rethrows', async () => {
    const workspace = await seedWorkspace(`${prefix}po-transient-last@example.com`, prefix)
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()
    storage.getToTempFile.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.9:8333 SECRET-DETAIL'))

    await expect(processor.handleParse(job('job-t3', { kind: 'purchase_order', id: po.id }, 2, 3))).rejects.toThrow()

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toMatch(/^Parsing failed\. Reference: [0-9a-f]{8}$/)
  })

  // A file that is not in storage will not be there on a retry either. Fail
  // once, with a reason the page can show - not three retries and a reference
  // number that explains nothing.
  it('fails a document whose stored file is gone at once, with a client-safe reason, without retrying', async () => {
    const workspace = await seedWorkspace(`${prefix}po-gone@example.com`, prefix)
    const key = `k/${randomUUID()}`
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.csv', storageKey: key, status: 'pending' })
      .returning()
    storage.getToTempFile.mockRejectedValue(new StorageObjectNotFoundError(key))

    await expect(
      processor.handleParse(job('job-gone', { kind: 'purchase_order', id: po.id }, 0, 3)),
    ).resolves.toBeUndefined()

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe('The stored file is missing. Upload it again.')
  })

  it('fails a document problem immediately without asking Bull to retry', async () => {
    const { ProcurementExtractionRefusalError } = jest.requireMock('@repo/ai') as {
      ProcurementExtractionRefusalError: new (message?: string) => Error
    }
    const workspace = await seedWorkspace(`${prefix}po-permanent@example.com`, prefix)
    const pdfPath = join(dir, `${randomUUID()}.pdf`)
    writeFileSync(pdfPath, 'fake pdf bytes')
    storage.getToTempFile.mockResolvedValue(pdfPath)
    extraction.extract.mockRejectedValue(new ProcurementExtractionRefusalError())
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.pdf', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await expect(
      processor.handleParse(job('job-p1', { kind: 'purchase_order', id: po.id }, 0, 3)),
    ).resolves.toBeUndefined()

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe('Model refused procurement extraction request')
  })

  it('stores an unparseable number as null, keeps the original in rawRow, and still finishes the document', async () => {
    const workspace = await seedWorkspace(`${prefix}po-bad-number@example.com`, prefix)
    const po = await seedPo(['sku,qty,unit price', 'A1,ten,5.00', 'B2,3,"1,200"'].join('\n'), workspace.id)

    await processor.handleParse(job('job-n1', { kind: 'purchase_order', id: po.id }))

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('done')
    const items = await db
      .select()
      .from(poLineItems)
      .where(eq(poLineItems.purchaseOrderId, po.id))
      .orderBy(poLineItems.lineNumber)
    expect(items).toHaveLength(2)
    expect(items[0].quantity).toBeNull()
    expect(items[0].rawRow).toMatchObject({ qty: 'ten' })
    expect(items[1].unitPrice).toBeNull()
    expect(items[1].rawRow).toMatchObject({ 'unit price': '1,200' })
  })

  it('stores an over-long SKU as null and keeps the original in rawRow', async () => {
    const workspace = await seedWorkspace(`${prefix}po-long-sku@example.com`, prefix)
    const longSku = 'S'.repeat(250)
    const po = await seedPo(['sku,qty', `${longSku},1`].join('\n'), workspace.id)

    await processor.handleParse(job('job-l1', { kind: 'purchase_order', id: po.id }))

    const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
    expect(items).toHaveLength(1)
    expect(items[0].sku).toBeNull()
    expect(items[0].rawRow).toMatchObject({ sku: longSku })
  })

  it('parses a 7,000-row CSV (inserts are chunked under the bind-parameter limit)', async () => {
    const workspace = await seedWorkspace(`${prefix}po-big@example.com`, prefix)
    const lines = ['sku,description,qty,unit price,total']
    for (let i = 0; i < 7000; i++) lines.push(`BIG-${i},Item ${i},1,2.00,2.00`)
    const po = await seedPo(lines.join('\n'), workspace.id)

    await processor.handleParse(job('job-big', { kind: 'purchase_order', id: po.id }))

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(7000)
    // A volume test, not a unit test: 7,000 rows is what crosses the bind-
    // parameter limit, so it cannot shrink. 1.5 s alone, ~3 s under a full
    // local run, over the 5 s default on the CI runner. Its own budget only.
  }, 30_000)

  it('skips rows whose mapped fields are all empty', async () => {
    const workspace = await seedWorkspace(`${prefix}po-empty-row@example.com`, prefix)
    const po = await seedPo(['sku,qty,unit price', 'A1,1,1.00', ',,', 'B2,2,2.00'].join('\n'), workspace.id)

    await processor.handleParse(job('job-e1', { kind: 'purchase_order', id: po.id }))

    const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
    expect(items.map((item) => item.sku).sort()).toEqual(['A1', 'B2'])
  })

  it('fails a CSV with broken quoting as malformed instead of guessing at its rows', async () => {
    const workspace = await seedWorkspace(`${prefix}po-malformed@example.com`, prefix)
    const po = await seedPo(['sku,qty', '"A1,1', 'B2,2'].join('\n'), workspace.id)

    await expect(processor.handleParse(job('job-m1', { kind: 'purchase_order', id: po.id }))).resolves.toBeUndefined()

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('malformed')
  })

  it('does not extract a queued PDF once PDF extraction has been turned off', async () => {
    process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = 'false'
    const workspace = await seedWorkspace(`${prefix}po-pdf-off@example.com`, prefix)
    const pdfPath = join(dir, `${randomUUID()}.pdf`)
    writeFileSync(pdfPath, 'fake pdf bytes')
    storage.getToTempFile.mockResolvedValue(pdfPath)
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.pdf', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await processor.handleParse(job('job-off', { kind: 'purchase_order', id: po.id }))

    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('not enabled')
    expect(extraction.extract).not.toHaveBeenCalled()
  })

  describe('auto-compare hand-off (S8)', () => {
    it('hands a finished document to auto-compare, by kind and id', async () => {
      const workspace = await seedWorkspace(`${prefix}autocompare@example.com`, prefix)
      const po = await seedPo(['sku,qty,unit price', 'A1,10,5.00'].join('\n'), workspace.id)

      await processor.handleParse(job('job-auto', { kind: 'purchase_order', id: po.id }))

      expect(compareService.enqueueForDocument).toHaveBeenCalledWith('purchase_order', po.id)
    })

    it('does not hand off a document whose parse failed', async () => {
      const workspace = await seedWorkspace(`${prefix}autocompare-fail@example.com`, prefix)
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: workspace.id, name: 'po.csv', status: 'processing', storageKey: null })
        .returning()

      await processor.handleParse(job('job-auto-fail', { kind: 'purchase_order', id: po.id }))

      expect(compareService.enqueueForDocument).not.toHaveBeenCalled()
    })

    // The parse succeeded. A queue that will not accept the follow-up work is
    // not that document's problem, and reporting it as a parse failure would
    // make a correctly parsed file look unreadable to its owner.
    it('leaves the document done when the hand-off throws', async () => {
      const workspace = await seedWorkspace(`${prefix}autocompare-throw@example.com`, prefix)
      const po = await seedPo(['sku,qty,unit price', 'A1,10,5.00'].join('\n'), workspace.id)
      compareService.enqueueForDocument.mockRejectedValue(new Error('redis is down'))

      await expect(processor.handleParse(job('job-auto-throw', { kind: 'purchase_order', id: po.id }))).resolves
        .toBeUndefined()

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.lastError).toBeNull()
    })
  })

  it('runs queue reconciliation when the repeatable reconcile job fires', async () => {
    await processor.handleReconcile()

    expect(parseService.reconcile).toHaveBeenCalledTimes(1)
  })

  it('fails with the budget message and no retry when the workspace token budget is exhausted', async () => {
    const workspace = await seedWorkspace(`${prefix}po-budget@example.com`, prefix)
    const pdfPath = join(dir, `${randomUUID()}.pdf`)
    writeFileSync(pdfPath, 'fake pdf bytes')
    storage.getToTempFile.mockResolvedValue(pdfPath)
    extraction.extract.mockRejectedValue(new HttpException('Workspace monthly token budget reached', 402))
    const [po] = await db
      .insert(purchaseOrders)
      .values({ workspaceId: workspace.id, name: 'po.pdf', storageKey: `k/${randomUUID()}`, status: 'pending' })
      .returning()

    await expect(
      processor.handleParse(job('job-budget', { kind: 'purchase_order', id: po.id }, 0, 3)),
    ).resolves.toBeUndefined()

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe('Workspace monthly token budget reached')
  })

  // Launch hardening (S1). Files the way vendors and spreadsheet apps actually
  // save them. Every expected value was observed by replaying this processor's
  // own calls on the same bytes: Papa.parse(text, { header: true,
  // skipEmptyLines: false }), XLSX.read -> sheet_to_json({ defval: '' }) ->
  // Papa.unparse, file read as utf-8, sourceRow = record index + 2 (XLSX:
  // sheet row, see 'XLSX source rows (B1)').
  describe('real-world files (launch hardening)', () => {
    it('error: fails a truncated .xlsx at once with the spreadsheet message and stores no lines', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-corrupt-xlsx@example.com`, prefix)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ sku: 'A1', qty: 5 }]), 'Sheet1')
      const whole = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      // Half a zip: what an interrupted download or a broken sync leaves behind.
      const po = await seedPoBuffer(whole.subarray(0, Math.floor(whole.length / 2)), workspace.id, 'po.xlsx')

      await expect(
        processor.handleParse(job('job-rw-corrupt', { kind: 'purchase_order', id: po.id }, 0, 3)),
      ).resolves.toBeUndefined()

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('failed')
      expect(updated.lastError).toBe('Could not read this spreadsheet — it may be corrupt or password-protected')
      const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(items).toHaveLength(0)
    })

    // XLSX.read does not reject text bytes: it reads them as a one-sheet
    // workbook. Pinned so a change to that behaviour is a visible decision.
    it('edge: reads an .xlsx whose bytes are plain CSV text as a one-sheet workbook', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-text-xlsx@example.com`, prefix)
      const po = await seedPoBuffer(Buffer.from(['sku,qty', 'A1,10'].join('\n')), workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-text-xlsx', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        sku: 'A1',
        quantity: '10',
        sourceKind: 'xlsx',
        sourceSheet: 'Sheet1',
        sourceRow: 2,
      })
    })

    it('edge: parses every row of a four-column semicolon-delimited CSV ending in a newline', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-semicolon@example.com`, prefix)
      const po = await seedPo(
        'sku;description;qty;unit price\nA1;Widget;10;5.00\nB2;Gadget;3;9.99\n',
        workspace.id,
      )

      await processor.handleParse(job('job-rw-semicolon', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)
      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', sourceRow: 2 })
      expect(items[1]).toMatchObject({ sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '9.99', sourceRow: 3 })
    })

    it('edge: parses every row of a tab-delimited file', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-tab@example.com`, prefix)
      const po = await seedPo(
        ['sku\tdescription\tqty\tunit price', 'A1\tWidget\t10\t5.00', 'B2\tGadget\t3\t9.99'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-tab', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)
      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00' })
      expect(items[1]).toMatchObject({ sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '9.99' })
    })

    it('edge: maps the first column of a CSV saved with a UTF-8 byte order mark', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-bom@example.com`, prefix)
      const po = await seedPo('﻿sku,description,qty,unit price\nA1,Widget,10,5.00', workspace.id)

      await processor.handleParse(job('job-rw-bom', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item.sku).toBe('A1')
      // Papa strips the BOM, so the audit copy's header is clean too.
      expect(item.rawRow).toEqual({ sku: 'A1', description: 'Widget', qty: '10', 'unit price': '5.00' })
    })

    // sourceRow counts records, not physical lines: B2 sits on line 4 of the
    // file because A1's description spans two lines, yet it records 3 (D13).
    it('edge: keeps a quoted description with an embedded newline and doubled quotes in a CRLF file', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-crlf@example.com`, prefix)
      const po = await seedPo(
        [
          'sku,description,qty,unit price',
          'A1,"Widget, 10"" blue\nsecond line",10,5.00',
          'B2,Gadget,3,9.99',
          'C3,Gizmo,1,1.00',
        ].join('\r\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-crlf', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(3)
      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget, 10" blue\nsecond line', sourceRow: 2 })
      expect(items[1]).toMatchObject({ sku: 'B2', description: 'Gadget', sourceRow: 3 })
      expect(items[2]).toMatchObject({ sku: 'C3', description: 'Gizmo', sourceRow: 4 })
    })

    it('edge: parses rows with trailing commas and rows with missing cells without failing', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-ragged@example.com`, prefix)
      const po = await seedPo(
        ['sku,description,qty,unit price', 'A1,Widget,10,5.00,,', 'B2,Gadget,3'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-ragged', { kind: 'purchase_order', id: po.id }))

      const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)
      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items[0]).toMatchObject({ sku: 'A1', quantity: '10', unitPrice: '5.00' })
      // Papa files the surplus cells under __parsed_extra; the audit copy keeps them.
      expect(items[0].rawRow).toEqual({
        sku: 'A1',
        description: 'Widget',
        qty: '10',
        'unit price': '5.00',
        __parsed_extra: ['', ''],
      })
      expect(items[1]).toMatchObject({ sku: 'B2', quantity: '3', unitPrice: null })
      expect(items[1].rawRow).toEqual({ sku: 'B2', description: 'Gadget', qty: '3' })
    })

    // The file is read as UTF-8, so a Windows-1252 byte decodes to U+FFFD.
    // Pinned, not endorsed (D10): the line still lands, with a visible replacement.
    it('edge: stores a Windows-1252 accented byte as the Unicode replacement character', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-cp1252@example.com`, prefix)
      const bytes = Buffer.concat([
        Buffer.from('sku,description,qty,unit price\nA1,Caf', 'latin1'),
        Buffer.from([0xe9]),
        Buffer.from(' au lait,10,5.00', 'latin1'),
      ])
      const po = await seedPoBuffer(bytes, workspace.id, 'po.csv')

      await processor.handleParse(job('job-rw-cp1252', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item.description).toBe('Caf� au lait')
      expect(item.quantity).toBe('10')
    })

    it('edge: keeps lines whose quantity or unit price is zero', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-zero@example.com`, prefix)
      const po = await seedPo(
        ['sku,description,qty,unit price', 'A1,Free sample,0,5.00', 'B2,Widget,5,0'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-zero', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ sku: 'A1', quantity: '0', unitPrice: '5.00' })
      expect(items[1]).toMatchObject({ sku: 'B2', quantity: '5', unitPrice: '0' })
    })

    it('edge: keeps two lines with the same SKU as separate rows', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-dup-sku@example.com`, prefix)
      const po = await seedPo(
        ['sku,description,qty,unit price', 'A1,Widget,10,5.00', 'A1,Widget,2,5.00'].join('\n'),
        workspace.id,
      )

      await processor.handleParse(job('job-rw-dup-sku', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ sku: 'A1', quantity: '10', lineNumber: 1, sourceRow: 2 })
      expect(items[1]).toMatchObject({ sku: 'A1', quantity: '2', lineNumber: 2, sourceRow: 3 })
    })

    it('edge: parses only the first sheet of a two-sheet workbook', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-two-sheets@example.com`, prefix)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ sku: 'A1', qty: 10 }]), 'Lines')
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ sku: 'Z9', qty: 99 }]), 'Notes')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-two-sheets', { kind: 'purchase_order', id: po.id }))

      const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ sku: 'A1', quantity: '10', sourceSheet: 'Lines', sourceRow: 2 })
    })

    it('edge: stores a numeric SKU cell as its text', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-numeric-sku@example.com`, prefix)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ sku: 501, qty: 2 }]), 'Sheet1')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-numeric-sku', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item.sku).toBe('501')
      expect(item.quantity).toBe('2')
    })

    it('edge: stores the cached value of a formula cell', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-formula@example.com`, prefix)
      const sheet = XLSX.utils.aoa_to_sheet([
        ['sku', 'qty', 'unit price', 'total'],
        ['A1', 3, 5, 0],
      ])
      sheet['D2'] = { t: 'n', v: 15, f: 'B2*C2' }
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-formula', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item).toMatchObject({ sku: 'A1', quantity: '3', unitPrice: '5', lineTotal: '15' })
    })

    it('edge: gives a merged cell value only to the top-left row', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-merged@example.com`, prefix)
      const sheet = XLSX.utils.aoa_to_sheet([
        ['sku', 'description', 'qty', 'unit price'],
        ['A1', 'Widget', 10, 5],
        ['B2', '', 3, 9.99],
      ])
      sheet['!merges'] = [{ s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }]
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-rw-merged', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ sku: 'A1', description: 'Widget', sourceRow: 2 })
      expect(items[1]).toMatchObject({ sku: 'B2', description: null, quantity: '3', unitPrice: '9.99', sourceRow: 3 })
      expect(items[1].rawRow).toMatchObject({ description: '' })
    })

    it('happy: yields the same lines from a CSV and an XLSX holding the same rows', async () => {
      const workspace = await seedWorkspace(`${prefix}rw-parity@example.com`, prefix)
      const csvPo = await seedPo(
        ['sku,description,qty,unit price', 'A1,Widget,10,9.99', 'B2,Gadget,3,2.5'].join('\n'),
        workspace.id,
      )
      await processor.handleParse(job('job-rw-parity-csv', { kind: 'purchase_order', id: csvPo.id }))

      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet([
          { sku: 'A1', description: 'Widget', qty: 10, 'unit price': 9.99 },
          { sku: 'B2', description: 'Gadget', qty: 3, 'unit price': 2.5 },
        ]),
        'Sheet1',
      )
      const xlsxPo = await seedPoBuffer(
        XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
        workspace.id,
        'po.xlsx',
      )
      await processor.handleParse(job('job-rw-parity-xlsx', { kind: 'purchase_order', id: xlsxPo.id }))

      const fieldsOf = async (purchaseOrderId: string) =>
        (
          await db
            .select()
            .from(poLineItems)
            .where(eq(poLineItems.purchaseOrderId, purchaseOrderId))
            .orderBy(poLineItems.lineNumber)
        ).map(({ sku, description, quantity, unitPrice }) => ({ sku, description, quantity, unitPrice }))

      const expected = [
        { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '9.99' },
        { sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '2.5' },
      ]
      expect(await fieldsOf(csvPo.id)).toEqual(expected)
      expect(await fieldsOf(xlsxPo.id)).toEqual(expected)
    })
  })
  // B2/B3. A spreadsheet whose rows all map to nothing used to finish `done`
  // with 0 rows and fail only at compare; it must fail at parse with a reason,
  // the way an empty PDF does. A two-column semicolon file used to be read with
  // a comma because the trailing empty record skewed Papa's delimiter guess.
  describe('files with no readable line items (B2/B3)', () => {
    const NO_LINE_ITEMS =
      'No line items were found in this file. Its first row must hold column headers such as SKU, Description, Qty and Unit price, and it must be saved as a UTF-8 CSV or an XLSX workbook.'

    async function expectFailedWithNoLines(poId: string) {
      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId))
      expect(row.status).toBe('failed')
      expect(row.lastError).toBe(NO_LINE_ITEMS)
      const items = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, poId))
      expect(items).toHaveLength(0)
    }

    it('error: a header-only CSV fails at once with the no-line-items message and stores no lines', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-header-only@example.com`, prefix)
      const po = await seedPo('sku,description,qty,unit price\n', workspace.id)

      await processor.handleParse(job('job-zr-header-only', { kind: 'purchase_order', id: po.id }))

      await expectFailedWithNoLines(po.id)
    })

    it('error: an empty file fails with the no-line-items message', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-empty@example.com`, prefix)
      const po = await seedPoBuffer(Buffer.alloc(0), workspace.id, 'po.csv')

      await processor.handleParse(job('job-zr-empty', { kind: 'purchase_order', id: po.id }))

      await expectFailedWithNoLines(po.id)
    })

    it('error: a UTF-16 CSV fails with the no-line-items message', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-utf16@example.com`, prefix)
      const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('sku,qty\r\nA1,5\r\n', 'utf16le')])
      const po = await seedPoBuffer(bytes, workspace.id, 'po.csv')

      await processor.handleParse(job('job-zr-utf16', { kind: 'purchase_order', id: po.id }))

      await expectFailedWithNoLines(po.id)
    })

    it('error: a CSV whose headers match no known column fails with the no-line-items message', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-unknown@example.com`, prefix)
      const po = await seedPo(['Foo,Bar', 'x,1', 'y,2'].join('\n'), workspace.id)

      await processor.handleParse(job('job-zr-unknown', { kind: 'purchase_order', id: po.id }))

      await expectFailedWithNoLines(po.id)
    })

    it('error: an XLSX with a title row above the header fails with the no-line-items message', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-title-row@example.com`, prefix)
      const sheet = XLSX.utils.aoa_to_sheet([
        ['Purchase order 4471'],
        ['sku', 'qty', 'unit price'],
        ['A1', 10, 5],
      ])
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
      const po = await seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspace.id, 'po.xlsx')

      await processor.handleParse(job('job-zr-title-row', { kind: 'purchase_order', id: po.id }))

      await expectFailedWithNoLines(po.id)
    })

    it('error: the failure is permanent, so the first of three attempts records it and Bull is not asked to retry', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-permanent@example.com`, prefix)
      const po = await seedPo('sku,qty\n', workspace.id)

      await expect(
        processor.handleParse(job('job-zr-permanent', { kind: 'purchase_order', id: po.id }, 0, 3)),
      ).resolves.toBeUndefined()

      await expectFailedWithNoLines(po.id)
    })

    it('edge: a two-column semicolon goods receipt ending in a newline parses both lines', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-semi-grn@example.com`, prefix)
      const grn = await seedGoodsReceipt('sku;qty received\nA1;5\nB2;7\n', workspace.id)

      await processor.handleParse(job('job-zr-semi-grn', { kind: 'goods_receipt', id: grn.id }))

      const [updated] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, grn.id))
      expect(updated.status).toBe('done')
      expect(updated.rowCount).toBe(2)
      const lines = await db
        .select()
        .from(goodsReceiptLineItems)
        .where(eq(goodsReceiptLineItems.goodsReceiptId, grn.id))
        .orderBy(goodsReceiptLineItems.lineNumber)
      expect(lines.map((line) => [line.sku, line.quantityReceived])).toEqual([
        ['A1', '5'],
        ['B2', '7'],
      ])
    })

    it('edge: a two-column semicolon file with CRLF line endings parses', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-semi-crlf@example.com`, prefix)
      const po = await seedPo('sku;qty\r\nA1;5\r\nB2;7\r\n', workspace.id)

      await processor.handleParse(job('job-zr-semi-crlf', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items.map((item) => [item.sku, item.quantity])).toEqual([
        ['A1', '5'],
        ['B2', '7'],
      ])
    })

    it('regression: a blank line inside a two-column semicolon file still records the true source row', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-semi-blank@example.com`, prefix)
      const po = await seedPo('sku;qty\n\nA1;5\n', workspace.id)

      await processor.handleParse(job('job-zr-semi-blank', { kind: 'purchase_order', id: po.id }))

      const [item] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))
      expect(item).toMatchObject({ sku: 'A1', quantity: '5', sourceRow: 3 })
    })

    it('regression: a comma file whose descriptions contain semicolons still splits on commas', async () => {
      const workspace = await seedWorkspace(`${prefix}zr-comma-semi@example.com`, prefix)
      const po = await seedPo(['sku,description,qty', 'A1,"Bolt; M8; zinc",10', 'B2,Nut;M8,4'].join('\n'), workspace.id)

      await processor.handleParse(job('job-zr-comma-semi', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items.map((item) => [item.sku, item.description, item.quantity])).toEqual([
        ['A1', 'Bolt; M8; zinc', '10'],
        ['B2', 'Nut;M8', '4'],
      ])
    })
  })

  // B1. sheet_to_json drops blank rows, so numbering XLSX lines by their
  // position in the converted CSV cited the wrong spreadsheet row for every
  // line after a blank one. The citation must be the row the reviewer sees.
  describe('XLSX source rows (B1)', () => {
    async function seedSheet(rows: unknown[][], workspaceId: string) {
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
      return seedPoBuffer(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, workspaceId, 'po.xlsx')
    }

    it('regression: a line after a blank row cites its true spreadsheet row', async () => {
      const workspace = await seedWorkspace(`${prefix}b1-blank@example.com`, prefix)
      const po = await seedSheet([['sku', 'qty'], ['A1', 1], [], ['A3', 3]], workspace.id)

      await processor.handleParse(job('job-b1-blank', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items.map((item) => [item.sku, item.sourceRow])).toEqual([
        ['A1', 2],
        ['A3', 4],
      ])
    })

    it('regression: a row of empty cells is skipped and the next line keeps its true row', async () => {
      const workspace = await seedWorkspace(`${prefix}b1-empty-cells@example.com`, prefix)
      const po = await seedSheet([['sku', 'qty'], ['A1', 1], [], ['A3', 3], ['', ''], ['A5', 5]], workspace.id)

      await processor.handleParse(job('job-b1-empty-cells', { kind: 'purchase_order', id: po.id }))

      const items = await db
        .select()
        .from(poLineItems)
        .where(eq(poLineItems.purchaseOrderId, po.id))
        .orderBy(poLineItems.lineNumber)
      expect(items.map((item) => [item.sku, item.sourceRow, item.sourceSheet])).toEqual([
        ['A1', 2, 'Sheet1'],
        ['A3', 4, 'Sheet1'],
        ['A5', 6, 'Sheet1'],
      ])
    })
  })

  // Photo intake: a header with sourceKind 'image' is read page by page by the
  // vision chain, never through getToTempFile / CSV / PDF.
  describe('photo documents', () => {
    const PAGE_DIR = 'ws/procurement/x-pages'

    async function seedImageDoc(
      kind: 'purchase_order' | 'invoice' | 'goods_receipt',
      workspaceId: string,
      overrides: { pageCount?: number | null; name?: string } = {},
    ) {
      const pageCount = overrides.pageCount === undefined ? 2 : overrides.pageCount
      const common = {
        workspaceId,
        name: overrides.name ?? 'scan.pdf',
        storageKey: `${PAGE_DIR}/${overrides.name ?? 'scan.pdf'}`,
        status: 'pending' as const,
        sourceKind: 'image',
        reviewRequired: true,
        pageCount,
      }
      if (kind === 'purchase_order') {
        const [row] = await db.insert(purchaseOrders).values(common).returning()
        return row
      }
      if (kind === 'invoice') {
        const [row] = await db.insert(invoices).values(common).returning()
        return row
      }
      const [po] = await db.insert(purchaseOrders).values({ workspaceId, name: 'linked.csv', status: 'done' }).returning()
      const [row] = await db.insert(goodsReceipts).values({ ...common, purchaseOrderId: po.id }).returning()
      return row
    }

    const INVOICE_RESULT = {
      detectedKind: 'invoice',
      items: [
        { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', uom: 'EA', confidence: 0.92 },
        { sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: null, lineTotal: null, uom: null, confidence: null },
      ],
    }

    it('error: a missing page object fails the document at once, with the client-safe message, and never calls the model', async () => {
      const workspace = await seedWorkspace(`${prefix}img-missing@example.com`, prefix)
      const po = await seedImageDoc('purchase_order', workspace.id)
      storage.getBuffer.mockResolvedValueOnce(Buffer.from('page 1')).mockRejectedValueOnce(new StorageObjectNotFoundError(`${PAGE_DIR}/2.jpg`))

      await expect(
        processor.handleParse(job('job-img-missing', { kind: 'purchase_order', id: po.id }, 0, 3)),
      ).resolves.toBeUndefined()

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(row.status).toBe('failed')
      expect(row.lastError).toBe('The stored file is missing. Upload it again.')
      expect(extraction.extractFromImages).not.toHaveBeenCalled()
      expect(compareService.enqueueForDocument).not.toHaveBeenCalled()
    })

    it('error: a photo document with no pages is a permanent failure and never calls the model', async () => {
      const workspace = await seedWorkspace(`${prefix}img-nopages@example.com`, prefix)
      const po = await seedImageDoc('purchase_order', workspace.id, { pageCount: null })

      await expect(
        processor.handleParse(job('job-img-nopages', { kind: 'purchase_order', id: po.id }, 0, 3)),
      ).resolves.toBeUndefined()

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(row.status).toBe('failed')
      expect(row.lastError).toBeTruthy()
      expect(extraction.extractFromImages).not.toHaveBeenCalled()
      expect(storage.getBuffer).not.toHaveBeenCalled()
    })

    it('error: an exhausted workspace token budget fails permanently with the budget message and no lines', async () => {
      const workspace = await seedWorkspace(`${prefix}img-budget@example.com`, prefix)
      const po = await seedImageDoc('purchase_order', workspace.id)
      extraction.extractFromImages.mockRejectedValue(new HttpException('Workspace monthly token budget reached', 402))

      await expect(
        processor.handleParse(job('job-img-budget', { kind: 'purchase_order', id: po.id }, 0, 3)),
      ).resolves.toBeUndefined()

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(row.status).toBe('failed')
      expect(row.lastError).toBe('Workspace monthly token budget reached')
      expect(await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))).toHaveLength(0)
    })

    it('error: a model refusal and an empty read both fail permanently with their own message', async () => {
      const { ProcurementExtractionRefusalError, ProcurementExtractionEmptyError } = jest.requireMock('@repo/ai') as {
        ProcurementExtractionRefusalError: new () => Error
        ProcurementExtractionEmptyError: new () => Error
      }
      const workspace = await seedWorkspace(`${prefix}img-permanent@example.com`, prefix)
      const refused = await seedImageDoc('invoice', workspace.id)
      const empty = await seedImageDoc('invoice', workspace.id)

      extraction.extractFromImages.mockRejectedValueOnce(new ProcurementExtractionRefusalError())
      await processor.handleParse(job('job-img-refuse', { kind: 'invoice', id: refused.id }, 0, 3))
      extraction.extractFromImages.mockRejectedValueOnce(new ProcurementExtractionEmptyError())
      await processor.handleParse(job('job-img-empty', { kind: 'invoice', id: empty.id }, 0, 3))

      const [r] = await db.select().from(invoices).where(eq(invoices.id, refused.id))
      const [e] = await db.select().from(invoices).where(eq(invoices.id, empty.id))
      expect(r).toMatchObject({ status: 'failed', lastError: 'Model refused procurement extraction request' })
      expect(e).toMatchObject({ status: 'failed', lastError: 'No line items were found in this document' })
    })

    it('edge: a transient model failure before the last attempt rethrows and leaves the document processing', async () => {
      const workspace = await seedWorkspace(`${prefix}img-transient@example.com`, prefix)
      const po = await seedImageDoc('purchase_order', workspace.id)
      extraction.extractFromImages.mockRejectedValue(new Error('socket hang up'))

      await expect(
        processor.handleParse(job('job-img-t1', { kind: 'purchase_order', id: po.id }, 0, 3)),
      ).rejects.toThrow('socket hang up')

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(row.status).toBe('processing')
      expect(row.lastError).toBeNull()
    })

    it('edge: pages are read in order from <storageKey dir>/<n>.jpg and sent as image/jpeg; the CSV/PDF temp-file path is not used', async () => {
      const workspace = await seedWorkspace(`${prefix}img-pages@example.com`, prefix)
      const po = await seedImageDoc('purchase_order', workspace.id, { pageCount: 3 })
      storage.getBuffer
        .mockResolvedValueOnce(Buffer.from('p1'))
        .mockResolvedValueOnce(Buffer.from('p2'))
        .mockResolvedValueOnce(Buffer.from('p3'))
      extraction.extractFromImages.mockResolvedValue({ ...INVOICE_RESULT, detectedKind: 'purchase_order' })

      await processor.handleParse(job('job-img-pages', { kind: 'purchase_order', id: po.id }))

      expect(storage.getBuffer.mock.calls.map((c) => c[0])).toEqual([
        `${PAGE_DIR}/1.jpg`,
        `${PAGE_DIR}/2.jpg`,
        `${PAGE_DIR}/3.jpg`,
      ])
      expect(extraction.extractFromImages).toHaveBeenCalledWith(
        [
          { buffer: Buffer.from('p1'), mime: 'image/jpeg' },
          { buffer: Buffer.from('p2'), mime: 'image/jpeg' },
          { buffer: Buffer.from('p3'), mime: 'image/jpeg' },
        ],
        'purchase_order',
        workspace.id,
      )
      expect(storage.getToTempFile).not.toHaveBeenCalled()
      expect(extraction.extract).not.toHaveBeenCalled()
    })

    it('edge: the review gate survives the parse: reviewRequired stays true and reviewedAt stays null', async () => {
      const workspace = await seedWorkspace(`${prefix}img-gate@example.com`, prefix)
      const inv = await seedImageDoc('invoice', workspace.id)
      extraction.extractFromImages.mockResolvedValue(INVOICE_RESULT)

      await processor.handleParse(job('job-img-gate', { kind: 'invoice', id: inv.id }))

      const [row] = await db.select().from(invoices).where(eq(invoices.id, inv.id))
      expect(row).toMatchObject({ status: 'done', reviewRequired: true, reviewedAt: null, rowCount: 2 })
    })

    it('edge: re-running the parse replaces the lines instead of duplicating them', async () => {
      const workspace = await seedWorkspace(`${prefix}img-rerun@example.com`, prefix)
      const po = await seedImageDoc('purchase_order', workspace.id)
      extraction.extractFromImages.mockResolvedValue({ ...INVOICE_RESULT, detectedKind: 'purchase_order' })

      await processor.handleParse(job('job-img-rerun-1', { kind: 'purchase_order', id: po.id }))
      await processor.handleParse(job('job-img-rerun-2', { kind: 'purchase_order', id: po.id }))

      expect(await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, po.id))).toHaveLength(2)
    })

    it('edge: a detectedKind of "unknown" is stored as-is', async () => {
      const workspace = await seedWorkspace(`${prefix}img-unknown@example.com`, prefix)
      const po = await seedImageDoc('purchase_order', workspace.id)
      extraction.extractFromImages.mockResolvedValue({ ...INVOICE_RESULT, detectedKind: 'unknown' })

      await processor.handleParse(job('job-img-unknown', { kind: 'purchase_order', id: po.id }))

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(row.detectedKind).toBe('unknown')
    })

    it('edge: a stitched-PDF name ending in .pdf does not trigger the PDF-receipt refusal for a photo goods receipt', async () => {
      const workspace = await seedWorkspace(`${prefix}img-grn-pdfname@example.com`, prefix)
      const grn = await seedImageDoc('goods_receipt', workspace.id, { name: 'grn.pdf' })
      extraction.extractFromImages.mockResolvedValue({
        detectedKind: 'goods_receipt',
        items: [{ sku: 'A1', description: 'Widget', quantityReceived: '10', quantityAccepted: '8', quantityRejected: '2', uom: 'EA', confidence: 0.7 }],
      })

      await processor.handleParse(job('job-img-grn-name', { kind: 'goods_receipt', id: grn.id }))

      const [row] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, grn.id))
      expect(row.status).toBe('done')
    })

    it('regression: a PDF goods receipt (not a photo) is still refused', async () => {
      const workspace = await seedWorkspace(`${prefix}img-regress-pdfgrn@example.com`, prefix)
      const [po] = await db.insert(purchaseOrders).values({ workspaceId: workspace.id, name: 'l.csv', status: 'done' }).returning()
      const [grn] = await db
        .insert(goodsReceipts)
        .values({ workspaceId: workspace.id, purchaseOrderId: po.id, name: 'grn.pdf', storageKey: `k/${randomUUID()}`, status: 'pending', sourceKind: 'pdf' })
        .returning()

      await processor.handleParse(job('job-img-regress-pdfgrn', { kind: 'goods_receipt', id: grn.id }, 0, 3))

      const [row] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, grn.id))
      expect(row).toMatchObject({ status: 'failed', lastError: 'Goods receipts must be CSV or XLSX; PDF is not supported yet' })
      expect(extraction.extractFromImages).not.toHaveBeenCalled()
    })

    it('regression: a CSV goods receipt still stores no confidence or extractor version', async () => {
      const workspace = await seedWorkspace(`${prefix}img-regress-csvgrn@example.com`, prefix)
      const grn = await seedGoodsReceipt(['sku,qty received,qty accepted', 'A1,10,8'].join('\n'), workspace.id)

      await processor.handleParse(job('job-img-regress-csvgrn', { kind: 'goods_receipt', id: grn.id }))

      const [line] = await db.select().from(goodsReceiptLineItems).where(eq(goodsReceiptLineItems.goodsReceiptId, grn.id))
      expect(line.extractionConfidence).toBeNull()
      expect(line.extractorVersion).toBeNull()
      const [row] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, grn.id))
      expect(row.detectedKind).toBeNull()
    })

    it('happy: a photo invoice is parsed with IMAGE_EXTRACTOR_VERSION, sourceKind image-extraction and detectedKind stored', async () => {
      const workspace = await seedWorkspace(`${prefix}img-happy@example.com`, prefix)
      const inv = await seedImageDoc('invoice', workspace.id)
      extraction.extractFromImages.mockResolvedValue(INVOICE_RESULT)

      await processor.handleParse(job('job-img-happy', { kind: 'invoice', id: inv.id }))

      const [row] = await db.select().from(invoices).where(eq(invoices.id, inv.id))
      expect(row).toMatchObject({ status: 'done', rowCount: 2, detectedKind: 'invoice', lastError: null })
      const lines = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, inv.id)).orderBy(invoiceLineItems.lineNumber)
      expect(lines[0]).toMatchObject({
        sku: 'A1',
        description: 'Widget',
        quantity: '10',
        unitPrice: '5.00',
        lineTotal: '50.00',
        uom: 'EA',
        extractionConfidence: '0.92',
        extractorVersion: 'procurement-image-extraction@1',
        sourceKind: 'image-extraction',
        sourceRow: null,
        sourceSheet: null,
        editedAt: null,
      })
      expect(lines[1].extractionConfidence).toBeNull()
      expect(extraction.extractFromImages).toHaveBeenCalledWith(expect.any(Array), 'invoice', workspace.id)
      expect(compareService.enqueueForDocument).toHaveBeenCalledWith('invoice', inv.id)
    })

    it('happy: a photo goods receipt stores the three quantities, confidence and extractor version', async () => {
      const workspace = await seedWorkspace(`${prefix}img-grn@example.com`, prefix)
      const grn = await seedImageDoc('goods_receipt', workspace.id)
      extraction.extractFromImages.mockResolvedValue({
        detectedKind: 'goods_receipt',
        items: [
          { sku: 'A1', description: 'Widget', quantityReceived: '10', quantityAccepted: '8', quantityRejected: '2', uom: 'EA', confidence: 0.81 },
          { sku: 'B2', description: 'Gadget', quantityReceived: null, quantityAccepted: '4', quantityRejected: null, uom: null, confidence: 0.5 },
        ],
      })

      await processor.handleParse(job('job-img-grn', { kind: 'goods_receipt', id: grn.id }))

      const lines = await db
        .select()
        .from(goodsReceiptLineItems)
        .where(eq(goodsReceiptLineItems.goodsReceiptId, grn.id))
        .orderBy(goodsReceiptLineItems.lineNumber)
      expect(lines[0]).toMatchObject({
        quantityReceived: '10',
        quantityAccepted: '8',
        quantityRejected: '2',
        uom: 'EA',
        extractionConfidence: '0.81',
        extractorVersion: 'procurement-image-extraction@1',
        sourceKind: 'image-extraction',
      })
      // Null is not zero (POLICY v1 #14): an unstated quantity stays NULL.
      expect(lines[1].quantityReceived).toBeNull()
      expect(lines[1].quantityRejected).toBeNull()
      expect(lines[1].quantityAccepted).toBe('4')
      const [row] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, grn.id))
      expect(row.detectedKind).toBe('goods_receipt')
    })
  })
})
