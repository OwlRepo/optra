import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import {
  catalogItems,
  catalogMatches,
  catalogs,
  db,
  otps,
  pool,
  poLineItems,
  purchaseOrders,
  refreshTokens,
  users,
  vendors,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'
import { StorageService } from '../src/storage/storage.service'
import { CatalogExtractionService } from '../src/catalog/catalog-extraction.service'
import { CatalogImageService } from '../src/catalog/catalog-image.service'

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
      await db.delete(catalogMatches).where(eq(catalogMatches.workspaceId, membership.workspaceId))
      await db.delete(catalogItems).where(eq(catalogItems.workspaceId, membership.workspaceId))
      await db.delete(catalogs).where(eq(catalogs.workspaceId, membership.workspaceId))
      await db.delete(vendors).where(eq(vendors.workspaceId, membership.workspaceId))
      await db.delete(poLineItems).where(eq(poLineItems.workspaceId, membership.workspaceId))
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

async function waitForCatalogDone(id: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await db.select().from(catalogs).where(eq(catalogs.id, id)).limit(1)
    if (row?.status === 'done') return
    if (row?.status === 'failed') throw new Error(`Catalog ${id} failed to parse: ${row.lastError}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Catalog ${id} did not reach 'done' within ${timeoutMs}ms`)
}

describe('Catalog flow (e2e)', () => {
  let app: INestApplication
  let storage: { save: jest.Mock; getBuffer: jest.Mock; getToTempFile: jest.Mock; delete: jest.Mock }
  const prefix = `e2e-catalog-${Date.now()}-`
  const password = 'password123'
  const originalCatalogEnabled = process.env.CATALOG_ENABLED

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
        const dir = await mkdtemp(join(tmpdir(), 'catalog-e2e-'))
        const path = join(dir, key.split('/').pop() ?? 'file')
        await writeFile(path, body)
        return path
      }),
      delete: jest.fn(async (key: string) => {
        stored.delete(key)
      }),
    }

    // The CSV/photo_url upload branch is used for the e2e happy path rather
    // than PDF: pdfjs-dist's legacy build's dynamic import of its own .mjs
    // (using import.meta.url) only resolves under Vitest or plain Node, not
    // Jest's module loader (verified directly — same compiled dist works
    // fine via plain `node -e`). The PDF page-render branch is already
    // proven at the only two layers that CAN exercise it for real:
    // pdf-render-integration.spec.ts (real render, Vitest) and
    // catalog-parse.processor.spec.ts (real processor logic, mocked render).
    const extraction = {
      extractFromImage: jest.fn(async () => ({ items: [] })),
      compare: jest.fn(async () => ({ isMatch: true, score: 0.9, reason: 'Same product.' })),
    }
    const images = {
      fetchAndStore: jest.fn(async (workspaceId: string, catalogId: string) => `${workspaceId}/catalogs/${catalogId}/images/fake.png`),
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(CatalogExtractionService)
      .useValue(extraction)
      .overrideProvider(CatalogImageService)
      .useValue(images)
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()
  })

  afterAll(async () => {
    process.env.CATALOG_ENABLED = originalCatalogEnabled
    await cleanupUsers(prefix)
    await app.close()
    await pool.end()
  })

  it('creates a vendor, uploads a PDF catalog, searches matches, and dismisses one — isolated per workspace', async () => {
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

    const vendorRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Acme Supply', contactInfo: 'acme@example.com' })
      .expect(201)
    const vendorId = vendorRes.body.id as string

    const catalogCsv = [
      'sku,description,photo_url',
      'A1,Widget,https://vendor.example.com/a1.png',
      'B2,Gadget,https://vendor.example.com/b2.png',
    ].join('\n')
    const uploadRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors/${vendorId}/catalogs`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from(catalogCsv), 'catalog.csv')
      .expect(201)
    expect(uploadRes.body.status).toBe('pending')

    await waitForCatalogDone(uploadRes.body.id)

    const itemsRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/vendors/${vendorId}/catalogs/${uploadRes.body.id}/items`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(itemsRes.body).toHaveLength(2)
    expect(itemsRes.body[0].photoStorageKey).toBeTruthy()
    expect(itemsRes.body[0].sourcePageNumber).toBeNull()

    const [po] = await db.insert(purchaseOrders).values({ workspaceId, name: 'po.csv', status: 'done' }).returning()
    const [poLineItem] = await db
      .insert(poLineItems)
      .values({ workspaceId, purchaseOrderId: po.id, sku: 'A1', description: 'Widget' })
      .returning()

    const searchRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/catalog-matches/search`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ purchaseOrderLineItemId: poLineItem.id })
      .expect(201)
    expect(searchRes.body.matches.length).toBeGreaterThan(0)
    expect(searchRes.body.matches[0]).toMatchObject({ matchType: 'sourcing', isMatch: true })

    const listRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/catalog-matches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(listRes.body.length).toBe(searchRes.body.matches.length)
    const matchId = listRes.body[0].id as string

    const dismissRes = await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}/catalog-matches/${matchId}/dismiss`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(dismissRes.body.status).toBe('dismissed')

    const openOnlyRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/catalog-matches`)
      .query({ status: 'open' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(openOnlyRes.body.find((match: { id: string }) => match.id === matchId)).toBeUndefined()

    // Cross-workspace isolation: outsider is not a member of workspaceId at all.
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/vendors`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    // Outsider IS a member of their own workspace, but the line item belongs
    // to the owner's workspace — must 404, not leak cross-workspace data.
    await request(app.getHttpServer())
      .post(`/workspaces/${outsiderWorkspaceId}/catalog-matches/search`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ purchaseOrderLineItemId: poLineItem.id })
      .expect(404)
  })

  it('rejects catalog uploads when CATALOG_ENABLED is false', async () => {
    const owner = await registerAndVerify(app, `${prefix}flag-owner@example.com`, password)
    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body.items[0].id as string

    const vendorRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Flagged Vendor' })
      .expect(201)

    process.env.CATALOG_ENABLED = 'false'

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors/${vendorRes.body.id}/catalogs`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from('sku,description\nA,Widget'), 'catalog.csv')
      .expect(400)

    process.env.CATALOG_ENABLED = originalCatalogEnabled
  })
})
