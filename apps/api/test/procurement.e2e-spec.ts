import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { and, eq, like } from 'drizzle-orm'
import request from 'supertest'
import sharp from 'sharp'
import * as XLSX from 'xlsx'
import {
  comparisonRuns,
  db,
  discrepancyFlags,
  goodsReceiptLineItems,
  goodsReceipts,
  invoiceLineItems,
  invoices,
  otps,
  pool,
  poLineItems,
  purchaseOrders,
  refreshTokens,
  usageEvents,
  users,
  workspaceEvents,
  workspaceMembers,
  workspaceSubscriptions,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'
import { StorageService } from '../src/storage/storage.service'
import { StorageObjectNotFoundError } from '../src/storage/storage.errors'
import { ProcurementExtractionService } from '../src/procurement/procurement-extraction.service'
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter'

jest.setTimeout(30_000)

async function cleanupUsers(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
    await db.delete(otps).where(eq(otps.userId, user.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(discrepancyFlags).where(eq(discrepancyFlags.workspaceId, membership.workspaceId))
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

async function registerAndVerify(app: INestApplication, email: string, password: string) {
  await request(app.getHttpServer()).post('/auth/register').send({ email, password }).expect(201)

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const [otp] = await db.select().from(otps).where(eq(otps.userId, user.id)).limit(1)

  const verifyRes = await request(app.getHttpServer())
    .post('/auth/verify-otp')
    .send({ email, code: otp.code })
    .expect(201)

  return { user, accessToken: verifyRes.body.accessToken as string }
}

// Deliberately exercises the real Bull queue + real processor in-process
// (rather than mocking ProcurementParseService) — the queue lifecycle is a
// Deep-risk area, so this is worth proving end-to-end even in e2e.
async function waitForPoDone(id: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
    if (row?.status === 'done') return
    if (row?.status === 'failed') throw new Error(`Purchase order ${id} failed to parse: ${row.lastError}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Purchase order ${id} did not reach 'done' within ${timeoutMs}ms`)
}

async function waitForGoodsReceiptDone(id: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).limit(1)
    if (row?.status === 'done') return
    if (row?.status === 'failed') throw new Error(`Goods receipt ${id} failed to parse: ${row.lastError}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Goods receipt ${id} did not reach 'done' within ${timeoutMs}ms`)
}

// Longer than the others on purpose: the compare job is enqueued with a
// coalescing delay, so this waits out that window plus the run itself.
async function waitForAutomaticRun(purchaseOrderId: string, invoiceId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(comparisonRuns)
      .where(and(eq(comparisonRuns.purchaseOrderId, purchaseOrderId), eq(comparisonRuns.invoiceId, invoiceId)))
    if (row?.status === 'succeeded') return row
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`No automatic comparison run appeared for ${purchaseOrderId}/${invoiceId}`)
}

async function waitForInvoiceDone(id: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    if (row?.status === 'done') return
    if (row?.status === 'failed') throw new Error(`Invoice ${id} failed to parse: ${row.lastError}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Invoice ${id} did not reach 'done' within ${timeoutMs}ms`)
}

/**
 * Builds a verified user + owned workspace directly, and mints the access token
 * the way AuthService does (`{ sub, email }`, auth.service.ts:211).
 *
 * Deliberately NOT registerAndVerify: `/auth/register` is capped at 5 per 10
 * minutes (auth.controller.ts:32) and this file already spends that budget on
 * the tests that genuinely exercise the login flow. Raising the cap to fit more
 * fixtures would weaken a real production control to make tests pass, so the
 * fixtures that are about *upload* skip the auth path instead. Registration
 * itself stays covered by auth.e2e-spec.ts and auth-rate-limit.e2e-spec.ts.
 */
async function seedOwnerWithWorkspace(app: INestApplication, email: string, workspaceName: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name: workspaceName, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

  const accessToken = app.get(JwtService).sign({ sub: user.id, email })
  return { user, workspaceId: workspace.id, accessToken }
}

/**
 * A real `member` of someone else's workspace.
 *
 * Until S7 this file only ever tested owner-vs-**outsider**, so every 403 came
 * from `WorkspaceMemberGuard` and nothing here proved `RolesGuard` does
 * anything at all — a member able to dismiss and decide would have passed the
 * whole suite. Idiom copied from tickets.e2e-spec.ts:141-145.
 */
async function seedMemberOfWorkspace(app: INestApplication, workspaceId: string, email: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: 'member' })
  const accessToken = app.get(JwtService).sign({ sub: user.id, email })
  return { user, accessToken }
}

