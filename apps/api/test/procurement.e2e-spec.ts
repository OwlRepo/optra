import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
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
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'
import { StorageService } from '../src/storage/storage.service'
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
        if (!body) throw new Error(`Missing stored object ${key}`)
        return Buffer.from(body)
      }),
      getToTempFile: jest.fn(async (key: string) => {
        const body = stored.get(key)
        if (!body) throw new Error(`Missing stored object ${key}`)
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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(ProcurementExtractionService)
      .useValue(extraction)
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
    })

    const listRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ purchaseOrderId: poUpload.body.id, invoiceId: invoiceUpload.body.id })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    expect(listRes.body).toHaveLength(4)
    const flagId = listRes.body[0].id as string

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
    expect(openOnlyRes.body).toHaveLength(3)

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
    const foreignFlagId = openOnlyRes.body[0].id as string
    await request(app.getHttpServer())
      .patch(`/workspaces/${outsiderWorkspaceId}/procurement/discrepancies/${foreignFlagId}/dismiss`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(404)
    const afterForeignDismiss = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ status: 'open' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(afterForeignDismiss.body.map((flag: { id: string }) => flag.id)).toContain(foreignFlagId)

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
    expect(afterRerun.body).toHaveLength(4)
    expect(
      afterRerun.body.every((flag: { comparisonRunId: string }) => flag.comparisonRunId === secondCompare.body.runId),
    ).toBe(true)

    const history = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ runId: compareRes.body.runId })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(history.body).toHaveLength(4)
    expect(history.body.filter((flag: { status: string }) => flag.status === 'dismissed')).toHaveLength(1)

    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/procurement/discrepancies`)
      .query({ runId: 'not-a-uuid' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400)

    // S2: decisions are append-only, role-gated on write, readable by members.
    const currentFlagId = afterRerun.body[0].id as string

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
  })
})
