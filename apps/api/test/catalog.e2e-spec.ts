import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import cookieParser from 'cookie-parser'
import { mkdtemp, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
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
import { StorageObjectNotFoundError } from '../src/storage/storage.errors'
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

/**
 * A verified owner + workspace inserted directly, with the token minted the way
 * AuthService does. This file already spends the whole `/auth/register` budget
 * (5 per 10 minutes, auth.controller.ts:33); copied from procurement.e2e-spec.ts.
 */
async function seedOwnerWithWorkspace(app: INestApplication, email: string, workspaceName: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name: workspaceName, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

  const accessToken = app.get(JwtService).sign({ sub: user.id, email })
  return { user, workspaceId: workspace.id, accessToken }
}

/** A real `member` of someone else's workspace, so RolesGuard (not WorkspaceMemberGuard) is what refuses. */
async function seedMemberOfWorkspace(app: INestApplication, workspaceId: string, email: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: 'member' })
  const accessToken = app.get(JwtService).sign({ sub: user.id, email })
  return { user, accessToken }
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
  let storage: {
    save: jest.Mock
    getBuffer: jest.Mock
    getObject: jest.Mock
    getToTempFile: jest.Mock
    delete: jest.Mock
  }
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
        // What real storage throws now, not a generic Error.
        if (!body) throw new StorageObjectNotFoundError(key)
        return Buffer.from(body)
      }),
      getObject: jest.fn(async (key: string) => {
        const body = stored.get(key)
        if (!body) throw new StorageObjectNotFoundError(key)
        return { buffer: Buffer.from(body), contentType: null }
      }),
      getToTempFile: jest.fn(async (key: string) => {
        const body = stored.get(key)
        // What real storage throws now, not a generic Error.
        if (!body) throw new StorageObjectNotFoundError(key)
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

    const tooBig = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors/${vendorId}/catalogs`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.alloc(26 * 1024 * 1024, 'a'), 'too-big.csv')
      .expect(413)
    expect(tooBig.body.message).toMatch(/^File exceeds \d+MB upload limit$/)

    await waitForCatalogDone(uploadRes.body.id)

    const itemsRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/vendors/${vendorId}/catalogs/${uploadRes.body.id}/items`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(itemsRes.body).toHaveLength(2)
    expect(itemsRes.body[0].photoStorageKey).toBeTruthy()
    expect(itemsRes.body[0].sourcePageNumber).toBeNull()

    // The photo route end to end: bytes present -> served as a raster image;
    // bytes gone -> a 404 the UI can show, not a 500. The fetcher is stubbed,
    // so the object is written here the way the real one writes it.
    const photoKey = itemsRes.body[0].photoStorageKey as string
    const photoUrl = `/workspaces/${workspaceId}/catalog-items/${itemsRes.body[0].id}/photo`
    await storage.save(photoKey, Buffer.from('\x89PNG fake'), 'image/png')
    const photo = await request(app.getHttpServer())
      .get(photoUrl)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(photo.headers['content-type']).toBe('image/png')
    expect(photo.headers['x-content-type-options']).toBe('nosniff')
    await storage.delete(photoKey)
    const gonePhoto = await request(app.getHttpServer())
      .get(photoUrl)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404)
    expect(gonePhoto.body.message).toBe('Catalog item photo is missing')

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

  // S9. Recording an agreed price is a write; reading one is not — the same
  // split every other procurement and catalog route already makes.
  it('records a vendor price term as owner, reads it as a member, and refuses both across workspaces', async () => {
    const owner = await registerAndVerify(app, `${prefix}terms-owner@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}terms-outsider@example.com`, password)

    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body.items[0].id as string

    const vendorRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Cedar Supply Co' })
      .expect(201)
    const vendorId = vendorRes.body.id as string

    const created = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors/${vendorId}/price-terms`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        sku: 'LAP-9001',
        uom: 'each',
        unitPrice: '1250.00',
        currency: 'usd',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        sourceReference: 'MSA-2026-04 section 3',
      })
      .expect(201)
    expect(created.body.currency).toBe('USD')
    expect(created.body.skuKey).toBe('lap-9001')
    expect(created.body.effectiveTo).toBeNull()

    // A second price closes the first rather than sitting beside it.
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors/${vendorId}/price-terms`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        sku: 'LAP-9001',
        uom: 'each',
        unitPrice: '1310.00',
        currency: 'USD',
        effectiveFrom: '2026-07-01T00:00:00.000Z',
      })
      .expect(201)

    const listed = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/vendors/${vendorId}/price-terms`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(listed.body).toHaveLength(2)
    expect(listed.body[0].effectiveTo).toBeNull()
    expect(listed.body[1].effectiveTo).not.toBeNull()
    expect(listed.body[0].supersedesId).toBe(listed.body[1].id)

    // A malformed price is refused by validation, not by the database.
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors/${vendorId}/price-terms`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ sku: 'LAP-9001', unitPrice: 'free', currency: 'USD', effectiveFrom: '2026-08-01T00:00:00.000Z' })
      .expect(400)

    // An outsider is refused by WorkspaceMemberGuard on both verbs.
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/vendors/${vendorId}/price-terms`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/vendors/${vendorId}/price-terms`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ sku: 'X', unitPrice: '1.00', currency: 'USD', effectiveFrom: '2026-01-01T00:00:00.000Z' })
      .expect(403)

    // S9 commit 7. The three vendor reads, in the same test because registering
    // more users here trips the auth throttle that auth-rate-limit.e2e-spec
    // exists to protect.
    const got = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/vendors/${vendorId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(got.body.name).toBe('Cedar Supply Co')

    // A vendor nothing has been bought from reports an empty page and zeroes,
    // never an error: missing data is distinct from good performance.
    const history = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/vendors/${vendorId}/price-history`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(history.body.items).toEqual([])
    expect(history.body.total).toBe(0)
    expect(history.body.skus).toEqual([])

    const summary = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/vendors/${vendorId}/exception-summary`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(summary.body.openTotal).toBe(0)
    expect(summary.body.purchaseOrderCount).toBe(0)
    expect(summary.body.counts.contract_price_variance).toBe(0)

    for (const path of ['', '/price-history', '/exception-summary']) {
      await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/vendors/${vendorId}${path}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(403)
    }
  })

  describe('launch hardening', () => {
    async function createVendor(token: string, workspaceId: string, name: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/vendors`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name })
        .expect(201)
      return res.body.id as string
    }

    it('error: a member is refused every catalog write with 403 Insufficient workspace role', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-role-owner@example.com`, 'LH Role Owner')
      const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}lh-role-member@example.com`)
      const vendorId = await createVendor(owner.accessToken, owner.workspaceId, 'LH Role Vendor')
      const ws = `/workspaces/${owner.workspaceId}`
      const auth = `Bearer ${member.accessToken}`

      const upload = await request(app.getHttpServer())
        .post(`${ws}/vendors/${vendorId}/catalogs`)
        .set('Authorization', auth)
        .attach('file', Buffer.from('sku,description\nA1,Widget'), 'catalog.csv')
        .expect(403)
      const scrape = await request(app.getHttpServer())
        .post(`${ws}/vendors/${vendorId}/catalogs/scrape`)
        .set('Authorization', auth)
        .send({ seedUrl: 'https://vendor.example.com/' })
        .expect(403)
      const search = await request(app.getHttpServer())
        .post(`${ws}/catalog-matches/search`)
        .set('Authorization', auth)
        .send({ purchaseOrderLineItemId: randomUUID() })
        .expect(403)
      const verify = await request(app.getHttpServer())
        .post(`${ws}/vendors/${vendorId}/catalog-matches/verify`)
        .set('Authorization', auth)
        .send({ purchaseOrderLineItemId: randomUUID() })
        .expect(403)
      const dismiss = await request(app.getHttpServer())
        .patch(`${ws}/catalog-matches/${randomUUID()}/dismiss`)
        .set('Authorization', auth)
        .expect(403)

      for (const res of [upload, scrape, search, verify, dismiss]) {
        expect(res.body.message).toBe('Insufficient workspace role')
      }
      // Guards run before the file interceptor: nothing reached storage.
      expect(storage.save).not.toHaveBeenCalledWith(
        expect.stringContaining(`${owner.workspaceId}/catalogs/`),
        expect.anything(),
        expect.anything(),
      )
      // Reads stay open to a member.
      await request(app.getHttpServer()).get(`${ws}/vendors/${vendorId}/catalogs`).set('Authorization', auth).expect(200)
    })

    it('error: scraping the cloud metadata address is refused with 400 URL is not allowed and creates no catalog', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-ssrf@example.com`, 'LH SSRF')
      const vendorId = await createVendor(owner.accessToken, owner.workspaceId, 'LH SSRF Vendor')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${owner.workspaceId}/vendors/${vendorId}/catalogs/scrape`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seedUrl: 'http://169.254.169.254/' })
        .expect(400)

      expect(res.body.message).toBe('URL is not allowed')
      const rows = await db.select().from(catalogs).where(eq(catalogs.vendorId, vendorId))
      expect(rows).toHaveLength(0)
    })

    it("error: uploading a catalog under another workspace's vendor id is a 404 and stores nothing", async () => {
      const mine = await seedOwnerWithWorkspace(app, `${prefix}lh-vendor-mine@example.com`, 'LH Vendor Mine')
      const other = await seedOwnerWithWorkspace(app, `${prefix}lh-vendor-other@example.com`, 'LH Vendor Other')
      const foreignVendorId = await createVendor(other.accessToken, other.workspaceId, 'LH Foreign Vendor')

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${mine.workspaceId}/vendors/${foreignVendorId}/catalogs`)
        .set('Authorization', `Bearer ${mine.accessToken}`)
        .attach('file', Buffer.from('sku,description\nA1,Widget'), 'catalog.csv')
        .expect(404)

      expect(res.body.message).toBe('Vendor not found')
      expect(storage.save).not.toHaveBeenCalledWith(
        expect.stringContaining(`${mine.workspaceId}/catalogs/`),
        expect.anything(),
        expect.anything(),
      )
      const rows = await db.select().from(catalogs).where(eq(catalogs.vendorId, foreignVendorId))
      expect(rows).toHaveLength(0)
    })

    it('error: a malformed item, match or verify-vendor id is a 400 before any query runs', async () => {
      const owner = await seedOwnerWithWorkspace(app, `${prefix}lh-malformed@example.com`, 'LH Malformed')
      const ws = `/workspaces/${owner.workspaceId}`
      const auth = `Bearer ${owner.accessToken}`

      const photo = await request(app.getHttpServer())
        .get(`${ws}/catalog-items/not-a-uuid/photo`)
        .set('Authorization', auth)
        .expect(400)
      const dismiss = await request(app.getHttpServer())
        .patch(`${ws}/catalog-matches/not-a-uuid/dismiss`)
        .set('Authorization', auth)
        .expect(400)
      const verify = await request(app.getHttpServer())
        .post(`${ws}/vendors/not-a-uuid/catalog-matches/verify`)
        .set('Authorization', auth)
        .send({})
        .expect(400)

      for (const res of [photo, dismiss, verify]) {
        expect(res.body.message).toBe('Validation failed (uuid is expected)')
      }
    })
  })
})
