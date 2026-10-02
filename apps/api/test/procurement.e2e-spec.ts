import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { and, eq, like } from 'drizzle-orm'
import request from 'supertest'
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
  users,
  workspaceEvents,
  workspaceMembers,
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
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: every download route answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['get', `purchase-orders/${anyId}/download`],
        ['get', `invoices/${anyId}/download`],
        ['get', `goods-receipts/${anyId}/download`],
      ]

      expect(await answersWithoutToken(routes)).toEqual(unauthorized(routes))
    })

    it('error: every discrepancy action answers 401 without a token', async () => {
      const routes: [Method, string][] = [
        ['post', 'discrepancies/compare'],
        ['patch', `discrepancies/${anyId}/dismiss`],
        ['post', `discrepancies/${anyId}/decisions`],
        ['get', `discrepancies/${anyId}/decisions`],
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
})
