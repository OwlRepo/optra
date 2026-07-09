import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import {
  db,
  discrepancyFlags,
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
      await db.delete(purchaseOrders).where(eq(purchaseOrders.workspaceId, membership.workspaceId))
      await db.delete(invoices).where(eq(invoices.workspaceId, membership.workspaceId))
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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
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

    const poUpload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from(poCsv), 'po.csv')
      .expect(201)

    const invoiceUpload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/invoices`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
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
  })

  it('rejects non-CSV/XLSX uploads', async () => {
    const owner = await registerAndVerify(app, `${prefix}role-owner@example.com`, password)
    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body.items[0].id as string

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/procurement/purchase-orders`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from('not a spreadsheet'), 'malware.exe')
      .expect(400)
  })
})
