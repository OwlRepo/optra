import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { and, asc, eq, like } from 'drizzle-orm'
import {
  db,
  goodsReceiptLineItems,
  goodsReceipts,
  invoiceLineItems,
  invoices,
  poLineItems,
  pool,
  purchaseOrders,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { ProcurementReviewService } from './procurement-review.service'
import type { ProcurementCompareService } from './procurement-compare.service'
import type { StorageService } from '../storage/storage.service'

// Constructor: (storage, compareService). Real optra_unit database, like the
// other procurement DB-backed specs; the storage and the compare queue are fakes.

const PREFIX = `procurement-review-spec-${Date.now()}-`

async function cleanupFixtures() {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const { workspaceId } of memberships) {
      await db.delete(invoices).where(eq(invoices.workspaceId, workspaceId))
      await db.delete(goodsReceipts).where(eq(goodsReceipts.workspaceId, workspaceId))
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${PREFIX}%`))
}

let seq = 0
async function seedWorkspace(label: string) {
  seq += 1
  const [user] = await db
    .insert(users)
    .values({ email: `${PREFIX}${label}-${seq}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db.insert(workspaces).values({ name: `Review ${label}`, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  return { workspace, user }
}

const OLD = new Date('2026-01-01T00:00:00.000Z')

type SeedOptions = {
  status?: 'pending' | 'processing' | 'done' | 'failed'
  reviewRequired?: boolean
  reviewedAt?: Date | null
  pageCount?: number
}

type LineSeed = { sku: string; quantity: string; unitPrice: string; lineTotal: string; extractionConfidence?: string }

const DEFAULT_LINES: LineSeed[] = [
  { sku: 'A1', quantity: '10', unitPrice: '5', lineTotal: '50', extractionConfidence: '0.92' },
  { sku: 'B2', quantity: '3', unitPrice: '9.99', lineTotal: '29.97', extractionConfidence: '0.4' },
  { sku: 'C3', quantity: '1', unitPrice: '100', lineTotal: '100', extractionConfidence: '0.88' },
]

async function seedPo(workspaceId: string, options: SeedOptions = {}, lines: LineSeed[] = DEFAULT_LINES) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      workspaceId,
      name: 'po-photo.pdf',
      status: options.status ?? 'done',
      sourceKind: 'image',
      storageKey: `${workspaceId}/procurement/purchase_order/x-pages/po-photo.pdf`,
      reviewRequired: options.reviewRequired ?? true,
      reviewedAt: options.reviewedAt ?? null,
      pageCount: options.pageCount ?? 2,
      detectedKind: 'purchase_order',
      rowCount: lines.length,
      updatedAt: OLD,
    })
    .returning()
  const inserted = await db
    .insert(poLineItems)
    .values(
      lines.map((line, index) => ({
        workspaceId,
        purchaseOrderId: po.id,
        lineNumber: index + 1,
        sourceKind: 'image-extraction',
        extractorVersion: 'procurement-image-extraction@1',
        ...line,
      })),
    )
    .returning()
  return { po, lines: inserted.sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0)) }
}

async function poLines(purchaseOrderId: string) {
  return db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, purchaseOrderId)).orderBy(asc(poLineItems.lineNumber))
}

