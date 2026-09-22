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
import { StorageService } from '../storage/storage.service'

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
  let storage: { getToTempFile: jest.Mock; save: jest.Mock }
  let extraction: { extract: jest.Mock }
  let parseService: { reconcile: jest.Mock }
  let processor: ProcurementParseProcessor
  const originalPdfFlag = process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = 'true'
    dir = mkdtempSync(join(tmpdir(), 'procurement-parse-proc-spec-'))
    storage = { getToTempFile: jest.fn(), save: jest.fn().mockResolvedValue(undefined) }
    extraction = { extract: jest.fn() }
    parseService = { reconcile: jest.fn().mockResolvedValue(undefined) }
    processor = new ProcurementParseProcessor(
      storage as unknown as StorageService,
      extraction as unknown as ProcurementExtractionService,
      parseService as unknown as ProcurementParseService,
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
  })

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
})