// S3b: POLICY v1 #3 requires the PO's vendor to be one of the workspace's own
// `vendors` rows, so every PO upload in this file now needs a real vendor first.
async function createVendor(
  app: INestApplication,
  workspaceId: string,
  token: string,
  name = 'Nordwerk Interiors',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/vendors`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name })
    .expect(201)
  return res.body.id as string
}

describe('Procurement flow (e2e)', () => {
  let app: INestApplication
  let storage: { save: jest.Mock; getBuffer: jest.Mock; getToTempFile: jest.Mock; delete: jest.Mock }
  const prefix = `e2e-procurement-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    const stored = new Map<string, Buffer>()
    storage = {
      save: jest.fn(async (key: string, body: Buffer) => {
        stored.set(key, Buffer.from(body))
        return key
      }),
      getBuffer: jest.fn(async (key: string) => {
        const body = stored.get(key)
        // What real storage throws now, not a generic Error.
        if (!body) throw new StorageObjectNotFoundError(key)
        return Buffer.from(body)
      }),
      getToTempFile: jest.fn(async (key: string) => {
        const body = stored.get(key)
        // What real storage throws now, not a generic Error.
        if (!body) throw new StorageObjectNotFoundError(key)
        const dir = await mkdtemp(join(tmpdir(), 'procurement-e2e-'))
        const path = join(dir, key.split('/').pop() ?? 'file')
        await writeFile(path, body)
        return path
      }),
      delete: jest.fn(async (key: string) => {
        stored.delete(key)
      }),
    }

    // Fake extraction keyed off uploaded content (not the real @repo/ai chain) —
    // proves the PDF branch end-to-end (upload -> queue -> processor -> seam ->
    // line items -> compare) with zero OpenAI calls.
    const extraction = {
      extract: jest.fn(async (path: string) => {
        const content = await readFile(path, 'utf-8')
        if (content.includes('PDF-PO-MARKER')) {
          return {
            items: [
              { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', confidence: 0.9 },
              { sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '9.99', lineTotal: '29.97', confidence: 0.9 },
              { sku: 'C3', description: 'Only On PO', quantity: '1', unitPrice: '1.00', lineTotal: '1.00', confidence: 0.9 },
            ],
          }
        }
        // Numeric SKUs on the PO side, no SKUs at all on the invoice side —
        // the shape that used to 500 (read_csv_auto infers BIGINT vs VARCHAR
        // per file, breaking COALESCE(po_sku, inv_sku) in COMPARISON_SQL).
        if (content.includes('PDF-NUMERIC-PO-MARKER')) {
          return {
            items: [
              { sku: '123456', description: 'Product A', quantity: '27', unitPrice: '220.00', lineTotal: '5940.00', confidence: 0.95 },
              { sku: '789012', description: 'Product B', quantity: '3', unitPrice: '55.00', lineTotal: '165.00', confidence: 0.95 },
            ],
          }
        }
        if (content.includes('PDF-NOSKU-INVOICE-MARKER')) {
          return {
            items: [
              { sku: null, description: 'Laundry service (towels)', quantity: '71', unitPrice: '0.50', lineTotal: '35.50', confidence: 0.9 },
            ],
          }
        }
        return {
          items: [
            { sku: 'A1', description: 'Widget', quantity: '8', unitPrice: '5.00', lineTotal: '40.00', confidence: 0.9 },
            { sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '12.00', lineTotal: '36.00', confidence: 0.9 },
            { sku: 'D4', description: 'Only On Invoice', quantity: '1', unitPrice: '1.00', lineTotal: '1.00', confidence: 0.9 },
          ],
        }
      }),
    }

    // Photo intake: the vision seam, keyed by document kind (the pages are
    // generated JPEGs, so their bytes carry no marker). Zero OpenAI calls.
    const extractFromImages = jest.fn(async (_pages: unknown[], kind: string) => {
      if (kind === 'purchase_order') {
        return {
          detectedKind: 'purchase_order',
          items: [
            { sku: 'A1', description: 'Widget', quantity: '10', unitPrice: '5.00', lineTotal: '50.00', uom: null, confidence: 0.9 },
            { sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '9.99', lineTotal: '29.97', uom: null, confidence: 0.9 },
          ],
        }
      }
      if (kind === 'goods_receipt') {
        return {
          detectedKind: 'goods_receipt',
          items: [
            { sku: 'A1', description: 'Widget', quantityReceived: '10', quantityAccepted: '10', quantityRejected: '0', uom: null, confidence: 0.8 },
          ],
        }
      }
      return {
        detectedKind: 'invoice',
        items: [
          { sku: 'A1', description: 'Widget', quantity: '8', unitPrice: '5.00', lineTotal: '40.00', uom: null, confidence: 0.92 },
          { sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '12.00', lineTotal: '36.00', uom: null, confidence: 0.55 },
          { sku: 'D4', description: 'Only On Invoice', quantity: '1', unitPrice: '1.00', lineTotal: '1.00', uom: null, confidence: 0.8 },
        ],
      }
    })

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(ProcurementExtractionService)
      .useValue({ ...extraction, extractFromImages })
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    // Mirror main.ts so e2e sees the same error shape production does.
    app.useGlobalFilters(new AllExceptionsFilter())
    await app.init()
  })

  afterAll(async () => {
    await cleanupUsers(prefix)
    await app.close()
    await pool.end()
  })

  it('uploads PO + invoice, parses, compares, lists, and dismisses a flag — isolated per workspace', async () => {
    const owner = await registerAndVerify(app, `${prefix}owner@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)

    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body.items[0].id as string

    const outsiderMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(200)
    const outsiderWorkspaceId = outsiderMine.body.items[0].id as string

    const poCsv = [
      'sku,description,qty,unit price',
      'A1,Widget,10,5.00',
      'B2,Gadget,3,9.99',
      'C3,Only On PO,1,1.00',
    ].join('\n')
    const invoiceCsv = [
      'sku,description,qty,unit price',
      'A1,Widget,8,5.00',
      'B2,Gadget,3,12.00',
      'D4,Only On Invoice,1,1.00',
    ].join('\n')

    const vendorId = await createVendor(app, workspaceId, owner.accessToken)

    // .field() BEFORE .attach(): multer only populates req.body from parts it
    // sees before the file, so a header sent after the file never reaches the
    // DTO and the upload fails validation for a reason that looks unrelated.
    const poUpload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('vendorId', vendorId)
      .field('poNumber', 'PO-2026-1180')
      .field('currency', 'USD')
      .attach('file', Buffer.from(poCsv), 'po.csv')
      .expect(201)

    const invoiceUpload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/invoices`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('purchaseOrderId', poUpload.body.id)
      .field('invoiceNumber', 'INV-44120')
      .field('currency', 'USD')
      .attach('file', Buffer.from(invoiceCsv), 'invoice.csv')
      .expect(201)

    expect(poUpload.body.status).toBe('pending')
    expect(invoiceUpload.body.status).toBe('pending')

    await waitForPoDone(poUpload.body.id)
    await waitForInvoiceDone(invoiceUpload.body.id)

    const compareRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/discrepancies/compare`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
      .expect(201)

    expect(compareRes.body.counts).toEqual({
      quantity_mismatch: 1,
      price_mismatch: 1,
      missing_on_invoice: 1,
      missing_on_po: 1,
      short_receipt: 0,
      invoice_exceeds_received: 0,
      uom_mismatch: 0,
      currency_mismatch: 0,
      contract_price_variance: 0,
      contract_price_unavailable: 0,
    })

    // S9. Every flag with a line behind it states that line's unit price,
    // whichever exception the engine labelled it with.
    const quantityFlag = compareRes.body.flags.find((f: { flagType: string }) => f.flagType === 'quantity_mismatch')
    expect(Number(quantityFlag.poUnitPrice)).toBeGreaterThan(0)
    expect(Number(quantityFlag.invoiceUnitPrice)).toBeGreaterThan(0)

    const listRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    expect(listRes.body.items).toHaveLength(4)
    expect(listRes.body.total).toBe(4)
    expect(listRes.body.totalPages).toBe(1)
    // The stat cards read these, so they carry every type whether or not this
    // comparison produced one.
    expect(listRes.body.counts).toEqual({
      quantity_mismatch: 1,
      price_mismatch: 1,
      missing_on_invoice: 1,
      missing_on_po: 1,
      short_receipt: 0,
      invoice_exceeds_received: 0,
      uom_mismatch: 0,
      currency_mismatch: 0,
      contract_price_variance: 0,
      contract_price_unavailable: 0,
    })
    const flagId = listRes.body.items[0].id as string

    const dismissRes = await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}/procurement/discrepancies/${flagId}/dismiss`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    expect(dismissRes.body.status).toBe('dismissed')

    const openOnlyRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ status: 'open' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(openOnlyRes.body.items).toHaveLength(3)
    // Counts follow the same filter the list did.
    expect(openOnlyRes.body.total).toBe(3)

    // One page at a time, and the page never claims to be the whole set.
    const firstPage = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ pageSize: 1 })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(firstPage.body.items).toHaveLength(1)
    expect(firstPage.body.pageSize).toBe(1)
    expect(firstPage.body.total).toBe(4)
    expect(firstPage.body.totalPages).toBe(4)

    // Cross-workspace isolation: outsider is not a member of workspaceId at all.
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    // Outsider IS a member of their own workspace, but the PO/invoice ids belong
    // to the owner's workspace — must 404, not leak cross-workspace data.
    await request(app.getHttpServer())
      .post(`/workspaces/${outsiderWorkspaceId}/procurement/discrepancies/compare`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
      .expect(404)

    // Same for dismiss: the outsider owns their own workspace (passes RolesGuard),
    // but the flag belongs to the owner's workspace — 404, and the flag stays open.
    const foreignFlagId = openOnlyRes.body.items[0].id as string
    await request(app.getHttpServer())
      .patch(`/workspaces/${outsiderWorkspaceId}/procurement/discrepancies/${foreignFlagId}/dismiss`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(404)
    const afterForeignDismiss = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ status: 'open' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(afterForeignDismiss.body.items.map((flag: { id: string }) => flag.id)).toContain(foreignFlagId)

    // A malformed flag id is a client error, not a uuid-cast failure inside Postgres.
    await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}/procurement/discrepancies/not-a-uuid/dismiss`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400)

    // S1: a second comparison appends a new run. The list must not grow, the
    // new flags must belong to the new run, and the dismissal recorded against
    // run 1 must still be readable through that run rather than deleted.
    const secondCompare = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/discrepancies/compare`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
      .expect(201)

    expect(secondCompare.body.runId).toEqual(expect.any(String))
    expect(secondCompare.body.runId).not.toBe(compareRes.body.runId)

    const afterRerun = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(afterRerun.body.items).toHaveLength(4)
    expect(
      afterRerun.body.items.every(
        (flag: { comparisonRunId: string }) => flag.comparisonRunId === secondCompare.body.runId,
      ),
    ).toBe(true)

    const history = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ runId: compareRes.body.runId })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(history.body.items).toHaveLength(4)
    expect(history.body.items.filter((flag: { status: string }) => flag.status === 'dismissed')).toHaveLength(1)

    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ runId: 'not-a-uuid' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400)

    // S2: decisions are append-only, role-gated on write, readable by members.
    const currentFlagId = afterRerun.body.items[0].id as string

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/discrepancies/${currentFlagId}/decisions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ outcome: 'approved_exception', note: 'Agreed with the vendor.' })
      .expect(201)

    // A note is not optional on the explicit endpoint.
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/discrepancies/${currentFlagId}/decisions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ outcome: 'resolved', note: '' })
      .expect(400)

    const decisions = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies/${currentFlagId}/decisions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(decisions.body).toHaveLength(1)
    expect(decisions.body[0].outcome).toBe('approved_exception')
    expect(decisions.body[0].actorRole).toBe('owner')

    // An outsider can neither write nor read another workspace's history.
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/discrepancies/${currentFlagId}/decisions`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ outcome: 'resolved', note: 'Not mine.' })
      .expect(403)

    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies/${currentFlagId}/decisions`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    // S4: the original bytes come back unchanged, named after the upload, and
    // always as an attachment so the browser cannot render them inline.
    const download = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/purchase-orders/${poUpload.body.id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    expect(download.headers['content-type']).toContain('application/octet-stream')
    expect(download.headers['content-disposition']).toBe('attachment; filename="po.csv"')
    expect(download.headers['x-content-type-options']).toBe('nosniff')
    expect(download.body.toString()).toBe(poCsv)

    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/invoices/${invoiceUpload.body.id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    // An outsider is not a member of this workspace at all.
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/purchase-orders/${poUpload.body.id}/download`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    // A malformed id is a client error, not a uuid-cast failure in Postgres.
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/purchase-orders/not-a-uuid/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400)

    // The row says there is a file; storage says there is not. A 404 the UI
    // can explain - never a 500 that reads as an outage - and the storage key
    // stays inside the API.
    storage.getBuffer.mockImplementationOnce(async (key: string) => {
      throw new StorageObjectNotFoundError(key)
    })
    const gone = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/purchase-orders/${poUpload.body.id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404)
    expect(gone.body.message).toBe('Purchase order file is missing')
    expect(JSON.stringify(gone.body)).not.toContain('/procurement/')
  })

  it('uploads PO + invoice as PDF, parses via the extraction seam, and compares identically to CSV', async () => {
    const owner = await registerAndVerify(app, `${prefix}pdf-owner@example.com`, password)
    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body.items[0].id as string

    const vendorId = await createVendor(app, workspaceId, owner.accessToken)

    const poUpload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('vendorId', vendorId)
      .field('poNumber', 'PO-2026-1181')
      .field('currency', 'USD')
      .attach('file', Buffer.from('%PDF-1.4 PDF-PO-MARKER'), 'po.pdf')
      .expect(201)

    const invoiceUpload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/invoices`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('purchaseOrderId', poUpload.body.id)
      .field('invoiceNumber', 'INV-44121')
      .field('currency', 'USD')
      .attach('file', Buffer.from('%PDF-1.4 PDF-INVOICE-MARKER'), 'invoice.pdf')
      .expect(201)

    await waitForPoDone(poUpload.body.id)
    await waitForInvoiceDone(invoiceUpload.body.id)

    const [poRow] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poUpload.body.id))
    expect(poRow.sourceKind).toBe('pdf')
    const [poLineItem] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, poUpload.body.id))
    expect(poLineItem.sourceKind).toBe('pdf-extraction')

    const compareRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/discrepancies/compare`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
      .expect(201)

    expect(compareRes.body.counts).toEqual({
      quantity_mismatch: 1,
      price_mismatch: 1,
      missing_on_invoice: 1,
      missing_on_po: 1,
      short_receipt: 0,
      invoice_exceeds_received: 0,
      uom_mismatch: 0,
      currency_mismatch: 0,
      contract_price_variance: 0,
      contract_price_unavailable: 0,
    })
  })

  // Regression for the production 500: a Cin7-style PO with all-numeric SKUs
  // compared against a vendor invoice with no SKUs. read_csv_auto typed the two
  // sku columns differently (BIGINT vs VARCHAR) and COMPARISON_SQL failed to bind.
  it('compares a numeric-SKU PO against a no-SKU invoice over HTTP without a 500', async () => {
    const owner = await registerAndVerify(app, `${prefix}numeric-sku-owner@example.com`, password)
    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body.items[0].id as string

    const vendorId = await createVendor(app, workspaceId, owner.accessToken)

    const poUpload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('vendorId', vendorId)
      .field('poNumber', 'PO-2026-1182')
      .field('currency', 'USD')
      .attach('file', Buffer.from('%PDF-1.4 PDF-NUMERIC-PO-MARKER'), 'cin7-po.pdf')
      .expect(201)

    const invoiceUpload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/invoices`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('purchaseOrderId', poUpload.body.id)
      .field('invoiceNumber', 'INV-44122')
      .field('currency', 'USD')
      .attach('file', Buffer.from('%PDF-1.4 PDF-NOSKU-INVOICE-MARKER'), 'vendor-invoice.pdf')
      .expect(201)

    await waitForPoDone(poUpload.body.id)
    await waitForInvoiceDone(invoiceUpload.body.id)

    const compareRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/discrepancies/compare`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
      .expect(201)

    expect(compareRes.body.counts).toEqual({
      quantity_mismatch: 0,
      price_mismatch: 0,
      missing_on_invoice: 2,
      missing_on_po: 1,
      short_receipt: 0,
      invoice_exceeds_received: 0,
      uom_mismatch: 0,
      currency_mismatch: 0,
      contract_price_variance: 0,
      contract_price_unavailable: 0,
    })
  })

  it('rejects non-CSV/XLSX uploads', async () => {
    const owner = await registerAndVerify(app, `${prefix}role-owner@example.com`, password)
    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body.items[0].id as string

    const vendorId = await createVendor(app, workspaceId, owner.accessToken)

    // Headers are valid on purpose: without them this would still return 400,
    // but for a DTO reason, and would stop proving anything about fileFilter.
    const rejected = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('vendorId', vendorId)
      .field('poNumber', 'PO-2026-1183')
      .field('currency', 'USD')
      .attach('file', Buffer.from('not a spreadsheet'), 'malware.exe')
      .expect(400)

    expect(rejected.body.message).toBe('Only CSV, XLSX, or PDF files are supported')

    // Over the size limit: a 413 that names the limit - through the real
    // FileInterceptor, which is what a unit test of the filter cannot reach.
    const tooBig = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('vendorId', vendorId)
      .field('poNumber', 'PO-2026-1184')
      .field('currency', 'USD')
      .attach('file', Buffer.alloc(26 * 1024 * 1024, 'a'), 'too-big.csv')
      .expect(413)
    expect(tooBig.body.message).toMatch(/^File exceeds \d+MB upload limit$/)
  })

  // B3, end to end on the real queue: a source file that is gone from storage
  // fails the document on the FIRST attempt with a reason the page can show.
  // The failure is keyed by this upload's own file name, never a once-queue: a
  // real Bull processor shares this stub, and a leftover job could otherwise
  // spend the queued failure. One read of the key by the time the row is
  // `failed` is the proof that no retry happened - a retried job reads it
  // three times before it fails.
  it('fails a purchase order whose stored file is gone, once, with a reason', async () => {
    const owner = await seedOwnerWithWorkspace(app, `${prefix}gone-owner@example.com`, 'Procurement Gone')
    const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
    const realGetToTempFile = storage.getToTempFile.getMockImplementation()!
    storage.getToTempFile.mockImplementation(async (key: string) => {
      if (key.endsWith('-gone.csv')) throw new StorageObjectNotFoundError(key)
      return realGetToTempFile(key)
    })

    const upload = await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('vendorId', vendorId)
      .field('poNumber', 'PO-GONE-1')
      .field('currency', 'USD')
      .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,10,5.00'), 'gone.csv')
      .expect(201)

    let row: typeof purchaseOrders.$inferSelect | undefined
    try {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, upload.body.id)).limit(1)
        if (row?.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } finally {
      storage.getToTempFile.mockImplementation(realGetToTempFile)
    }

    expect(row?.status).toBe('failed')
    expect(row?.lastError).toBe('The stored file is missing. Upload it again.')
    expect(storage.getToTempFile.mock.calls.filter(([key]) => key === row?.storageKey)).toHaveLength(1)
  })

  // S5. Receiving ingest end to end: real Bull queue, real processor, no mocks
  // on the parse path — same posture as the PO/invoice flows above.
  describe('goods receipts (S5)', () => {

    const grnCsv = ['sku,description,qty received,qty accepted,qty rejected,uom', 'A1,Widget,10,8,2,box'].join('\n')

    async function seedOwnerPo(email: string, workspaceName: string) {
      const owner = await seedOwnerWithWorkspace(app, email, workspaceName)
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const po = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-GRN-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,10,5.00'), 'po.csv')
        .expect(201)
      return { owner, purchaseOrderId: po.body.id as string }
    }

    it('uploads, parses and lists a goods receipt linked to its purchase order', async () => {
      const { owner, purchaseOrderId } = await seedOwnerPo(`${prefix}s5-grn@example.com`, 'S5 GRN')

      const upload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', purchaseOrderId)
        .field('grnNumber', 'GRN-9001')
        .attach('file', Buffer.from(grnCsv), 'grn.csv')
        .expect(201)

      expect(upload.body.status).toBe('pending')
      await waitForGoodsReceiptDone(upload.body.id)

      const [line] = await db
        .select()
        .from(goodsReceiptLineItems)
        .where(eq(goodsReceiptLineItems.goodsReceiptId, upload.body.id))
      expect(line.quantityReceived).toBe('10')
      expect(line.quantityAccepted).toBe('8')
      expect(line.quantityRejected).toBe('2')

      const listed = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)

      const row = listed.body.find((item: { id: string }) => item.id === upload.body.id)
      expect(row.grnNumber).toBe('GRN-9001')
      expect(row.purchaseOrderId).toBe(purchaseOrderId)
      expect(row.status).toBe('done')
    })

    it('refuses a purchase order belonging to another workspace', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s5-grn-mine@example.com`, 'S5 GRN Mine')
      const { purchaseOrderId: theirPo } = await seedOwnerPo(`${prefix}s5-grn-other@example.com`, 'S5 GRN Other')

      await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', theirPo)
        .field('grnNumber', 'GRN-1')
        .attach('file', Buffer.from(grnCsv), 'grn.csv')
        .expect(404)
    })

    // PDF is deferred: the extraction chain cannot express received vs accepted,
    // so a PDF receipt would silently lose the acceptance data.
    it('refuses a PDF goods receipt with an explanation', async () => {
      const { owner, purchaseOrderId } = await seedOwnerPo(`${prefix}s5-grn-pdf@example.com`, 'S5 GRN PDF')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', purchaseOrderId)
        .field('grnNumber', 'GRN-PDF')
        .attach('file', Buffer.from('%PDF-1.4 PDF-PO-MARKER'), 'grn.pdf')
        .expect(400)

      expect(res.body.message).toContain('CSV or XLSX')
    })

    it('rejects an upload with no header fields', async () => {
      const { owner } = await seedOwnerPo(`${prefix}s5-grn-nohdr@example.com`, 'S5 GRN NoHdr')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', Buffer.from(grnCsv), 'grn.csv')
        .expect(400)

      expect(res.body.message.join(' ')).toContain('purchaseOrderId')
    })
  })

  // S6. All three documents through HTTP, with the real queue and processor —
  // the unit tests prove the engine, this proves the wiring.
  describe('three-way comparison (S6)', () => {
    it('compares ordered against received against billed and labels the run three_way', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s6-e2e@example.com`, 'S6 E2E')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)

      const poUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-S6-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,10,5.00'), 'po.csv')
        .expect(201)
      await waitForPoDone(poUpload.body.id)

      // Accepted 7 of 10 ordered, and the invoice bills all 10.
      const grnUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', poUpload.body.id)
        .field('grnNumber', 'GRN-S6-1')
        .attach('file', Buffer.from('sku,qty received,qty accepted\nA1,7,7'), 'grn.csv')
        .expect(201)
      await waitForGoodsReceiptDone(grnUpload.body.id)

      const invoiceUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', poUpload.body.id)
        .field('invoiceNumber', 'INV-S6-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,10,5.00'), 'invoice.csv')
        .expect(201)
      await waitForInvoiceDone(invoiceUpload.body.id)

      const compareRes = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
        .expect(201)

      expect(compareRes.body.counts.invoice_exceeds_received).toBe(1)
      const flag = compareRes.body.flags[0]
      expect(Number(flag.poValue)).toBe(10)
      expect(Number(flag.receivedValue)).toBe(7)
      expect(Number(flag.invoiceValue)).toBe(10)

      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, compareRes.body.runId))
      expect(run.mode).toBe('three_way')
      expect(run.goodsReceiptLineCount).toBe(1)
    })

    // The currency is chosen at upload (S3b) and decided outside the engine, so
    // this is the only test that proves the value survives the whole trip:
    // multipart field → DTO → column → comparison → response.
    it('raises a currency mismatch for review when the documents are billed in different currencies', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s6-currency@example.com`, 'S6 Currency')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const lines = 'sku,description,qty,unit price\nA1,Widget,10,5.00'

      const poUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-S6-2')
        .field('currency', 'USD')
        .attach('file', Buffer.from(lines), 'po.csv')
        .expect(201)
      await waitForPoDone(poUpload.body.id)

      const invoiceUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', poUpload.body.id)
        .field('invoiceNumber', 'INV-S6-2')
        .field('currency', 'EUR')
        .attach('file', Buffer.from(lines), 'invoice.csv')
        .expect(201)
      await waitForInvoiceDone(invoiceUpload.body.id)

      const compareRes = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
        .expect(201)

      // The lines themselves agree, so the currency is the only thing to report.
      expect(compareRes.body.counts.currency_mismatch).toBe(1)
      expect(compareRes.body.flags).toHaveLength(1)
      const flag = compareRes.body.flags[0]
      expect(flag.flagType).toBe('currency_mismatch')
      expect(flag.poValue).toBe('USD')
      expect(flag.invoiceValue).toBe('EUR')
      // POLICY v1 #4/#6: no difference is computed, and no line is accused.
      expect(flag.delta).toBeNull()
      expect(flag.sku).toBeNull()
      expect(flag.poLineItemId).toBeNull()
      expect(flag.invoiceLineItemId).toBeNull()
    })
  })

  // S7. Run history, and the first test in this file that proves RolesGuard
  // does anything: every other 403 here comes from WorkspaceMemberGuard.
  describe('comparison run history (S7)', () => {
    it('lets a member read run history but not decide, and hides other workspaces', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s7-runs-owner@example.com`, 'S7 Runs Owner')
      const outsider = await seedOwnerWithWorkspace(app, `${prefix}s7-runs-outsider@example.com`, 'S7 Runs Outsider')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}s7-runs-member@example.com`)
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const lines = 'sku,description,qty,unit price\nA1,Widget,10,5.00'

      const poUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-S7-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from(lines), 'po.csv')
        .expect(201)
      await waitForPoDone(poUpload.body.id)

      const invoiceUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', poUpload.body.id)
        .field('invoiceNumber', 'INV-S7-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,8,5.00'), 'invoice.csv')
        .expect(201)
      await waitForInvoiceDone(invoiceUpload.body.id)

      const compareRes = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
        .expect(201)

      // A member can read the history.
      const runsRes = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/comparison-runs`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .expect(200)
      expect(runsRes.body.items).toHaveLength(1)
      expect(runsRes.body.items[0].id).toBe(compareRes.body.runId)
      expect(runsRes.body.items[0].initiatedByEmail).toBe(`${prefix}s7-runs-owner@example.com`)
      expect(runsRes.body.total).toBe(1)

      // …and filter it to the pair.
      const pairRes = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/comparison-runs`)
        .query({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
        .set('Authorization', `Bearer ${member.accessToken}`)
        .expect(200)
      expect(pairRes.body.items).toHaveLength(1)

      // But a member cannot decide. THIS is the RolesGuard assertion — the
      // member passes WorkspaceMemberGuard and is refused on role alone.
      const flagsRes = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/discrepancies`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .expect(200)
      const flagId = flagsRes.body.items[0].id as string

      await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/${flagId}/decisions`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ outcome: 'resolved', note: 'A member should not be able to write this.' })
        .expect(403)

      await request(app.getHttpServer())
        .patch(`/workspaces/${owner.workspaceId}/procurement/discrepancies/${flagId}/dismiss`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .expect(403)

      // An owner of a different workspace is not a member here at all, so the
      // 403 comes from WorkspaceMemberGuard. (The 404s elsewhere in this file
      // are the other shape: the caller's OWN workspace, with ids belonging to
      // someone else's — that refusal comes from the service.)
      await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/comparison-runs`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(403)

      // And their own workspace shows none of these runs.
      const outsiderRuns = await request(app.getHttpServer())
        .get(`/workspaces/${outsider.workspaceId}/procurement/comparison-runs`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(200)
      expect(outsiderRuns.body.items).toHaveLength(0)

      await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/comparison-runs`)
        .query({ purchaseOrderId: 'not-a-uuid' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(400)
    })
  })

  // S3b. The foreign key only proves a row exists; these prove the API refuses
  // an id belonging to somebody else's workspace, which the FK cannot catch.
  describe('header enrichment and linkage (S3b)', () => {
    const csv = 'sku,description,qty,unit price\nA1,Widget,1,1.00'

    it('persists the header the uploader supplied and returns it when listing', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s3b-header@example.com`, 'S3b Header')
      const workspaceId = owner.workspaceId
      const vendorId = await createVendor(app, workspaceId, owner.accessToken, 'Brightline Systems')

      const poUpload = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-2026-1184')
        .field('currency', 'USD')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(201)

      const listed = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)

      const row = listed.body.find((item: { id: string }) => item.id === poUpload.body.id)
      expect(row.poNumber).toBe('PO-2026-1184')
      expect(row.currency).toBe('USD')
      expect(row.vendorId).toBe(vendorId)
      expect(row.vendorName).toBe('Brightline Systems')
    })

    it('refuses a vendor belonging to another workspace', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s3b-vendor-mine@example.com`, 'S3b Vendor Mine')
      const stranger = await seedOwnerWithWorkspace(app, `${prefix}s3b-vendor-other@example.com`, 'S3b Vendor Other')
      const workspaceId = owner.workspaceId
      const foreignVendorId = await createVendor(app, stranger.workspaceId, stranger.accessToken, 'Cedar Supply Co')

      // 404, not 403: a 403 would confirm the id is real and turn this endpoint
      // into an oracle for enumerating another workspace's vendors.
      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', foreignVendorId)
        .field('poNumber', 'PO-2026-1185')
        .field('currency', 'USD')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(404)
    })

    it('refuses a purchase order belonging to another workspace', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s3b-po-mine@example.com`, 'S3b PO Mine')
      const stranger = await seedOwnerWithWorkspace(app, `${prefix}s3b-po-other@example.com`, 'S3b PO Other')
      const workspaceId = owner.workspaceId
      const theirWorkspaceId = stranger.workspaceId
      const theirVendorId = await createVendor(app, theirWorkspaceId, stranger.accessToken)

      const theirPo = await request(app.getHttpServer())
        .post(`/workspaces/${theirWorkspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .field('vendorId', theirVendorId)
        .field('poNumber', 'PO-THEIRS')
        .field('currency', 'USD')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(201)

      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', theirPo.body.id)
        .field('invoiceNumber', 'INV-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from(csv), 'invoice.csv')
        .expect(404)
    })

    // Pins the UploadExceptionFilter change: without it this body would be a
    // single flattened string and the form could not mark the bad field.
    it('returns per-field validation messages for a bad header', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s3b-validation@example.com`, 'S3b Validation')
      const workspaceId = owner.workspaceId
      const vendorId = await createVendor(app, workspaceId, owner.accessToken)

      // ZZZ is not a real currency. This is also the proof that ValidationPipe
      // runs at all on a multipart body — no route in this repo had a @Body()
      // DTO alongside a file before S3b, so it could not be assumed.
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-2026-1186')
        .field('currency', 'ZZZ')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(400)

      expect(Array.isArray(res.body.message)).toBe(true)
      expect(res.body.message.join(' ')).toContain('currency')
    })

    it('rejects an upload with no header fields at all', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s3b-no-header@example.com`, 'S3b No Header')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(400)

      expect(res.body.message.join(' ')).toContain('vendorId')
    })

    // isISO4217 is case-insensitive, so 'usd' is accepted — but it must not be
    // STORED that way, or S6's currency comparison sees usd != USD and invents
    // a discrepancy.
    it('normalizes a lowercase currency to upper case before storing it', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s3b-currency@example.com`, 'S3b Currency')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)

      const upload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-2026-1187')
        .field('currency', 'usd')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(201)

      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, upload.body.id))
      expect(row.currency).toBe('USD')
    })

    // S9. The order date is the uploader's, and it is optional — a contract
    // price has an effective window, and judging a backfilled order against
    // today's contract would flag a variance that never happened.
    it('keeps the order date the uploader gave, separately from when the file arrived', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s9-ordered@example.com`, 'S9 Ordered')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)

      const dated = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-S9-DATED')
        .field('currency', 'USD')
        .field('orderedAt', '2026-01-14T00:00:00.000Z')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(201)

      const listed = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)
      const mine = listed.body.find((doc: { id: string }) => doc.id === dated.body.id)
      expect(new Date(mine.orderedAt).toISOString()).toBe('2026-01-14T00:00:00.000Z')

      // Omitted is null, never a stand-in for the upload date.
      const undated = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-S9-UNDATED')
        .field('currency', 'USD')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(201)
      const [undatedRow] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, undated.body.id))
      expect(undatedRow.orderedAt).toBeNull()

      // A date that is not a date is refused by validation.
      await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-S9-BAD')
        .field('currency', 'USD')
        .field('orderedAt', 'last tuesday')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(400)
    })
  })

  // Every other test in this file runs with auto-compare OFF, which is why none
  // of their run-count assertions needed editing. This one turns it on for its
  // own duration and puts nothing else in the way.
  describe('auto-compare (S8)', () => {
    const csv = 'sku,description,qty,unit price\nA1,Widget,10,5.00'

    afterEach(() => {
      delete process.env.PROCUREMENT_AUTO_COMPARE_ENABLED
    })

    it('compares a pair on its own once both documents have parsed, with no user behind it', async () => {
      process.env.PROCUREMENT_AUTO_COMPARE_ENABLED = 'true'
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s8-auto@example.com`, 'S8 Auto')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)

      const poUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-S8-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from(csv), 'po.csv')
        .expect(201)
      await waitForPoDone(poUpload.body.id)

      const invoiceUpload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', poUpload.body.id)
        .field('invoiceNumber', 'INV-S8-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,8,5.00'), 'invoice.csv')
        .expect(201)
      await waitForInvoiceDone(invoiceUpload.body.id)

      // Nobody calls POST .../discrepancies/compare anywhere in this test.
      const run = await waitForAutomaticRun(poUpload.body.id, invoiceUpload.body.id)
      expect(run.status).toBe('succeeded')
      // The null is the point: S7's review panel renders it as `automatic`,
      // and machine-written evidence must not be attributed to whoever
      // happened to upload the file.
      expect(run.initiatedBy).toBeNull()
      expect(run.flagCount).toBe(1)

      // The reviewer's queue is already populated when they arrive.
      const listRes = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/discrepancies`)
        .query({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)
      expect(listRes.body.items).toHaveLength(1)
      expect(listRes.body.items[0].flagType).toBe('quantity_mismatch')

      // And the workspace is told, because this run found something. The
      // event points at the run, which is where the evidence lives.
      const events = await db
        .select()
        .from(workspaceEvents)
        .where(eq(workspaceEvents.workspaceId, owner.workspaceId))
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('comparison_flagged')
      expect(events[0].entityId).toBe(run.id)
      expect(events[0].title).toBe('PO-S8-1')
      expect(events[0].detail).toBe('1 discrepancy to review')
    })
  })

  // S2. GET /discrepancies cites the line behind each side of a flag.
  describe('discrepancy citations (S2)', () => {
    interface Citation {
      lineNumber: number | null
      sourceRow: number | null
      sourceSheet: string | null
      extractionConfidence: number | null
      documentId: string
    }

    async function uploadPair(
      owner: { workspaceId: string; accessToken: string },
      files: { po: [Buffer, string]; invoice: [Buffer, string] },
      numbers: { po: string; invoice: string },
    ) {
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const po = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', numbers.po)
        .field('currency', 'USD')
        .attach('file', files.po[0], files.po[1])
        .expect(201)
      const invoice = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', po.body.id)
        .field('invoiceNumber', numbers.invoice)
        .field('currency', 'USD')
        .attach('file', files.invoice[0], files.invoice[1])
        .expect(201)
      await waitForPoDone(po.body.id)
      await waitForInvoiceDone(invoice.body.id)
      await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: po.body.id, invoiceId: invoice.body.id })
        .expect(201)
      return { poId: po.body.id as string, invoiceId: invoice.body.id as string }
    }

    const listFlags = async (owner: { workspaceId: string; accessToken: string }) =>
      request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/discrepancies`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)

    const poCsv = 'sku,description,qty,unit price\nA1,Widget,10,5.00\nC3,Only On PO,1,1.00'
    const invoiceCsv = 'sku,description,qty,unit price\nA1,Widget,10,6.00\nD4,Only On Invoice,1,1.00'

    it('error: a flag in workspace B pointing at workspace A\'s line id gets null for that side and leaks nothing', async () => {
      const a = await seedOwnerWithWorkspace(app, `${prefix}cite-a@example.com`, 'Cite A')
      const b = await seedOwnerWithWorkspace(app, `${prefix}cite-b@example.com`, 'Cite B')
      const pairA = await uploadPair(a, { po: [Buffer.from(poCsv), 'po.csv'], invoice: [Buffer.from(invoiceCsv), 'invoice.csv'] }, { po: 'PO-CITE-A', invoice: 'INV-CITE-A' })
      const pairB = await uploadPair(b, { po: [Buffer.from(poCsv), 'po.csv'], invoice: [Buffer.from(invoiceCsv), 'invoice.csv'] }, { po: 'PO-CITE-B', invoice: 'INV-CITE-B' })
      const [lineOfA] = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, pairA.poId))
      // Inside the pair's succeeded run: a run-less flag is hidden by
      // currentFlagScope once the pair has any succeeded run.
      const [runB] = await db
        .select()
        .from(comparisonRuns)
        .where(and(eq(comparisonRuns.workspaceId, b.workspaceId), eq(comparisonRuns.status, 'succeeded')))
      await db.insert(discrepancyFlags).values({
        workspaceId: b.workspaceId,
        purchaseOrderId: pairB.poId,
        invoiceId: pairB.invoiceId,
        comparisonRunId: runB.id,
        poLineItemId: lineOfA.id,
        flagType: 'price_mismatch',
        reason: 'Planted cross-workspace reference.',
      })

      const res = await listFlags(b)

      const planted = res.body.items.find((flag: { reason: string }) => flag.reason === 'Planted cross-workspace reference.')
      expect(planted.poLine).toBeNull()
      const body = JSON.stringify(res.body)
      expect(body).not.toContain(pairA.poId)
      expect(body).not.toContain(pairA.invoiceId)
    })

    it('edge: a flag with no line on a side returns null for it and the request still succeeds', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}cite-missing@example.com`, 'Cite Missing')
      await uploadPair(owner, { po: [Buffer.from(poCsv), 'po.csv'], invoice: [Buffer.from(invoiceCsv), 'invoice.csv'] }, { po: 'PO-CITE-M', invoice: 'INV-CITE-M' })

      const res = await listFlags(owner)

      const onlyOnPo = res.body.items.find((flag: { flagType: string }) => flag.flagType === 'missing_on_invoice')
      const onlyOnInvoice = res.body.items.find((flag: { flagType: string }) => flag.flagType === 'missing_on_po')
      expect(onlyOnPo.invoiceLine).toBeNull()
      expect(onlyOnPo.poLine).not.toBeNull()
      expect(onlyOnInvoice.poLine).toBeNull()
      expect(onlyOnInvoice.invoiceLine).not.toBeNull()
      for (const flag of res.body.items) expect(flag.receiptLine).toBeNull()
    })

    it('regression: citations do not change total, counts or the number of items', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}cite-counts@example.com`, 'Cite Counts')
      await uploadPair(owner, { po: [Buffer.from(poCsv), 'po.csv'], invoice: [Buffer.from(invoiceCsv), 'invoice.csv'] }, { po: 'PO-CITE-C', invoice: 'INV-CITE-C' })

      const res = await listFlags(owner)

      expect(res.body.items).toHaveLength(3)
      expect(res.body.total).toBe(3)
      expect(res.body.counts).toMatchObject({ price_mismatch: 1, missing_on_invoice: 1, missing_on_po: 1 })
    })

    it('happy: a CSV flag cites the 1-based file row (header is row 1) and the owning document ids', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}cite-csv@example.com`, 'Cite Csv')
      const pair = await uploadPair(owner, { po: [Buffer.from(poCsv), 'po.csv'], invoice: [Buffer.from(invoiceCsv), 'invoice.csv'] }, { po: 'PO-CITE-1', invoice: 'INV-CITE-1' })

      const res = await listFlags(owner)

      const price = res.body.items.find((flag: { flagType: string }) => flag.flagType === 'price_mismatch')
      const poLine = price.poLine as Citation
      const invoiceLine = price.invoiceLine as Citation
      expect(typeof poLine.sourceRow).toBe('number')
      expect(poLine.sourceRow).toBe(2)
      expect(poLine).toMatchObject({ sourceSheet: null, extractionConfidence: null, documentId: pair.poId })
      expect(invoiceLine).toMatchObject({ sourceRow: 2, documentId: pair.invoiceId })
      expect(price.poLine.documentId).toBe(price.purchaseOrderId)
      expect(price.invoiceLine.documentId).toBe(price.invoiceId)
    })

    it('happy: a PDF flag cites a numeric confidence and no row or sheet', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}cite-pdf@example.com`, 'Cite Pdf')
      await uploadPair(
        owner,
        { po: [Buffer.from('%PDF-1.4 PDF-PO-MARKER'), 'po.pdf'], invoice: [Buffer.from('%PDF-1.4 PDF-INVOICE-MARKER'), 'invoice.pdf'] },
        { po: 'PO-CITE-P', invoice: 'INV-CITE-P' },
      )

      const res = await listFlags(owner)

      const price = res.body.items.find((flag: { flagType: string }) => flag.flagType === 'price_mismatch')
      expect(typeof price.poLine.extractionConfidence).toBe('number')
      expect(price.poLine.extractionConfidence).toBeCloseTo(0.9)
      expect(price.poLine).toMatchObject({ sourceRow: null, sourceSheet: null })
    })
  })

  // Launch hardening. Each answer is the one the route gives today. Guard
  // order is ThrottlerGuard (global) → JwtAuthGuard → WorkspaceMemberGuard →
  // RolesGuard, then FileInterceptor / ParseUUIDPipe / ValidationPipe, then the
  // service. No case here calls /auth/register.
  describe('launch hardening: HTTP error answers', () => {
    // Well-formed ids that name nothing: a 401 must come from the missing
    // token, never from whatever the id points at.
    const anyId = '00000000-0000-4000-8000-000000000000'

    type Method = 'get' | 'post' | 'patch'

    async function answersWithoutToken(routes: [Method, string][]) {
      const answers: { route: string; status: number; message: unknown }[] = []
      for (const [method, path] of routes) {
        const res = await request(app.getHttpServer())[method](`/workspaces/${anyId}/procurement/${path}`)
        answers.push({ route: `${method.toUpperCase()} ${path}`, status: res.status, message: res.body.message })
      }
      return answers
    }

    const unauthorized = (routes: [Method, string][]) =>
      routes.map(([method, path]) => ({ route: `${method.toUpperCase()} ${path}`, status: 401, message: 'Unauthorized' }))

    // `done` with no line items, inserted directly: every refusal below happens
    // before compare() reads a single line.
    async function seedDoneDocs(workspaceId: string) {
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId, name: 'po.csv', status: 'done', rowCount: 0 })
        .returning()
      const [invoice] = await db
        .insert(invoices)
        .values({ workspaceId, name: 'invoice.csv', status: 'done', rowCount: 0 })
        .returning()
      return { po, invoice }
    }

    it('error: every upload route answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['post', 'purchase-orders'],
        ['post', 'invoices'],
        ['post', 'goods-receipts'],
        ['post', 'purchase-orders/photos'],
        ['post', 'invoices/photos'],
        ['post', 'goods-receipts/photos'],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: every list route answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['get', 'purchase-orders'],
        ['get', 'invoices'],
        ['get', 'goods-receipts'],
        ['get', 'discrepancies'],
        ['get', 'comparison-runs'],
        ['get', `purchase-orders/${anyId}/lines`],
        ['get', `invoices/${anyId}/lines`],
        ['get', `goods-receipts/${anyId}/lines`],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: every download route answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['get', `purchase-orders/${anyId}/download`],
        ['get', `invoices/${anyId}/download`],
        ['get', `goods-receipts/${anyId}/download`],
        ['get', `purchase-orders/${anyId}/pages/1`],
        ['get', `invoices/${anyId}/pages/1`],
        ['get', `goods-receipts/${anyId}/pages/1`],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: every discrepancy action answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['post', 'discrepancies/compare'],
        ['patch', `discrepancies/${anyId}/dismiss`],
        ['post', `discrepancies/${anyId}/decisions`],
        ['get', `discrepancies/${anyId}/decisions`],
        ['post', `purchase-orders/${anyId}/review`],
        ['post', `invoices/${anyId}/review`],
        ['post', `goods-receipts/${anyId}/review`],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: a malformed id on the invoice and receipt downloads and both decision routes answers 400', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-uuid@example.com`, 'LH Uuid')
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${owner.accessToken}`

      const answers = [
        await request(app.getHttpServer()).get(`${base}/invoices/not-a-uuid/download`).set('Authorization', auth),
        await request(app.getHttpServer()).get(`${base}/goods-receipts/not-a-uuid/download`).set('Authorization', auth),
        // A valid body, so the only thing wrong is the id.
        await request(app.getHttpServer())
          .post(`${base}/discrepancies/not-a-uuid/decisions`)
          .set('Authorization', auth)
          .send({ outcome: 'resolved', note: 'Checked against the source.' }),
        await request(app.getHttpServer()).get(`${base}/discrepancies/not-a-uuid/decisions`).set('Authorization', auth),
      ].map((res) => ({ status: res.status, message: res.body.message }))

      expect(answers).toEqual([
        { status: 400, message: 'Validation failed (uuid is expected)' },
        { status: 400, message: 'Validation failed (uuid is expected)' },
        { status: 400, message: 'Validation failed (uuid is expected)' },
        { status: 400, message: 'Validation failed (uuid is expected)' },
      ])
    })

    it('error: compare answers 404 for a purchase order or invoice from another workspace and records no run', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-cross-mine@example.com`, 'LH Cross Mine')
      const stranger = await seedOwnerWithWorkspace(app, `${prefix}lh-cross-other@example.com`, 'LH Cross Other')
      const mine = await seedDoneDocs(owner.workspaceId)
      const theirs = await seedDoneDocs(stranger.workspaceId)

      const foreignPo = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: theirs.po.id, invoiceId: mine.invoice.id })
        .expect(404)
      expect(foreignPo.body.message).toBe('Purchase order not found')

      const foreignInvoice = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: mine.po.id, invoiceId: theirs.invoice.id })
        .expect(404)
      expect(foreignInvoice.body.message).toBe('Invoice not found')

      const runs = await db.select().from(comparisonRuns).where(eq(comparisonRuns.workspaceId, owner.workspaceId))
      expect(runs).toHaveLength(0)
    })

    it('error: a member is refused compare and every upload with 403 on role alone', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-role-owner@example.com`, 'LH Role Owner')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}lh-role-member@example.com`)
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const { po, invoice } = await seedDoneDocs(owner.workspaceId)
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${member.accessToken}`
      const lines = 'sku,description,qty,unit price\nA1,Widget,10,5.00'

      const answers = [
        await request(app.getHttpServer())
          .post(`${base}/discrepancies/compare`)
          .set('Authorization', auth)
          .send({ purchaseOrderId: po.id, invoiceId: invoice.id }),
        await request(app.getHttpServer())
          .post(`${base}/purchase-orders`)
          .set('Authorization', auth)
          .field('vendorId', vendorId)
          .field('poNumber', 'PO-LH-MEMBER')
          .field('currency', 'USD')
          .attach('file', Buffer.from(lines), 'po.csv'),
        await request(app.getHttpServer())
          .post(`${base}/invoices`)
          .set('Authorization', auth)
          .field('purchaseOrderId', po.id)
          .field('invoiceNumber', 'INV-LH-MEMBER')
          .field('currency', 'USD')
          .attach('file', Buffer.from(lines), 'invoice.csv'),
        await request(app.getHttpServer())
          .post(`${base}/goods-receipts`)
          .set('Authorization', auth)
          .field('purchaseOrderId', po.id)
          .field('grnNumber', 'GRN-LH-MEMBER')
          .attach('file', Buffer.from('sku,qty received,qty accepted\nA1,10,10'), 'grn.csv'),
      ].map((res) => ({ status: res.status, message: res.body.message }))

      expect(answers).toEqual([
        { status: 403, message: 'Insufficient workspace role' },
        { status: 403, message: 'Insufficient workspace role' },
        { status: 403, message: 'Insufficient workspace role' },
        { status: 403, message: 'Insufficient workspace role' },
      ])
      // Refused before the service ran: nothing was compared or stored.
      expect(await db.select().from(comparisonRuns).where(eq(comparisonRuns.workspaceId, owner.workspaceId))).toHaveLength(0)
      expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.workspaceId, owner.workspaceId))).toHaveLength(1)
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, owner.workspaceId))).toHaveLength(1)
      expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('error: an oversized invoice or goods receipt answers 413 naming the 25MB limit', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-too-big@example.com`, 'LH Too Big')
      const { po } = await seedDoneDocs(owner.workspaceId)
      const tooBig = Buffer.alloc(26 * 1024 * 1024, 'a')

      const invoiceRes = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', po.id)
        .field('invoiceNumber', 'INV-LH-BIG')
        .field('currency', 'USD')
        .attach('file', tooBig, 'too-big.csv')
        .expect(413)
      expect(invoiceRes.body).toEqual({ statusCode: 413, message: 'File exceeds 25MB upload limit' })

      const receiptRes = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', po.id)
        .field('grnNumber', 'GRN-LH-BIG')
        .attach('file', tooBig, 'too-big.csv')
        .expect(413)
      expect(receiptRes.body).toEqual({ statusCode: 413, message: 'File exceeds 25MB upload limit' })

      // Refused in the interceptor, before the service stored anything.
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, owner.workspaceId))).toHaveLength(1)
      expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('happy: a three-way match over HTTP with the delivery split across two receipts raises no flag', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-split@example.com`, 'LH Split')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${owner.accessToken}`

      const poUpload = await request(app.getHttpServer())
        .post(`${base}/purchase-orders`)
        .set('Authorization', auth)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-LH-SPLIT')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,10,5.00\nB2,Gadget,4,12.50'), 'po.csv')
        .expect(201)
      await waitForPoDone(poUpload.body.id)

      const firstReceipt = await request(app.getHttpServer())
        .post(`${base}/goods-receipts`)
        .set('Authorization', auth)
        .field('purchaseOrderId', poUpload.body.id)
        .field('grnNumber', 'GRN-LH-1')
        .attach('file', Buffer.from('sku,qty received,qty accepted\nA1,6,6\nB2,4,4'), 'grn-1.csv')
        .expect(201)
      await waitForGoodsReceiptDone(firstReceipt.body.id)

      const secondReceipt = await request(app.getHttpServer())
        .post(`${base}/goods-receipts`)
        .set('Authorization', auth)
        .field('purchaseOrderId', poUpload.body.id)
        .field('grnNumber', 'GRN-LH-2')
        .attach('file', Buffer.from('sku,qty received,qty accepted\nA1,4,4'), 'grn-2.csv')
        .expect(201)
      await waitForGoodsReceiptDone(secondReceipt.body.id)

      const invoiceUpload = await request(app.getHttpServer())
        .post(`${base}/invoices`)
        .set('Authorization', auth)
        .field('purchaseOrderId', poUpload.body.id)
        .field('invoiceNumber', 'INV-LH-SPLIT')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nB2,Gadget,4,12.50\nA1,Widget,10,5.00'), 'invoice.csv')
        .expect(201)
      await waitForInvoiceDone(invoiceUpload.body.id)

      const compareRes = await request(app.getHttpServer())
        .post(`${base}/discrepancies/compare`)
        .set('Authorization', auth)
        .send({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
        .expect(201)

      expect(compareRes.body.flags).toEqual([])
      expect(compareRes.body.counts).toEqual({
        quantity_mismatch: 0,
        price_mismatch: 0,
        missing_on_invoice: 0,
        missing_on_po: 0,
        short_receipt: 0,
        invoice_exceeds_received: 0,
        uom_mismatch: 0,
        currency_mismatch: 0,
        contract_price_variance: 0,
        contract_price_unavailable: 0,
      })
      // Neither receipt alone covers A1, and a two-way engine also returns no
      // flags for this pair, so the run itself must prove three-way happened.
      const [run] = await db.select().from(comparisonRuns).where(eq(comparisonRuns.id, compareRes.body.runId))
      expect(run.status).toBe('succeeded')
      expect(run.mode).toBe('three_way')
      expect(run.goodsReceiptLineCount).toBe(3)
      expect(run.flagCount).toBe(0)
    })
  })
  // B2/B3 over HTTP: the upload is accepted, then the document fails at parse
  // with an authored reason instead of finishing `done` with no lines.
  describe('unreadable files (B2/B3)', () => {
    const NO_LINE_ITEMS =
      'No line items were found in this file. Its first row must hold column headers such as SKU, Description, Qty and Unit price, and it must be saved as a UTF-8 CSV or an XLSX workbook.'

    async function waitForPoTerminal(id: string, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
        if (row?.status === 'done' || row?.status === 'failed') return row
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      throw new Error(`Purchase order ${id} did not finish within ${timeoutMs}ms`)
    }

    it('error: a header-only purchase order is accepted, then fails with the no-line-items reason and is listed with it', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}zr-http-owner@example.com`, 'ZR Http')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)

      const upload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-ZR-HEADERS')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\n'), 'po-headers-only.csv')
        .expect(201)

      const row = await waitForPoTerminal(upload.body.id)
      expect(row.status).toBe('failed')
      expect(row.lastError).toBe(NO_LINE_ITEMS)

      const list = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)
      expect(list.body.find((doc: { id: string }) => doc.id === upload.body.id)).toMatchObject({
        status: 'failed',
        lastError: NO_LINE_ITEMS,
      })
    })

    it('edge: a two-column semicolon goods receipt uploaded over HTTP parses both lines', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}zr-http-grn@example.com`, 'ZR Http Grn')
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId: owner.workspaceId, name: 'po.csv', status: 'done', rowCount: 0 })
        .returning()

      const upload = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/goods-receipts`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', po.id)
        .field('grnNumber', 'GRN-ZR-SEMI')
        .attach('file', Buffer.from('sku;qty received\nA1;5\nB2;7\n'), 'grn-semicolon.csv')
        .expect(201)
      await waitForGoodsReceiptDone(upload.body.id)

      const [receipt] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, upload.body.id))
      expect(receipt.rowCount).toBe(2)
    })
  })

  // B1 over HTTP: a flag on an XLSX line that sits below a blank row cites the
  // row a reviewer finds when they open the file.
  describe('XLSX citations (B1)', () => {
    it('regression: a price flag on an XLSX line below a blank row cites its true spreadsheet row', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}b1-http@example.com`, 'B1 Http')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([['sku', 'description', 'qty', 'unit price'], ['A1', 'Widget', 10, 5], [], ['B2', 'Gadget', 4, 12.5]]),
        'Order Lines',
      )

      const po = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-B1-XLSX')
        .field('currency', 'USD')
        .attach('file', XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'po.xlsx')
        .expect(201)
      const invoice = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', po.body.id)
        .field('invoiceNumber', 'INV-B1-XLSX')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,10,5.00\nB2,Gadget,4,13.00'), 'invoice.csv')
        .expect(201)
      await waitForPoDone(po.body.id)
      await waitForInvoiceDone(invoice.body.id)
      await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: po.body.id, invoiceId: invoice.body.id })
        .expect(201)

      const res = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/discrepancies`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)

      const price = res.body.items.find((flag: { flagType: string }) => flag.flagType === 'price_mismatch')
      expect(price.sku).toBe('B2')
      expect(price.poLine).toMatchObject({ sourceRow: 4, sourceSheet: 'Order Lines', documentId: po.body.id })
      expect(price.invoiceLine).toMatchObject({ sourceRow: 3, documentId: invoice.body.id })
    })
  })

  describe('non-ASCII filenames (B8)', () => {
    it('regression: a purchase order uploaded as façture-日本.csv is listed and downloaded under that name', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}b8-name@example.com`, 'B8 Name')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${owner.accessToken}`

      const upload = await request(app.getHttpServer())
        .post(`${base}/purchase-orders`)
        .set('Authorization', auth)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-B8')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,10,5.00'), 'façture-日本.csv')
        .expect(201)
      expect(upload.body.name).toBe('façture-日本.csv')

      const listed = await request(app.getHttpServer()).get(`${base}/purchase-orders`).set('Authorization', auth).expect(200)
      const rows = (Array.isArray(listed.body) ? listed.body : listed.body.items) as { id: string; name: string }[]
      expect(rows.find((row) => row.id === upload.body.id)?.name).toBe('façture-日本.csv')

      const download = await request(app.getHttpServer())
        .get(`${base}/purchase-orders/${upload.body.id}/download`)
        .set('Authorization', auth)
        .expect(200)
      expect(download.headers['content-disposition']).toBe(
        "attachment; filename=\"fa_ture-__.csv\"; filename*=UTF-8''fa%C3%A7ture-%E6%97%A5%E6%9C%AC.csv",
      )
    })
  })

  describe('exact flag deltas (B9)', () => {
    it('regression: a sub-cent price mismatch compared over HTTP carries its real delta', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}b9-delta@example.com`, 'B9 Delta')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${owner.accessToken}`

      const po = await request(app.getHttpServer())
        .post(`${base}/purchase-orders`)
        .set('Authorization', auth)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-B9')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Washer,300,0.3333'), 'po.csv')
        .expect(201)
      await waitForPoDone(po.body.id)
      const invoice = await request(app.getHttpServer())
        .post(`${base}/invoices`)
        .set('Authorization', auth)
        .field('purchaseOrderId', po.body.id)
        .field('invoiceNumber', 'INV-B9')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Washer,300,0.33'), 'invoice.csv')
        .expect(201)
      await waitForInvoiceDone(invoice.body.id)

      const compared = await request(app.getHttpServer())
        .post(`${base}/discrepancies/compare`)
        .set('Authorization', auth)
        .send({ purchaseOrderId: po.body.id, invoiceId: invoice.body.id })
        .expect(201)

      expect(compared.body.flags).toHaveLength(1)
      expect(compared.body.flags[0]).toMatchObject({ flagType: 'price_mismatch', delta: '-0.0033' })
    })
  })

  describe('line names in flag reasons (B10)', () => {
    it('regression: a compare over HTTP names a line without a SKU by its description', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}b10-name@example.com`, 'B10 Name')
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const base = `/workspaces/${owner.workspaceId}/procurement`
      const auth = `Bearer ${owner.accessToken}`

      const po = await request(app.getHttpServer())
        .post(`${base}/purchase-orders`)
        .set('Authorization', auth)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-B10')
        .field('currency', 'USD')
        .attach('file', Buffer.from('description,qty,unit price\nBolt M8x20,100,0.12'), 'po.csv')
        .expect(201)
      await waitForPoDone(po.body.id)
      const invoice = await request(app.getHttpServer())
        .post(`${base}/invoices`)
        .set('Authorization', auth)
        .field('purchaseOrderId', po.body.id)
        .field('invoiceNumber', 'INV-B10')
        .field('currency', 'USD')
        .attach('file', Buffer.from('description,qty,unit price\nBolt M8x20,90,0.12'), 'invoice.csv')
        .expect(201)
      await waitForInvoiceDone(invoice.body.id)

      const compared = await request(app.getHttpServer())
        .post(`${base}/discrepancies/compare`)
        .set('Authorization', auth)
        .send({ purchaseOrderId: po.body.id, invoiceId: invoice.body.id })
        .expect(201)

      expect(compared.body.flags).toHaveLength(1)
      expect(compared.body.flags[0].reason).toBe('Quantity mismatch for "Bolt M8x20": PO=100 Invoice=90')
    })
  })

  // Photo intake: 1-5 phone photos become one document that a human must
  // confirm before it can be compared.
  describe('photo intake and review', () => {
    const HEIC_MESSAGE = 'HEIC/HEIF photos are not supported — export as JPEG and upload again'
    let jpegA: Buffer
    let jpegB: Buffer

    // Photos share the vision-spend flag with PDFs; the suite must not depend on the host env.
    const originalVisionFlag = process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED

    afterAll(() => {
      if (originalVisionFlag === undefined) delete process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED
      else process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = originalVisionFlag
    })

    beforeEach(() => {
      process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = 'true'
    })

    beforeAll(async () => {
      jpegA = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
      jpegB = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#eeeeee' } }).jpeg().toBuffer()
    })

    const anyId = '00000000-0000-4000-8000-000000000000'
    const csvPo = ['sku,description,qty,unit price', 'A1,Widget,10,5.00', 'B2,Gadget,3,9.99'].join('\n')

    async function seedWorkspaceWithPo(label: string) {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}photo-${label}@example.com`, `Photo ${label}`)
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const poRes = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-PHOTO-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from(csvPo), 'po.csv')
        .expect(201)
      await waitForPoDone(poRes.body.id)
      return { owner, vendorId, poId: poRes.body.id as string }
    }

    function photoInvoiceRequest(owner: { workspaceId: string; accessToken: string }, poId: string, files: [Buffer, string][]) {
      let req = request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices/photos`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', poId)
        .field('invoiceNumber', 'INV-PHOTO-1')
        .field('currency', 'USD')
      for (const [buffer, name] of files) {
        req = req.attach('files', buffer, name)
      }
      return req
    }

    async function seedPhotoInvoice(label: string) {
      const seeded = await seedWorkspaceWithPo(label)
      const res = await photoInvoiceRequest(seeded.owner, seeded.poId, [
        [jpegA, 'invoice-photo.jpg'],
        [jpegB, 'invoice-photo-2.jpg'],
      ]).expect(201)
      await waitForInvoiceDone(res.body.id)
      return { ...seeded, invoiceId: res.body.id as string, base: `/workspaces/${seeded.owner.workspaceId}/procurement` }
    }

    async function linesOf(base: string, token: string, invoiceId: string) {
      const res = await request(app.getHttpServer())
        .get(`${base}/invoices/${invoiceId}/lines`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      return res.body as {
        document: Record<string, unknown>
        items: { id: string; sku: string; quantity: string; unitPrice: string; lineNumber: number; sourceKind: string; editedAt: string | null; extractionConfidence: number | null }[]
        page: number
        pageSize: number
        total: number
        totalPages: number
      }
    }

    it('error: six photos answer 400 "Too many files" and create nothing', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('six')

      const res = await photoInvoiceRequest(owner, poId, Array.from({ length: 6 }, (_, i) => [jpegA, `p${i}.jpg`] as [Buffer, string]))

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Too many files')
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('error: with the vision flag off a photo upload answers 400 "Photo uploads are not enabled for this workspace" and creates nothing', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('flagoff')
      process.env.PROCUREMENT_PDF_EXTRACTION_ENABLED = 'false'

      const res = await photoInvoiceRequest(owner, poId, [[jpegA, 'p.jpg']])

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Photo uploads are not enabled for this workspace')
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('regression: a single-file route keeps its plain "Unexpected field" answer for a wrong field name', async () => {
      const { owner, vendorId } = await seedWorkspaceWithPo('wrongfield')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', 'PO-WRONG-FIELD')
        .field('currency', 'USD')
        .attach('files', Buffer.from(csvPo), 'po.csv')

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Unexpected field')
    })

    it('error: no files answers 400 "files are required"', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('nofiles')

      const res = await photoInvoiceRequest(owner, poId, [])

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('files are required')
    })

    it('error: a .heic file answers 400 with the HEIC message', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('heic')
      const heic = Buffer.alloc(64)
      heic.writeUInt32BE(24, 0)
      heic.write('ftypmif1', 4, 'latin1')

      const res = await photoInvoiceRequest(owner, poId, [[heic, 'IMG_0001.heic']])

      expect(res.status).toBe(400)
      expect(res.body.message).toBe(HEIC_MESSAGE)
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('error: HEIC bytes renamed to .jpg are caught by the magic-byte check, not the extension', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('heic-renamed')
      const heic = Buffer.alloc(64)
      heic.writeUInt32BE(24, 0)
      heic.write('ftypheic', 4, 'latin1')

      const res = await photoInvoiceRequest(owner, poId, [[heic, 'IMG_0001.jpg']])

      expect(res.status).toBe(400)
      expect(res.body.message).toBe(HEIC_MESSAGE)
    })

    it('error: text named .jpg answers 400 "Photo 1 is not a JPEG, PNG or WebP image"', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('fake-jpg')

      const res = await photoInvoiceRequest(owner, poId, [[Buffer.from('not an image at all'), 'fake.jpg']])

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Photo 1 is not a JPEG, PNG or WebP image')
    })

    it('error: a truncated JPEG answers 400 "Photo 2 could not be read" and stores no page', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('truncated')
      storage.save.mockClear()

      const res = await photoInvoiceRequest(owner, poId, [
        [jpegA, 'ok.jpg'],
        [jpegB.subarray(0, 300), 'cut.jpg'],
      ])

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Photo 2 could not be read')
      expect(storage.save).not.toHaveBeenCalled()
      expect(await db.select().from(invoices).where(eq(invoices.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('error: a non-image extension on the photos route answers 400', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('pdf-on-photos')

      const res = await photoInvoiceRequest(owner, poId, [[Buffer.from('%PDF-1.4 x'), 'scan.pdf']])

      expect(res.status).toBe(400)
    })

    it('error: a missing header field answers 400 with the per-field messages', async () => {
      const { owner } = await seedWorkspaceWithPo('no-header')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices/photos`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('files', jpegA, 'p.jpg')

      expect(res.status).toBe(400)
      expect(Array.isArray(res.body.message)).toBe(true)
    })

    it('error: a purchase order from another workspace answers 404 and stores nothing', async () => {
      const mine = await seedWorkspaceWithPo('idor-po-mine')
      const theirs = await seedWorkspaceWithPo('idor-po-theirs')
      storage.save.mockClear()

      const res = await photoInvoiceRequest(mine.owner, theirs.poId, [[jpegA, 'p.jpg']])

      expect(res.status).toBe(404)
      expect(storage.save).not.toHaveBeenCalled()
    })

    it('error: a member cannot post photos or a review (403 on role)', async () => {
      const { owner, poId, invoiceId, base } = await seedPhotoInvoice('member')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}photo-member-user@example.com`)

      const photos = await photoInvoiceRequest({ workspaceId: owner.workspaceId, accessToken: member.accessToken }, poId, [[jpegA, 'p.jpg']])
      const review = await request(app.getHttpServer())
        .post(`${base}/invoices/${invoiceId}/review`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ lines: [{ sku: 'A1', quantity: '1' }] })

      expect(photos.status).toBe(403)
      expect(photos.body.message).toBe('Insufficient workspace role')
      expect(review.status).toBe(403)
      expect(review.body.message).toBe('Insufficient workspace role')
      const [header] = await db.select().from(invoices).where(eq(invoices.id, invoiceId))
      expect(header.reviewedAt).toBeNull()
    })

    it('error: a non-member of the workspace is refused 403 on lines, pages and review', async () => {
      const { invoiceId, base } = await seedPhotoInvoice('outsider')
      const outsider = await seedOwnerWithWorkspace(app, `${prefix}photo-nonmember@example.com`, 'Photo Outsider')
      const auth = `Bearer ${outsider.accessToken}`

      const answers = [
        await request(app.getHttpServer()).get(`${base}/invoices/${invoiceId}/lines`).set('Authorization', auth),
        await request(app.getHttpServer()).get(`${base}/invoices/${invoiceId}/pages/1`).set('Authorization', auth),
        await request(app.getHttpServer()).post(`${base}/invoices/${invoiceId}/review`).set('Authorization', auth).send({ lines: [{ sku: 'A1' }] }),
      ].map((r) => r.status)

      expect(answers).toEqual([403, 403, 403])
    })

    it('error: workspace B reading workspace A\'s lines or pages answers 404', async () => {
      const a = await seedPhotoInvoice('idor-read-a')
      const b = await seedOwnerWithWorkspace(app, `${prefix}photo-idor-read-b@example.com`, 'Photo IDOR Read B')
      const baseB = `/workspaces/${b.workspaceId}/procurement`
      const auth = `Bearer ${b.accessToken}`

      const lines = await request(app.getHttpServer()).get(`${baseB}/invoices/${a.invoiceId}/lines`).set('Authorization', auth)
      const page = await request(app.getHttpServer()).get(`${baseB}/invoices/${a.invoiceId}/pages/1`).set('Authorization', auth)

      expect(lines.status).toBe(404)
      expect(page.status).toBe(404)
      expect(JSON.stringify([lines.body, page.body])).not.toContain('Widget')
    })

    it('error: workspace B reviewing A\'s document, or its own with A\'s line id, answers 404 and changes nothing', async () => {
      const a = await seedPhotoInvoice('idor-review-a')
      const b = await seedPhotoInvoice('idor-review-b')
      const aLines = await linesOf(a.base, a.owner.accessToken, a.invoiceId)
      const auth = `Bearer ${b.owner.accessToken}`

      const foreignDoc = await request(app.getHttpServer())
        .post(`${b.base}/invoices/${a.invoiceId}/review`)
        .set('Authorization', auth)
        .send({ lines: [{ id: aLines.items[0].id, sku: 'HACK', quantity: '1' }] })
      const foreignLine = await request(app.getHttpServer())
        .post(`${b.base}/invoices/${b.invoiceId}/review`)
        .set('Authorization', auth)
        .send({ lines: [{ id: aLines.items[0].id, sku: 'HACK', quantity: '1' }] })

      expect(foreignDoc.status).toBe(404)
      expect(foreignLine.status).toBe(404)
      const [aHeader] = await db.select().from(invoices).where(eq(invoices.id, a.invoiceId))
      const [bHeader] = await db.select().from(invoices).where(eq(invoices.id, b.invoiceId))
      expect(aHeader.reviewedAt).toBeNull()
      expect(bHeader.reviewedAt).toBeNull()
      const after = await linesOf(a.base, a.owner.accessToken, a.invoiceId)
      expect(after.items.map((l) => l.sku)).toEqual(['A1', 'B2', 'D4'])
      expect(after.items.every((l) => l.editedAt === null)).toBe(true)
    })

    it('error: a review body that fails validation answers 400', async () => {
      const { owner, invoiceId, base } = await seedPhotoInvoice('validation')
      const post = (body: unknown) =>
        request(app.getHttpServer())
          .post(`${base}/invoices/${invoiceId}/review`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send(body as object)

      const answers = [
        (await post({ lines: [] })).status,
        (await post({})).status,
        (await post({ lines: Array.from({ length: 201 }, () => ({ sku: 'X' })) })).status,
        (await post({ lines: [{ id: 'not-a-uuid', sku: 'X' }] })).status,
        (await post({ lines: [{ sku: 'X', quantity: 'ten' }] })).status,
        (await post({ lines: [{ sku: 'X'.repeat(201) }] })).status,
      ]

      expect(answers).toEqual([400, 400, 400, 400, 400, 400])
      const [header] = await db.select().from(invoices).where(eq(invoices.id, invoiceId))
      expect(header.reviewedAt).toBeNull()
    })

    it('error: an unknown line id answers 404 and duplicate ids answer 400', async () => {
      const { owner, invoiceId, base } = await seedPhotoInvoice('line-ids')
      const lines = await linesOf(base, owner.accessToken, invoiceId)
      const post = (body: unknown) =>
        request(app.getHttpServer())
          .post(`${base}/invoices/${invoiceId}/review`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send(body as object)

      const unknown = await post({ lines: [{ id: anyId, sku: 'X' }] })
      const duplicate = await post({ lines: [{ id: lines.items[0].id, sku: 'A1' }, { id: lines.items[0].id, sku: 'A1' }] })

      expect(unknown.status).toBe(404)
      expect(duplicate.status).toBe(400)
      const [header] = await db.select().from(invoices).where(eq(invoices.id, invoiceId))
      expect(header.reviewedAt).toBeNull()
    })

    it('error: comparing before the review answers 400 "Invoice needs review before it can be compared"', async () => {
      const { owner, poId, invoiceId, base } = await seedPhotoInvoice('compare-before')

      const res = await request(app.getHttpServer())
        .post(`${base}/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: poId, invoiceId })

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Invoice needs review before it can be compared')
      expect(await db.select().from(comparisonRuns).where(eq(comparisonRuns.workspaceId, owner.workspaceId))).toHaveLength(0)
    })

    it('error: a document that needs no review (CSV) answers 400 on review', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('csv-review')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders/${poId}/review`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ lines: [{ sku: 'A1', quantity: '1' }] })

      expect(res.status).toBe(400)
    })

    it('error: reviewing twice answers 409 and the second body changes nothing', async () => {
      const { owner, invoiceId, base } = await seedPhotoInvoice('twice')
      const lines = await linesOf(base, owner.accessToken, invoiceId)
      const body = { lines: lines.items.map((l) => ({ id: l.id, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice })) }
      const post = (b: unknown) =>
        request(app.getHttpServer()).post(`${base}/invoices/${invoiceId}/review`).set('Authorization', `Bearer ${owner.accessToken}`).send(b as object)

      await post(body).expect(200)
      const second = await post({ lines: [{ id: lines.items[0].id, sku: 'LATE', quantity: '99' }] })

      expect(second.status).toBe(409)
      const after = await linesOf(base, owner.accessToken, invoiceId)
      expect(after.items.map((l) => l.sku)).toEqual(['A1', 'B2', 'D4'])
    })

    it('edge: a 26MB photo answers 413 naming the 25MB limit and stores nothing', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('toobig')
      storage.save.mockClear()

      const res = await photoInvoiceRequest(owner, poId, [[Buffer.alloc(26 * 1024 * 1024, 'a'), 'huge.jpg']])

      expect(res.status).toBe(413)
      expect(res.body).toEqual({ statusCode: 413, message: 'File exceeds 25MB upload limit' })
      expect(storage.save).not.toHaveBeenCalled()
    })

    it('edge: page 0, a page past the end and a missing document are 404; a non-numeric page is 400', async () => {
      const { owner, invoiceId, base } = await seedPhotoInvoice('page-range')
      const get = (path: string) => request(app.getHttpServer()).get(`${base}/${path}`).set('Authorization', `Bearer ${owner.accessToken}`)

      const answers = [
        (await get(`invoices/${invoiceId}/pages/0`)).status,
        (await get(`invoices/${invoiceId}/pages/3`)).status,
        (await get(`invoices/${anyId}/pages/1`)).status,
        (await get(`invoices/${invoiceId}/pages/abc`)).status,
      ]

      expect(answers).toEqual([404, 404, 404, 400])
    })

    it('edge: a CSV document has no pages (404)', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('csv-pages')

      const res = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/purchase-orders/${poId}/pages/1`)
        .set('Authorization', `Bearer ${owner.accessToken}`)

      expect(res.status).toBe(404)
    })

    it('edge: lines are paged', async () => {
      const { owner, invoiceId, base } = await seedPhotoInvoice('paging')

      const res = await request(app.getHttpServer())
        .get(`${base}/invoices/${invoiceId}/lines`)
        .query({ page: 2, pageSize: 2 })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)

      expect(res.body.items.map((l: { sku: string }) => l.sku)).toEqual(['D4'])
      expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 })
      await request(app.getHttpServer())
        .get(`${base}/invoices/${invoiceId}/lines`)
        .query({ pageSize: 101 })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(400)
    })

    it('edge: a member can read lines and pages (read access) but not change them', async () => {
      const { owner, invoiceId, base } = await seedPhotoInvoice('member-read')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}photo-member-read-user@example.com`)
      const auth = `Bearer ${member.accessToken}`

      await request(app.getHttpServer()).get(`${base}/invoices/${invoiceId}/lines`).set('Authorization', auth).expect(200)
      await request(app.getHttpServer()).get(`${base}/invoices/${invoiceId}/pages/1`).set('Authorization', auth).expect(200)
    })

    it('edge: the page route serves a JPEG inline with nosniff, a sandboxing CSP and a private cache', async () => {
      const { owner, invoiceId, base } = await seedPhotoInvoice('headers')

      const res = await request(app.getHttpServer())
        .get(`${base}/invoices/${invoiceId}/pages/2`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = []
          response.on('data', (c: Buffer) => chunks.push(c))
          response.on('end', () => callback(null, Buffer.concat(chunks)))
        })
        .expect(200)

      expect(res.headers['content-type']).toMatch(/^image\/jpeg/)
      expect(res.headers['content-disposition']).toBe('inline')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
      expect(res.headers['cache-control']).toBe('private, no-store')
      const meta = await sharp(res.body as Buffer).metadata()
      expect(meta.format).toBe('jpeg')
      expect([meta.width, meta.height]).toEqual([200, 300])
    })

    it('edge: an upload with EXIF orientation 6 is stored upright and without EXIF', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('exif')
      const tilted = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer()
      const upload = await photoInvoiceRequest(owner, poId, [[tilted, 'tilted.jpg']]).expect(201)

      const page = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/invoices/${upload.body.id}/pages/1`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = []
          response.on('data', (c: Buffer) => chunks.push(c))
          response.on('end', () => callback(null, Buffer.concat(chunks)))
        })
        .expect(200)

      const meta = await sharp(page.body as Buffer).metadata()
      expect([meta.width, meta.height]).toEqual([400, 600])
      expect(meta.exif).toBeUndefined()
    })

    it('edge: five photos are accepted as one document with pageCount 5', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('five')

      const res = await photoInvoiceRequest(owner, poId, Array.from({ length: 5 }, (_, i) => [jpegA, `p${i}.jpg`] as [Buffer, string])).expect(201)

      await waitForInvoiceDone(res.body.id)
      const [header] = await db.select().from(invoices).where(eq(invoices.id, res.body.id))
      expect(header.pageCount).toBe(5)
    })

    it('regression: the document lists with sourceKind, pageCount, reviewRequired and detectedKind; a CSV order lists reviewRequired false', async () => {
      const { owner, poId, invoiceId, base } = await seedPhotoInvoice('list')

      const invoicesList = await request(app.getHttpServer()).get(`${base}/invoices`).set('Authorization', `Bearer ${owner.accessToken}`).expect(200)
      const poList = await request(app.getHttpServer()).get(`${base}/purchase-orders`).set('Authorization', `Bearer ${owner.accessToken}`).expect(200)

      const photo = (invoicesList.body as { id: string }[]).find((i) => i.id === invoiceId)
      expect(photo).toMatchObject({ sourceKind: 'image', pageCount: 2, reviewRequired: true, reviewedAt: null, detectedKind: 'invoice', status: 'done' })
      expect(photo).not.toHaveProperty('storageKey')
      const csv = (poList.body as { id: string }[]).find((p) => p.id === poId)
      expect(csv).toMatchObject({ sourceKind: 'csv', reviewRequired: false, pageCount: null, reviewedAt: null })
    })

    it('regression: a CSV purchase order and CSV invoice still compare with no review step', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('csv-compare')
      const inv = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', poId)
        .field('invoiceNumber', 'INV-CSV-1')
        .field('currency', 'USD')
        .attach('file', Buffer.from('sku,description,qty,unit price\nA1,Widget,8,5.00\nB2,Gadget,3,9.99'), 'inv.csv')
        .expect(201)
      await waitForInvoiceDone(inv.body.id)

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: poId, invoiceId: inv.body.id })
        .expect(201)

      expect(res.body.counts.quantity_mismatch).toBe(1)
    })

    it('happy: a photo goods receipt is parsed and waits for review like an invoice', async () => {
      const { owner, poId } = await seedWorkspaceWithPo('grn')
      const base = `/workspaces/${owner.workspaceId}/procurement`

      const upload = await request(app.getHttpServer())
        .post(`${base}/goods-receipts/photos`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', poId)
        .field('grnNumber', 'GRN-PHOTO-1')
        .attach('files', jpegA, 'grn.jpg')
        .expect(201)
      await waitForGoodsReceiptDone(upload.body.id)

      const lines = await request(app.getHttpServer())
        .get(`${base}/goods-receipts/${upload.body.id}/lines`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)
      expect(lines.body.document).toMatchObject({ sourceKind: 'image', reviewRequired: true, reviewedAt: null, detectedKind: 'goods_receipt' })
      expect(lines.body.items[0]).toMatchObject({ sku: 'A1', quantityReceived: '10', quantityAccepted: '10', quantityRejected: '0', extractionConfidence: 0.8 })
    })

    it('happy: photos -> done -> lines -> review (edit + add + delete) -> compare 201 with photo citations', async () => {
      const { owner, poId, invoiceId, base } = await seedPhotoInvoice('flow')
      const auth = `Bearer ${owner.accessToken}`

      const before = await linesOf(base, owner.accessToken, invoiceId)
      expect(before.document).toMatchObject({
        id: invoiceId,
        name: 'invoice-photo.pdf',
        status: 'done',
        sourceKind: 'image',
        pageCount: 2,
        detectedKind: 'invoice',
        reviewRequired: true,
        reviewedAt: null,
      })
      expect(before.items.map((l) => [l.sku, l.sourceKind, l.extractionConfidence])).toEqual([
        ['A1', 'image-extraction', 0.92],
        ['B2', 'image-extraction', 0.55],
        ['D4', 'image-extraction', 0.8],
      ])

      const [a1, b2] = before.items
      const review = await request(app.getHttpServer())
        .post(`${base}/invoices/${invoiceId}/review`)
        .set('Authorization', auth)
        .send({
          lines: [
            { id: a1.id, sku: 'A1', description: 'Widget', quantity: '9', unitPrice: '5.00', lineTotal: '45.00' },
            { id: b2.id, sku: 'B2', description: 'Gadget', quantity: '3', unitPrice: '12.00', lineTotal: '36.00' },
            { sku: 'E5', description: 'Added by reviewer', quantity: '1', unitPrice: '2.00', lineTotal: '2.00' },
          ],
        })
        .expect(200)
      expect(review.body).toMatchObject({ id: invoiceId, rowCount: 3 })
      expect(typeof review.body.reviewedAt).toBe('string')

      const after = await linesOf(base, owner.accessToken, invoiceId)
      expect(after.document.reviewedAt).not.toBeNull()
      expect(after.document.reviewedBy).toBe(owner.user.id)
      expect(after.items.map((l) => [l.lineNumber, l.sku, l.sourceKind])).toEqual([
        [1, 'A1', 'image-extraction'],
        [2, 'B2', 'image-extraction'],
        [3, 'E5', 'manual'],
      ])
      expect(after.items[0].editedAt).not.toBeNull()
      expect(after.items[1].editedAt).toBeNull()

      const compare = await request(app.getHttpServer())
        .post(`${base}/discrepancies/compare`)
        .set('Authorization', auth)
        .send({ purchaseOrderId: poId, invoiceId })
        .expect(201)
      expect(compare.body.counts).toMatchObject({ quantity_mismatch: 1, price_mismatch: 1, missing_on_po: 1, missing_on_invoice: 0 })

      const flags = await request(app.getHttpServer())
        .get(`${base}/discrepancies`)
        .query({ invoiceId })
        .set('Authorization', auth)
        .expect(200)
      const byType = (type: string) => flags.body.items.find((f: { flagType: string }) => f.flagType === type)
      expect(byType('quantity_mismatch').invoiceLine).toMatchObject({ sourceKind: 'image-extraction', documentId: invoiceId })
      expect(typeof byType('quantity_mismatch').invoiceLine.editedAt).toBe('string')
      expect(byType('price_mismatch').invoiceLine).toMatchObject({ sourceKind: 'image-extraction', editedAt: null, extractionConfidence: 0.55 })
      expect(byType('missing_on_po').invoiceLine).toMatchObject({ sourceKind: 'manual' })

      // The document is read-only once confirmed.
      await request(app.getHttpServer())
        .post(`${base}/invoices/${invoiceId}/review`)
        .set('Authorization', auth)
        .send({ lines: [{ id: a1.id, sku: 'A1', quantity: '1' }] })
        .expect(409)
    })
  })

  // B16. Lives in this suite for its seeded owner (no /auth/register spend);
  // the routes belong to other modules. Each used to answer 500 (Postgres
  // 22P02) on a malformed id.
  describe('malformed path ids on the remaining routes (B16)', () => {
    it('error: every route that takes an id from the path answers 400 for a malformed one', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}b16-ids@example.com`, 'B16 Ids')
      const ws = `/workspaces/${owner.workspaceId}`
      const auth = `Bearer ${owner.accessToken}`
      const http = () => request(app.getHttpServer())
      const routes: [string, () => request.Test][] = [
        ['DELETE members/:userId', () => http().delete(`${ws}/members/not-a-uuid`)],
        ['GET chat/sessions/:sessionId/messages', () => http().get(`${ws}/chat/sessions/not-a-uuid/messages`)],
        ['PATCH faq-drafts/:draftId/approve', () => http().patch(`${ws}/insights/faq-drafts/not-a-uuid/approve`).send({})],
        ['PATCH faq-drafts/:draftId/reject', () => http().patch(`${ws}/insights/faq-drafts/not-a-uuid/reject`).send({})],
        ['PATCH freshness-flags/:flagId/dismiss', () => http().patch(`${ws}/insights/freshness-flags/not-a-uuid/dismiss`)],
        ['DELETE knowledge-bases/:kbId', () => http().delete(`${ws}/knowledge-bases/not-a-uuid`)],
        ['POST knowledge-bases/:kbId/scrape', () => http().post(`${ws}/knowledge-bases/not-a-uuid/scrape`).send({ url: 'https://vendor.example.com/' })],
        ['GET knowledge-bases/:kbId/scrape-runs', () => http().get(`${ws}/knowledge-bases/not-a-uuid/scrape-runs`)],
        ['GET tickets/:ticketId/transcript.pdf', () => http().get(`${ws}/tickets/not-a-uuid/transcript.pdf`)],
        ['GET tickets/:ticketId', () => http().get(`${ws}/tickets/not-a-uuid`)],
        ['PATCH tickets/:ticketId', () => http().patch(`${ws}/tickets/not-a-uuid`).send({})],
        ['GET procurement/purchase-orders/:docId/lines', () => http().get(`${ws}/procurement/purchase-orders/not-a-uuid/lines`)],
        ['GET procurement/invoices/:docId/lines', () => http().get(`${ws}/procurement/invoices/not-a-uuid/lines`)],
        ['GET procurement/goods-receipts/:docId/lines', () => http().get(`${ws}/procurement/goods-receipts/not-a-uuid/lines`)],
        ['GET procurement/purchase-orders/:docId/pages/:n', () => http().get(`${ws}/procurement/purchase-orders/not-a-uuid/pages/1`)],
        ['GET procurement/invoices/:docId/pages/:n', () => http().get(`${ws}/procurement/invoices/not-a-uuid/pages/1`)],
        ['GET procurement/goods-receipts/:docId/pages/:n', () => http().get(`${ws}/procurement/goods-receipts/not-a-uuid/pages/1`)],
        ['POST procurement/purchase-orders/:docId/review', () => http().post(`${ws}/procurement/purchase-orders/not-a-uuid/review`).send({ lines: [{}] })],
        ['POST procurement/invoices/:docId/review', () => http().post(`${ws}/procurement/invoices/not-a-uuid/review`).send({ lines: [{}] })],
        ['POST procurement/goods-receipts/:docId/review', () => http().post(`${ws}/procurement/goods-receipts/not-a-uuid/review`).send({ lines: [{}] })],
      ]

      const answers: { route: string; status: number; message: unknown }[] = []
      for (const [route, send] of routes) {
        const res = await send().set('Authorization', auth)
        answers.push({ route, status: res.status, message: res.body.message })
      }

      expect(answers).toEqual(
        routes.map(([route]) => ({ route, status: 400, message: 'Validation failed (uuid is expected)' })),
      )
    })
  })

  // S4: matched-line metering on the manual compare route. The pairs are seeded
  // straight into the tables (status done, line rows present): the gate sits
  // after every 400 and before the run row, so what matters here is the HTTP
  // answer, the ledger and the run table.
  describe('billing metering (S4)', () => {
    const DAY = 24 * 60 * 60 * 1000

    async function withEnforcement<T>(value: string, fn: () => Promise<T>): Promise<T> {
      const previous = process.env.BILLING_ENFORCEMENT
      process.env.BILLING_ENFORCEMENT = value
      try {
        return await fn()
      } finally {
        if (previous === undefined) delete process.env.BILLING_ENFORCEMENT
        else process.env.BILLING_ENFORCEMENT = previous
      }
    }

    async function seedBillingOwner(label: string, state: 'none' | 'trial' | 'solo' | 'exempt') {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}s4-${label}@example.com`, `S4 ${label}`)
      if (state === 'trial' || state === 'exempt') {
        await db
          .update(workspaces)
          .set({ trialEndsAt: state === 'trial' ? new Date(Date.now() + 5 * DAY) : null, billingExempt: state === 'exempt' })
          .where(eq(workspaces.id, owner.workspaceId))
      }
      if (state === 'solo') {
        await db.insert(workspaceSubscriptions).values({
          workspaceId: owner.workspaceId,
          lsSubscriptionId: `sub-${owner.workspaceId}`,
          lsCustomerId: 'cus-1',
          lsVariantId: '9001',
          plan: 'solo',
          status: 'active',
          seats: 1,
          lsUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
        })
      }
      return owner
    }

    async function seedPair(workspaceId: string, lineCount: number) {
      const [po] = await db
        .insert(purchaseOrders)
        .values({ workspaceId, name: 'po.csv', status: 'done', rowCount: lineCount })
        .returning()
      const [invoice] = await db
        .insert(invoices)
        .values({ workspaceId, name: 'invoice.csv', status: 'done', rowCount: lineCount, purchaseOrderId: po.id })
        .returning()
      const lines = Array.from({ length: lineCount }, (_, i) => ({ sku: `S4-${i + 1}`, quantity: '10', unitPrice: '5.00' }))
      await db.insert(poLineItems).values(lines.map((line, i) => ({ workspaceId, purchaseOrderId: po.id, lineNumber: i + 1, ...line })))
      await db
        .insert(invoiceLineItems)
        .values(lines.map((line, i) => ({ workspaceId, invoiceId: invoice.id, lineNumber: i + 1, ...line, quantity: '8' })))
      return { po, invoice }
    }

    async function seedUsage(workspaceId: string, quantity: number) {
      await db.insert(usageEvents).values({
        workspaceId,
        kind: 'matched_line',
        quantity,
        idempotencyKey: `e2e-seed:${Math.random().toString(36).slice(2)}`,
        occurredAt: new Date(),
      })
    }

    const ledgerOf = (workspaceId: string) =>
      db.select().from(usageEvents).where(eq(usageEvents.workspaceId, workspaceId))
    const runsOf = (workspaceId: string) =>
      db.select().from(comparisonRuns).where(eq(comparisonRuns.workspaceId, workspaceId))

    const compare = (workspaceId: string, token: string, poId: string, invoiceId: string) =>
      request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${token}`)
        .send({ purchaseOrderId: poId, invoiceId })

    it('error: a workspace with no trial and no subscription gets 402 SUBSCRIPTION_REQUIRED on compare and no run row is written', async () => {
      const owner = await seedBillingOwner('none', 'none')
      const { po, invoice } = await seedPair(owner.workspaceId, 2)

      const res = await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(402))

      expect(res.body).toMatchObject({ statusCode: 402, code: 'SUBSCRIPTION_REQUIRED' })
      expect(typeof res.body.message).toBe('string')
      expect(await runsOf(owner.workspaceId)).toHaveLength(0)
      expect(await ledgerOf(owner.workspaceId)).toHaveLength(0)
    })

    it('error: a member gets 403 before the gate', async () => {
      const owner = await seedBillingOwner('member', 'none')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}s4-member-user@example.com`)
      const { po, invoice } = await seedPair(owner.workspaceId, 1)

      await withEnforcement('on', () => compare(owner.workspaceId, member.accessToken, po.id, invoice.id).expect(403))

      expect(await ledgerOf(owner.workspaceId)).toHaveLength(0)
    })

    it("error: another workspace's purchase order id is 404 before the gate and counts nothing", async () => {
      const mine = await seedBillingOwner('idor-mine', 'trial')
      const theirs = await seedBillingOwner('idor-theirs', 'trial')
      const foreign = await seedPair(theirs.workspaceId, 2)

      await withEnforcement('on', () => compare(mine.workspaceId, mine.accessToken, foreign.po.id, foreign.invoice.id).expect(404))

      expect(await ledgerOf(mine.workspaceId)).toHaveLength(0)
      expect(await ledgerOf(theirs.workspaceId)).toHaveLength(0)
    })

    it('error: a new pair over the Solo quota (399 lines already used) gets 402 QUOTA_EXCEEDED with quota matchedLines', async () => {
      const owner = await seedBillingOwner('quota', 'solo')
      await seedUsage(owner.workspaceId, 399)
      const { po, invoice } = await seedPair(owner.workspaceId, 2)

      const res = await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(402))

      expect(res.body).toMatchObject({ statusCode: 402, code: 'QUOTA_EXCEEDED', quota: 'matchedLines' })
      expect(await runsOf(owner.workspaceId)).toHaveLength(0)
      expect(await ledgerOf(owner.workspaceId)).toHaveLength(1)
    })

    it('edge: comparing an already counted pair at quota still succeeds', async () => {
      const owner = await seedBillingOwner('again', 'solo')
      const { po, invoice } = await seedPair(owner.workspaceId, 2)
      await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(201))
      await seedUsage(owner.workspaceId, 398)

      await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(201))

      const counted = (await ledgerOf(owner.workspaceId)).filter((row) => row.idempotencyKey.startsWith(`cmp:${po.id}:${invoice.id}:`))
      expect(counted).toHaveLength(1)
      expect(await runsOf(owner.workspaceId)).toHaveLength(2)
    })

    it('edge: a re-parsed PO with more lines charges only the extra lines, and a refused delta is 402 QUOTA_EXCEEDED', async () => {
      const owner = await seedBillingOwner('reparse', 'solo')
      const { po, invoice } = await seedPair(owner.workspaceId, 2)
      await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(201))

      // Re-parse: the PO now has 5 lines (3 more). Same pair, same month.
      await db.insert(poLineItems).values(
        [3, 4, 5].map((n) => ({ workspaceId: owner.workspaceId, purchaseOrderId: po.id, lineNumber: n, sku: `S4-${n}`, quantity: '10', unitPrice: '5.00' })),
      )
      await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(201))

      const counted = (await ledgerOf(owner.workspaceId)).filter((row) => row.idempotencyKey.startsWith(`cmp:${po.id}:${invoice.id}:`))
      expect(counted.map((row) => row.quantity).sort((a, b) => a - b)).toEqual([2, 3])

      // Another re-parse to 8 lines would add 3 more; only 2 of 400 remain after seeding 393.
      await seedUsage(owner.workspaceId, 393)
      await db.insert(poLineItems).values(
        [6, 7, 8].map((n) => ({ workspaceId: owner.workspaceId, purchaseOrderId: po.id, lineNumber: n, sku: `S4-${n}`, quantity: '10', unitPrice: '5.00' })),
      )
      const res = await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(402))
      expect(res.body).toMatchObject({ statusCode: 402, code: 'QUOTA_EXCEEDED', quota: 'matchedLines' })
      const total = (await ledgerOf(owner.workspaceId)).reduce((sum, row) => sum + row.quantity, 0)
      expect(total).toBe(2 + 3 + 393)
    })

    it('edge: with enforcement off the same over-quota workspace compares and the ledger still gets the row', async () => {
      const owner = await seedBillingOwner('off', 'solo')
      await seedUsage(owner.workspaceId, 399)
      const { po, invoice } = await seedPair(owner.workspaceId, 2)

      await withEnforcement('off', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(201))

      const rows = await ledgerOf(owner.workspaceId)
      expect(rows.some((row) => row.idempotencyKey.startsWith(`cmp:${po.id}:${invoice.id}:`) && row.quantity === 2)).toBe(true)
      expect(await runsOf(owner.workspaceId)).toHaveLength(1)
    })

    it("happy: a trial workspace's first compare writes one matched_line row", async () => {
      const owner = await seedBillingOwner('trial', 'trial')
      const { po, invoice } = await seedPair(owner.workspaceId, 3)

      await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(201))

      const rows = await ledgerOf(owner.workspaceId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'matched_line', quantity: 3 })
      expect(rows[0].idempotencyKey).toMatch(new RegExp(`^cmp:${po.id}:${invoice.id}:\\d{4}-\\d{2}-\\d{2}$`))
    })

    it('happy: an exempt workspace compares past 400 lines', async () => {
      const owner = await seedBillingOwner('exempt', 'exempt')
      const { po, invoice } = await seedPair(owner.workspaceId, 401)

      await withEnforcement('on', () => compare(owner.workspaceId, owner.accessToken, po.id, invoice.id).expect(201))

      const rows = await ledgerOf(owner.workspaceId)
      expect(rows).toHaveLength(1)
      expect(rows[0].quantity).toBe(401)
    })
  })

  // Evidence-trail export: a read-only xlsx of the review queue's scope. Guard
  // chain is JwtAuthGuard -> WorkspaceMemberGuard (members may read flags), then
  // ValidationPipe on the same filters as the list.
  describe('evidence-trail export', () => {
    const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const poCsv = 'sku,description,qty,unit price\nA1,Widget,10,5.00\nC3,Only On PO,1,1.00'
    const invoiceCsv = 'sku,description,qty,unit price\nA1,Widget,10,6.00\nD4,Only On Invoice,1,1.00'
    const exportPath = (workspaceId: string, query = '') =>
      `/workspaces/${workspaceId}/procurement/discrepancies/export${query}`

    const binary = (res: NodeJS.ReadableStream, callback: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => callback(null, Buffer.concat(chunks)))
    }

    const download = (token: string, workspaceId: string, query = '') =>
      request(app.getHttpServer())
        .get(exportPath(workspaceId, query))
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse(binary as never)

    const sheetRows = (body: Buffer, name: string) => {
      const book = XLSX.read(body, { type: 'buffer' })
      return XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', raw: true })
    }

    async function seedComparedPair(owner: { workspaceId: string; accessToken: string }, numbers: { po: string; invoice: string }, poName = 'po.csv') {
      const vendorId = await createVendor(app, owner.workspaceId, owner.accessToken)
      const po = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/purchase-orders`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('vendorId', vendorId)
        .field('poNumber', numbers.po)
        .field('currency', 'USD')
        .attach('file', Buffer.from(poCsv), poName)
        .expect(201)
      const invoice = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/invoices`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('purchaseOrderId', po.body.id)
        .field('invoiceNumber', numbers.invoice)
        .field('currency', 'USD')
        .attach('file', Buffer.from(invoiceCsv), 'invoice.csv')
        .expect(201)
      await waitForPoDone(po.body.id)
      await waitForInvoiceDone(invoice.body.id)
      await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/compare`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ purchaseOrderId: po.body.id, invoiceId: invoice.body.id })
        .expect(201)
      return { poId: po.body.id as string, invoiceId: invoice.body.id as string }
    }

    it('error: answers 401 without a token', async () => {
      const res = await request(app.getHttpServer()).get(exportPath('00000000-0000-4000-8000-000000000000'))

      expect(res.status).toBe(401)
      expect(res.body.message).toBe('Unauthorized')
    })

    it('error: a user outside the workspace is refused 403 and gets no workbook', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}exp-owner@example.com`, 'Exp Owner')
      const outsider = await seedOwnerWithWorkspace(app, `${prefix}exp-outsider@example.com`, 'Exp Outsider')

      const res = await download(outsider.accessToken, owner.workspaceId)

      expect(res.status).toBe(403)
      expect(res.headers['content-type']).not.toContain('spreadsheetml')
    })

    it('error: a malformed purchaseOrderId, invoiceId or runId answers 400 and an unknown status answers 400', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}exp-400@example.com`, 'Exp 400')

      const answers = [
        await download(owner.accessToken, owner.workspaceId, '?purchaseOrderId=not-a-uuid'),
        await download(owner.accessToken, owner.workspaceId, '?invoiceId=not-a-uuid'),
        await download(owner.accessToken, owner.workspaceId, '?runId=not-a-uuid'),
        await download(owner.accessToken, owner.workspaceId, '?status=banana'),
      ]

      expect(answers.map((res) => res.status)).toEqual([400, 400, 400, 400])
    })

    it("error: another workspace's purchase order id as a filter returns a workbook with no rows and none of its data", async () => {
      const mine = await seedOwnerWithWorkspace(app, `${prefix}exp-idor-a@example.com`, 'Exp Idor A')
      const theirs = await seedOwnerWithWorkspace(app, `${prefix}exp-idor-b@example.com`, 'Exp Idor B')
      await seedComparedPair(mine, { po: 'PO-EXP-IA', invoice: 'INV-EXP-IA' })
      const foreign = await seedComparedPair(theirs, { po: 'PO-EXP-IB', invoice: 'INV-EXP-IB' }, 'secret-po-name.csv')

      const res = await download(mine.accessToken, mine.workspaceId, `?purchaseOrderId=${foreign.poId}`)

      expect(res.status).toBe(200)
      expect(sheetRows(res.body, 'Flags')).toHaveLength(1)
      expect(res.body.toString('latin1')).not.toContain('secret-po-name.csv')
    })

    it('edge: a workspace with no flags still answers 200 with both sheets and only header rows', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}exp-none@example.com`, 'Exp None')

      const res = await download(owner.accessToken, owner.workspaceId)

      expect(res.status).toBe(200)
      expect(XLSX.read(res.body, { type: 'buffer' }).SheetNames).toEqual(['Flags', 'Decisions'])
      expect(sheetRows(res.body, 'Flags')).toHaveLength(1)
      expect(sheetRows(res.body, 'Decisions')).toHaveLength(1)
    })

    it('edge: a plain member can export, since members can already read every flag', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}exp-mem-owner@example.com`, 'Exp Member')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}exp-mem@example.com`)

      const res = await download(member.accessToken, owner.workspaceId)

      expect(res.status).toBe(200)
    })

    it('edge: the status filter narrows the export like it narrows the list', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}exp-status@example.com`, 'Exp Status')
      await seedComparedPair(owner, { po: 'PO-EXP-S', invoice: 'INV-EXP-S' })
      const listed = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/discrepancies`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)
      await request(app.getHttpServer())
        .patch(`/workspaces/${owner.workspaceId}/procurement/discrepancies/${listed.body.items[0].id}/dismiss`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)

      const open = await download(owner.accessToken, owner.workspaceId, '?status=open')
      const dismissed = await download(owner.accessToken, owner.workspaceId, '?status=dismissed')

      expect(sheetRows(open.body, 'Flags')).toHaveLength(3)
      expect(sheetRows(dismissed.body, 'Flags')).toHaveLength(2)
    })

    it('regression: the response is a private, non-sniffable, uncached xlsx attachment named by UTC date', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}exp-headers@example.com`, 'Exp Headers')
      const utcDay = () => new Date().toISOString().slice(0, 10)
      const before = utcDay()

      const res = await download(owner.accessToken, owner.workspaceId)

      const after = utcDay()
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain(XLSX_TYPE)
      expect([before, after].map((day) => `attachment; filename="optra-evidence-trail-${day}.xlsx"`)).toContain(
        res.headers['content-disposition'],
      )
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['cache-control']).toBe('private, no-store')
    })

    it('happy: exports flags with citations, a decision row with the actor email, and a formula SKU neutralised', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}exp-happy@example.com`, 'Exp Happy')
      await seedComparedPair(owner, { po: 'PO-EXP-H', invoice: 'INV-EXP-H' }, 'march-po.csv')
      const list = await request(app.getHttpServer())
        .get(`/workspaces/${owner.workspaceId}/procurement/discrepancies`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200)
      const price = list.body.items.find((flag: { flagType: string }) => flag.flagType === 'price_mismatch')
      const missing = list.body.items.find((flag: { flagType: string }) => flag.flagType === 'missing_on_po')
      await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/procurement/discrepancies/${price.id}/decisions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ outcome: 'approved_exception', note: 'Vendor agreed the new price.' })
        .expect(201)
      await db.update(discrepancyFlags).set({ sku: '=HYPERLINK("x")' }).where(eq(discrepancyFlags.id, missing.id))

      const res = await download(owner.accessToken, owner.workspaceId)

      expect(res.status).toBe(200)
      expect(XLSX.read(res.body, { type: 'buffer' }).SheetNames).toEqual(['Flags', 'Decisions'])
      const flags = sheetRows(res.body, 'Flags')
      const header = flags[0] as string[]
      expect(header.slice(0, 5)).toEqual(['Flag ID', 'Created (UTC ISO)', 'Type', 'Status', 'SKU'])
      expect(header).toContain('Latest decision')
      expect(flags).toHaveLength(4)
      const col = (row: unknown[], name: string) => row[header.indexOf(name)]
      const priceRow = flags.find((row) => row[0] === price.id) as unknown[]
      expect(col(priceRow, 'PO document')).toBe('march-po.csv')
      expect(col(priceRow, 'PO source')).toBe('row 2')
      expect(col(priceRow, 'Invoice source')).toBe('row 2')
      expect(col(priceRow, 'Latest decision')).toBe('approved exception')
      expect(col(priceRow, 'Decided by')).toBe(`${prefix}exp-happy@example.com`)
      const missingRow = flags.find((row) => row[0] === missing.id) as unknown[]
      expect(col(missingRow, 'SKU')).toBe(`'=HYPERLINK("x")`)
      const decisions = sheetRows(res.body, 'Decisions')
      expect(decisions[0]).toEqual(['Flag ID', 'SKU', 'Outcome', 'Note', 'By', 'Role', 'At (UTC ISO)'])
      expect(decisions).toHaveLength(2)
      expect(decisions[1].slice(0, 6)).toEqual([
        price.id,
        'A1',
        'approved exception',
        'Vendor agreed the new price.',
        `${prefix}exp-happy@example.com`,
        'owner',
      ])
    })
  })
})