describe('ProcurementReviewService', () => {
  let service: ProcurementReviewService
  let storage: { getBuffer: jest.Mock }
  let compare: { enqueueForDocument: jest.Mock }

  beforeEach(() => {
    storage = { getBuffer: jest.fn().mockResolvedValue(Buffer.from('jpeg bytes')) }
    compare = { enqueueForDocument: jest.fn().mockResolvedValue(undefined) }
    service = new ProcurementReviewService(
      storage as unknown as StorageService,
      compare as unknown as ProcurementCompareService,
    )
  })

  afterAll(async () => {
    await cleanupFixtures()
    await pool.end()
  })

  describe('listLines', () => {
    it('error: a document in another workspace is a 404', async () => {
      const a = await seedWorkspace('list-a')
      const b = await seedWorkspace('list-b')
      const { po } = await seedPo(a.workspace.id)

      await expect(service.listLines(b.workspace.id, 'purchase_order', po.id, {})).rejects.toBeInstanceOf(NotFoundException)
    })

    it('error: an unknown document id is a 404', async () => {
      const a = await seedWorkspace('list-unknown')

      await expect(
        service.listLines(a.workspace.id, 'purchase_order', '00000000-0000-4000-8000-000000000000', {}),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('error: a purchase-order id asked for as an invoice is a 404 (kind is part of the lookup)', async () => {
      const a = await seedWorkspace('list-kind')
      const { po } = await seedPo(a.workspace.id)

      await expect(service.listLines(a.workspace.id, 'invoice', po.id, {})).rejects.toBeInstanceOf(NotFoundException)
    })

    it('edge: page 2 with pageSize 2 returns the third line and the paging envelope', async () => {
      const a = await seedWorkspace('list-page')
      const { po } = await seedPo(a.workspace.id)

      const result = await service.listLines(a.workspace.id, 'purchase_order', po.id, { page: 2, pageSize: 2 })

      expect(result.items.map((l) => l.sku)).toEqual(['C3'])
      expect(result).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 })
    })

    it('edge: a page past the end is empty, not an error', async () => {
      const a = await seedWorkspace('list-past')
      const { po } = await seedPo(a.workspace.id)

      const result = await service.listLines(a.workspace.id, 'purchase_order', po.id, { page: 9, pageSize: 2 })

      expect(result.items).toEqual([])
      expect(result.total).toBe(3)
    })

    it('edge: a document with no lines lists an empty page with totalPages 0', async () => {
      const a = await seedWorkspace('list-empty')
      const { po } = await seedPo(a.workspace.id, {}, [])

      const result = await service.listLines(a.workspace.id, 'purchase_order', po.id, {})

      expect(result).toMatchObject({ items: [], total: 0, totalPages: 0 })
    })

    it('edge: lines from another document of the same workspace never leak in', async () => {
      const a = await seedWorkspace('list-sibling')
      const first = await seedPo(a.workspace.id)
      await seedPo(a.workspace.id, {}, [{ sku: 'OTHER', quantity: '1', unitPrice: '1', lineTotal: '1' }])

      const result = await service.listLines(a.workspace.id, 'purchase_order', first.po.id, {})

      expect(result.items.map((l) => l.sku)).toEqual(['A1', 'B2', 'C3'])
    })

    it('happy: returns the review document header and ordered lines with numeric confidence', async () => {
      const a = await seedWorkspace('list-happy')
      const { po, lines } = await seedPo(a.workspace.id)

      const result = await service.listLines(a.workspace.id, 'purchase_order', po.id, {})

      expect(result.document).toMatchObject({
        id: po.id,
        name: 'po-photo.pdf',
        status: 'done',
        sourceKind: 'image',
        pageCount: 2,
        detectedKind: 'purchase_order',
        reviewRequired: true,
        reviewedAt: null,
        reviewedBy: null,
      })
      expect(result.items.map((l) => l.id)).toEqual(lines.map((l) => l.id))
      expect(result.items[0]).toMatchObject({
        lineNumber: 1,
        sku: 'A1',
        quantity: '10',
        unitPrice: '5',
        lineTotal: '50',
        extractionConfidence: 0.92,
        sourceKind: 'image-extraction',
        editedAt: null,
        editedBy: null,
      })
      expect(result.total).toBe(3)
    })

    it('happy: goods-receipt lines expose the three quantities', async () => {
      const a = await seedWorkspace('list-grn')
      const { po } = await seedPo(a.workspace.id)
      const [grn] = await db
        .insert(goodsReceipts)
        .values({
          workspaceId: a.workspace.id,
          purchaseOrderId: po.id,
          name: 'grn.pdf',
          status: 'done',
          sourceKind: 'image',
          reviewRequired: true,
          pageCount: 1,
        })
        .returning()
      await db.insert(goodsReceiptLineItems).values({
        workspaceId: a.workspace.id,
        goodsReceiptId: grn.id,
        lineNumber: 1,
        sku: 'A1',
        quantityReceived: '10',
        quantityAccepted: '8',
        quantityRejected: '2',
        sourceKind: 'image-extraction',
        extractionConfidence: '0.7',
      })

      const result = await service.listLines(a.workspace.id, 'goods_receipt', grn.id, {})

      expect(result.items[0]).toMatchObject({
        sku: 'A1',
        quantityReceived: '10',
        quantityAccepted: '8',
        quantityRejected: '2',
        extractionConfidence: 0.7,
      })
    })
  })

  describe('getPage', () => {
    it('error: a document in another workspace is a 404 and storage is never read', async () => {
      const a = await seedWorkspace('page-a')
      const b = await seedWorkspace('page-b')
      const { po } = await seedPo(a.workspace.id)

      await expect(service.getPage(b.workspace.id, 'purchase_order', po.id, 1)).rejects.toBeInstanceOf(NotFoundException)
      expect(storage.getBuffer).not.toHaveBeenCalled()
    })

    it('error: a document that is not a photo document is a 404', async () => {
      const a = await seedWorkspace('page-csv')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: a.workspace.id, name: 'po.csv', status: 'done', sourceKind: 'csv', storageKey: `${a.workspace.id}/x/po.csv` })
        .returning()

      await expect(service.getPage(a.workspace.id, 'purchase_order', po.id, 1)).rejects.toBeInstanceOf(NotFoundException)
      expect(storage.getBuffer).not.toHaveBeenCalled()
    })

    it.each([0, -1, 3, 1.5])('error: page %p is out of range for a 2-page document -> 404, storage not read', async (n) => {
      const a = await seedWorkspace(`page-range-${n}`)
      const { po } = await seedPo(a.workspace.id, { pageCount: 2 })

      await expect(service.getPage(a.workspace.id, 'purchase_order', po.id, n)).rejects.toBeInstanceOf(NotFoundException)
      expect(storage.getBuffer).not.toHaveBeenCalled()
    })

    it('error: a page object missing from storage is a 404, not a 500', async () => {
      const { StorageObjectNotFoundError } = await import('../storage/storage.errors')
      storage.getBuffer.mockRejectedValue(new StorageObjectNotFoundError('missing'))
      const a = await seedWorkspace('page-missing')
      const { po } = await seedPo(a.workspace.id)

      await expect(service.getPage(a.workspace.id, 'purchase_order', po.id, 1)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('happy: page 2 reads <storageKey dir>/2.jpg and returns the bytes', async () => {
      const a = await seedWorkspace('page-happy')
      const { po } = await seedPo(a.workspace.id, { pageCount: 2 })

      const buffer = await service.getPage(a.workspace.id, 'purchase_order', po.id, 2)

      expect(storage.getBuffer).toHaveBeenCalledWith(`${a.workspace.id}/procurement/purchase_order/x-pages/2.jpg`)
      expect(Buffer.from(buffer).toString()).toBe('jpeg bytes')
    })
  })

  describe('review', () => {
    it('error: a document in another workspace is a 404 and nothing is written', async () => {
      const a = await seedWorkspace('rev-a')
      const b = await seedWorkspace('rev-b')
      const { po, lines } = await seedPo(a.workspace.id)

      await expect(
        service.review(b.workspace.id, 'purchase_order', po.id, b.user.id, { lines: [{ id: lines[0].id, sku: 'HACK' }] }),
      ).rejects.toBeInstanceOf(NotFoundException)

      const [after] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(after.reviewedAt).toBeNull()
      expect((await poLines(po.id))[0].sku).toBe('A1')
      expect(compare.enqueueForDocument).not.toHaveBeenCalled()
    })

    it('error: a foreign line id is a 404 "Line not found" and the whole review rolls back', async () => {
      const a = await seedWorkspace('rev-foreign-a')
      const b = await seedWorkspace('rev-foreign-b')
      const mine = await seedPo(a.workspace.id)
      const theirs = await seedPo(b.workspace.id)

      await expect(
        service.review(a.workspace.id, 'purchase_order', mine.po.id, a.user.id, {
          lines: [
            { id: mine.lines[0].id, sku: 'CHANGED', quantity: '99', unitPrice: '5', lineTotal: '495' },
            { id: theirs.lines[0].id, sku: 'STOLEN' },
          ],
        }),
      ).rejects.toThrow(NotFoundException)

      const [header] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, mine.po.id))
      expect(header.reviewedAt).toBeNull()
      const stored = await poLines(mine.po.id)
      expect(stored.map((l) => l.sku)).toEqual(['A1', 'B2', 'C3'])
      expect(stored[0].editedAt).toBeNull()
      const foreign = await poLines(theirs.po.id)
      expect(foreign[0].sku).toBe('A1')
      expect(foreign[0].editedAt).toBeNull()
      expect(compare.enqueueForDocument).not.toHaveBeenCalled()
    })

    it('error: an unknown line id is a 404 "Line not found" and nothing is written', async () => {
      const a = await seedWorkspace('rev-unknown')
      const { po } = await seedPo(a.workspace.id)

      await expect(
        service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
          lines: [{ id: '00000000-0000-4000-8000-000000000000', sku: 'X' }],
        }),
      ).rejects.toThrow('Line not found')

      const [header] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(header.reviewedAt).toBeNull()
      expect(await poLines(po.id)).toHaveLength(3)
    })

    it('error: duplicate line ids in the body are a 400 and nothing is written', async () => {
      const a = await seedWorkspace('rev-dup')
      const { po, lines } = await seedPo(a.workspace.id)

      await expect(
        service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
          lines: [
            { id: lines[0].id, sku: 'A1', quantity: '1' },
            { id: lines[0].id, sku: 'A1', quantity: '2' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException)

      const [header] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(header.reviewedAt).toBeNull()
      expect(await poLines(po.id)).toHaveLength(3)
    })

    it('error: an already reviewed document is a 409 "already reviewed" and lines stay immutable', async () => {
      const a = await seedWorkspace('rev-twice')
      const { po, lines } = await seedPo(a.workspace.id, { reviewedAt: new Date('2026-02-02T00:00:00Z') })

      await expect(
        service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, { lines: [{ id: lines[0].id, sku: 'LATE' }] }),
      ).rejects.toThrow(/already reviewed/)
      await expect(
        service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, { lines: [{ id: lines[0].id, sku: 'LATE' }] }),
      ).rejects.toBeInstanceOf(ConflictException)

      expect((await poLines(po.id))[0].sku).toBe('A1')
      expect(compare.enqueueForDocument).not.toHaveBeenCalled()
    })

    it.each(['pending', 'processing', 'failed'] as const)(
      'error: status %s is a 409 "still parsing"',
      async (status) => {
        const a = await seedWorkspace(`rev-status-${status}`)
        const { po, lines } = await seedPo(a.workspace.id, { status })

        const err = await service
          .review(a.workspace.id, 'purchase_order', po.id, a.user.id, { lines: [{ id: lines[0].id, sku: 'X' }] })
          .catch((e: unknown) => e)

        expect(err).toBeInstanceOf(ConflictException)
        expect((err as Error).message).toMatch(/still parsing/)
        const [header] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
        expect(header.reviewedAt).toBeNull()
      },
    )

    it('error: a document with review_required=false is a 400 "does not need review"', async () => {
      const a = await seedWorkspace('rev-norequired')
      const { po, lines } = await seedPo(a.workspace.id, { reviewRequired: false })

      const err = await service
        .review(a.workspace.id, 'purchase_order', po.id, a.user.id, { lines: [{ id: lines[0].id, sku: 'X' }] })
        .catch((e: unknown) => e)

      expect(err).toBeInstanceOf(BadRequestException)
      expect((err as Error).message).toMatch(/does not need review/)
      expect((await poLines(po.id))[0].sku).toBe('A1')
    })

    it('edge: two concurrent confirms -> exactly one succeeds, the other is a 409', async () => {
      const a = await seedWorkspace('rev-race')
      const { po, lines } = await seedPo(a.workspace.id)
      const body = { lines: lines.map((l) => ({ id: l.id })) }

      const results = await Promise.allSettled([
        service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, body),
        service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, body),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason).toBeInstanceOf(ConflictException)
      expect(compare.enqueueForDocument).toHaveBeenCalledTimes(1)
    })

    it('edge: a second edit path keeps the first extracted_values (the AI original), never the edited value', async () => {
      const a = await seedWorkspace('rev-extracted')
      const { po, lines } = await seedPo(a.workspace.id)
      // Simulate a line that already carries the AI original from an earlier edit.
      await db
        .update(poLineItems)
        .set({ extractedValues: { sku: 'A1', quantity: '10', unitPrice: '5', lineTotal: '50' }, quantity: '11', editedAt: OLD })
        .where(eq(poLineItems.id, lines[0].id))

      await service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
        lines: [
          { id: lines[0].id, sku: 'A1', quantity: '12', unitPrice: '5', lineTotal: '60' },
          { id: lines[1].id, sku: 'B2', quantity: '3', unitPrice: '9.99', lineTotal: '29.97' },
          { id: lines[2].id, sku: 'C3', quantity: '1', unitPrice: '100', lineTotal: '100' },
        ],
      })

      const [first] = await poLines(po.id)
      expect(first.quantity).toBe('12')
      expect(first.extractedValues).toMatchObject({ quantity: '10', lineTotal: '50' })
    })

    it('edge: the first edit captures the AI values in extracted_values', async () => {
      const a = await seedWorkspace('rev-capture')
      const { po, lines } = await seedPo(a.workspace.id)

      await service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
        lines: [
          { id: lines[0].id, sku: 'A1', quantity: '12', unitPrice: '5', lineTotal: '60' },
          { id: lines[1].id, sku: 'B2', quantity: '3', unitPrice: '9.99', lineTotal: '29.97' },
          { id: lines[2].id, sku: 'C3', quantity: '1', unitPrice: '100', lineTotal: '100' },
        ],
      })

      const stored = await poLines(po.id)
      expect(stored[0].extractedValues).toMatchObject({ sku: 'A1', quantity: '10', unitPrice: '5', lineTotal: '50' })
    })

    it('edge: lines sent back unchanged are not marked edited', async () => {
      const a = await seedWorkspace('rev-unchanged')
      const { po, lines } = await seedPo(a.workspace.id)

      await service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
        lines: [
          { id: lines[0].id, sku: 'A1', quantity: '12', unitPrice: '5', lineTotal: '60' },
          { id: lines[1].id, sku: 'B2', quantity: '3', unitPrice: '9.99', lineTotal: '29.97' },
          { id: lines[2].id, sku: 'C3', quantity: '1', unitPrice: '100', lineTotal: '100' },
        ],
      })

      const stored = await poLines(po.id)
      expect(stored[0].editedAt).not.toBeNull()
      expect(stored[1].editedAt).toBeNull()
      expect(stored[1].extractedValues).toBeNull()
      expect(stored[2].editedAt).toBeNull()
    })

    it('edge: a left-out line is deleted, a new line is manual, and lineNumbers run 1..n', async () => {
      const a = await seedWorkspace('rev-shape')
      const { po, lines } = await seedPo(a.workspace.id)

      const result = await service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
        lines: [
          { id: lines[2].id, sku: 'C3', quantity: '1', unitPrice: '100', lineTotal: '100' },
          { sku: 'NEW', description: 'Added by hand', quantity: '4', unitPrice: '2', lineTotal: '8' },
          { id: lines[0].id, sku: 'A1', quantity: '10', unitPrice: '5', lineTotal: '50' },
        ],
      })

      const stored = await poLines(po.id)
      expect(stored.map((l) => [l.lineNumber, l.sku])).toEqual([
        [1, 'C3'],
        [2, 'NEW'],
        [3, 'A1'],
      ])
      expect(stored.find((l) => l.id === lines[1].id)).toBeUndefined()
      const added = stored.find((l) => l.sku === 'NEW')
      expect(added).toMatchObject({ sourceKind: 'manual', workspaceId: a.workspace.id, purchaseOrderId: po.id, description: 'Added by hand', quantity: '4' })
      expect(result.rowCount).toBe(3)
    })

    it('edge: a body of only new lines replaces every AI line', async () => {
      const a = await seedWorkspace('rev-allnew')
      const { po } = await seedPo(a.workspace.id)

      const result = await service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
        lines: [{ sku: 'ONLY', quantity: '1', unitPrice: '1', lineTotal: '1' }],
      })

      const stored = await poLines(po.id)
      expect(stored.map((l) => l.sku)).toEqual(['ONLY'])
      expect(stored[0].sourceKind).toBe('manual')
      expect(result.rowCount).toBe(1)
    })

    it('regression: updatedAt is bumped and the compare enqueue runs exactly once after commit', async () => {
      const a = await seedWorkspace('rev-regress')
      const { po, lines } = await seedPo(a.workspace.id)

      await service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
        lines: lines.map((l) => ({ id: l.id, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
      })

      const [after] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(after.updatedAt.getTime()).toBeGreaterThan(OLD.getTime())
      expect(compare.enqueueForDocument).toHaveBeenCalledTimes(1)
      expect(compare.enqueueForDocument).toHaveBeenCalledWith('purchase_order', po.id)
    })

    it('regression: a failing compare enqueue does not fail or undo the review', async () => {
      compare.enqueueForDocument.mockRejectedValue(new Error('redis down'))
      const a = await seedWorkspace('rev-enqueue-fail')
      const { po, lines } = await seedPo(a.workspace.id)

      const result = await service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
        lines: lines.map((l) => ({ id: l.id, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
      })

      expect(result.rowCount).toBe(3)
      const [after] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(after.reviewedAt).not.toBeNull()
    })

    it('happy: editing a quantity sets edited_at/edited_by, reviewed_at/by, and rowCount', async () => {
      const a = await seedWorkspace('rev-happy')
      const { po, lines } = await seedPo(a.workspace.id)

      const result = await service.review(a.workspace.id, 'purchase_order', po.id, a.user.id, {
        lines: [
          { id: lines[0].id, sku: 'A1', quantity: '12', unitPrice: '5', lineTotal: '60' },
          { id: lines[1].id, sku: 'B2', quantity: '3', unitPrice: '9.99', lineTotal: '29.97' },
          { id: lines[2].id, sku: 'C3', quantity: '1', unitPrice: '100', lineTotal: '100' },
        ],
      })

      expect(result.id).toBe(po.id)
      expect(result.rowCount).toBe(3)
      expect(new Date(result.reviewedAt).getTime()).toBeGreaterThan(OLD.getTime())
      const [header] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id))
      expect(header.reviewedBy).toBe(a.user.id)
      expect(header.reviewedAt).not.toBeNull()
      expect(header.rowCount).toBe(3)
      const [edited] = await poLines(po.id)
      expect(edited).toMatchObject({ quantity: '12', lineTotal: '60', editedBy: a.user.id })
      expect(edited.editedAt).not.toBeNull()
    })

    it('happy: an invoice review writes invoice lines and enqueues for the invoice kind', async () => {
      const a = await seedWorkspace('rev-invoice')
      const [invoice] = await db
        .insert(invoices)
        .values({ workspaceId: a.workspace.id, name: 'inv.pdf', status: 'done', sourceKind: 'image', reviewRequired: true, pageCount: 1 })
        .returning()
      const [line] = await db
        .insert(invoiceLineItems)
        .values({ workspaceId: a.workspace.id, invoiceId: invoice.id, lineNumber: 1, sku: 'A1', quantity: '1', unitPrice: '2', lineTotal: '2', sourceKind: 'image-extraction' })
        .returning()

      await service.review(a.workspace.id, 'invoice', invoice.id, a.user.id, {
        lines: [{ id: line.id, sku: 'A1', quantity: '2', unitPrice: '2', lineTotal: '4' }],
      })

      const [stored] = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id))
      expect(stored).toMatchObject({ quantity: '2', lineTotal: '4', editedBy: a.user.id })
      expect(compare.enqueueForDocument).toHaveBeenCalledWith('invoice', invoice.id)
    })

    it('happy: a goods-receipt review writes the three quantities and manual lines', async () => {
      const a = await seedWorkspace('rev-grn')
      const { po } = await seedPo(a.workspace.id)
      const [grn] = await db
        .insert(goodsReceipts)
        .values({ workspaceId: a.workspace.id, purchaseOrderId: po.id, name: 'grn.pdf', status: 'done', sourceKind: 'image', reviewRequired: true, pageCount: 1 })
        .returning()
      const [line] = await db
        .insert(goodsReceiptLineItems)
        .values({ workspaceId: a.workspace.id, goodsReceiptId: grn.id, lineNumber: 1, sku: 'A1', quantityReceived: '10', quantityAccepted: '10', sourceKind: 'image-extraction' })
        .returning()

      await service.review(a.workspace.id, 'goods_receipt', grn.id, a.user.id, {
        lines: [
          { id: line.id, sku: 'A1', quantityReceived: '10', quantityAccepted: '8', quantityRejected: '2' },
          { sku: 'ADDED', quantityReceived: '1', quantityAccepted: '1', quantityRejected: '0' },
        ],
      })

      const stored = await db
        .select()
        .from(goodsReceiptLineItems)
        .where(and(eq(goodsReceiptLineItems.goodsReceiptId, grn.id)))
        .orderBy(asc(goodsReceiptLineItems.lineNumber))
      expect(stored[0]).toMatchObject({ quantityAccepted: '8', quantityRejected: '2', editedBy: a.user.id })
      expect(stored[1]).toMatchObject({ sku: 'ADDED', sourceKind: 'manual', lineNumber: 2 })
      expect(compare.enqueueForDocument).toHaveBeenCalledWith('goods_receipt', grn.id)
    })
  })
})
