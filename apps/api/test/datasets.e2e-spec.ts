import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq, inArray, like } from 'drizzle-orm'
import request from 'supertest'
import { datasets, db, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { AppModule } from '../src/app.module'
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter'
import { DatasetProfilingService } from '../src/datasets/dataset-profiling.service'
import { StorageService } from '../src/storage/storage.service'
import { StorageObjectNotFoundError } from '../src/storage/storage.errors'

// Datasets had no e2e suite at all: upload, list and delete were covered only
// by service specs with a mocked database boundary. This drives them over HTTP
// through the real guards, pipes and filters.
//
// Profiling is stubbed at the enqueue: the processor calls a model to describe
// the dataset, and this suite is about what reaches storage and who may touch
// it. The browser suite (apps/e2e/tests/datasets.spec.ts) runs profiling for
// real against the OpenAI stub.

/** Verified user + owned workspace, token minted as AuthService does. See procurement.e2e-spec.ts. */
async function seedOwnerWithWorkspace(app: INestApplication, email: string, workspaceName: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name: workspaceName, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  return { user, workspaceId: workspace.id, accessToken: app.get(JwtService).sign({ sub: user.id, email }) }
}

async function seedMemberOfWorkspace(app: INestApplication, workspaceId: string, email: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: 'member' })
  return { user, accessToken: app.get(JwtService).sign({ sub: user.id, email }) }
}

describe('Datasets (e2e)', () => {
  let app: INestApplication
  const stored = new Map<string, Buffer>()
  const storage = {
    save: jest.fn(async (key: string, body: Buffer) => {
      stored.set(key, Buffer.from(body))
      return key
    }),
    getToTempFile: jest.fn(async (key: string) => {
      throw new StorageObjectNotFoundError(key)
    }),
    // Real S3 DeleteObject succeeds on a missing key; so does this.
    delete: jest.fn(async (key: string) => {
      stored.delete(key)
    }),
  }
  const profiling = { queueDataset: jest.fn().mockResolvedValue({ queued: true }) }
  const prefix = `e2e-datasets-${Date.now()}-`
  const csv = 'region,revenue\nNorth,1200\nSouth,800\n'

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(DatasetProfilingService)
      .useValue(profiling)
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    app.useGlobalFilters(new AllExceptionsFilter())
    await app.init()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    const seeded = await db.select().from(users).where(like(users.email, `${prefix}%`))
    const userIds = seeded.map((user) => user.id)
    if (userIds.length > 0) {
      const owned = await db.select().from(workspaces).where(inArray(workspaces.ownerId, userIds))
      const workspaceIds = owned.map((workspace) => workspace.id)
      if (workspaceIds.length > 0) {
        await db.delete(datasets).where(inArray(datasets.workspaceId, workspaceIds))
        await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds))
        await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds))
      }
      await db.delete(workspaceMembers).where(inArray(workspaceMembers.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    await app.close()
    await pool.end()
  })

  it('an owner uploads, lists and deletes a dataset, and its stored file goes with it', async () => {
    const owner = await seedOwnerWithWorkspace(app, `${prefix}owner@example.com`, 'Datasets E2E')

    const upload = await request(app.getHttpServer())
      .post(`/workspaces/${owner.workspaceId}/datasets`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from(csv), 'sales.csv')
      .expect(201)
    expect(upload.body).toEqual({ id: expect.any(String), name: 'sales.csv', status: 'pending' })
    expect(profiling.queueDataset).toHaveBeenCalledWith(upload.body.id)

    const [row] = await db.select().from(datasets).where(eq(datasets.id, upload.body.id))
    expect(row.storageKey).toMatch(new RegExp(`^${owner.workspaceId}/datasets/`))
    expect(stored.get(row.storageKey!)?.toString()).toBe(csv)

    const list = await request(app.getHttpServer())
      .get(`/workspaces/${owner.workspaceId}/datasets`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(list.body.map((dataset: { id: string }) => dataset.id)).toEqual([upload.body.id])
    // The key is internal; the list never carries it.
    expect(JSON.stringify(list.body)).not.toContain(row.storageKey!)

    await request(app.getHttpServer())
      .delete(`/workspaces/${owner.workspaceId}/datasets/${upload.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(storage.delete).toHaveBeenCalledWith(row.storageKey)
    expect(stored.has(row.storageKey!)).toBe(false)
    expect(await db.select().from(datasets).where(eq(datasets.id, upload.body.id))).toHaveLength(0)
  })

  it('refuses the wrong type, a missing file, a member, a stranger and a malformed id', async () => {
    const owner = await seedOwnerWithWorkspace(app, `${prefix}guard-owner@example.com`, 'Datasets E2E Guards')
    const member = await seedMemberOfWorkspace(app, owner.workspaceId, `${prefix}guard-member@example.com`)
    const stranger = await seedOwnerWithWorkspace(app, `${prefix}guard-stranger@example.com`, 'Datasets E2E Other')
    const base = `/workspaces/${owner.workspaceId}/datasets`

    const wrongType = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from('MZ'), 'payload.exe')
      .expect(400)
    expect(wrongType.body.message).toBe('Only CSV or XLSX files are supported for datasets')

    await request(app.getHttpServer()).post(base).set('Authorization', `Bearer ${owner.accessToken}`).expect(400)

    const tooBig = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.alloc(26 * 1024 * 1024, 'a'), 'too-big.csv')
      .expect(413)
    expect(tooBig.body.message).toMatch(/^File exceeds \d+MB upload limit$/)

    // A member reads but does not write.
    await request(app.getHttpServer()).get(base).set('Authorization', `Bearer ${member.accessToken}`).expect(200)
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .attach('file', Buffer.from(csv), 'member.csv')
      .expect(403)

    const upload = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from(csv), 'kept.csv')
      .expect(201)

    await request(app.getHttpServer())
      .delete(`${base}/${upload.body.id}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(403)

    // A stranger is refused at the door of workspace A, and addressing A's
    // dataset from their own workspace finds nothing - a 404, never a 403, so
    // the id cannot even be confirmed to exist.
    await request(app.getHttpServer()).get(base).set('Authorization', `Bearer ${stranger.accessToken}`).expect(403)
    await request(app.getHttpServer())
      .delete(`/workspaces/${stranger.workspaceId}/datasets/${upload.body.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404)
    expect(await db.select().from(datasets).where(eq(datasets.id, upload.body.id))).toHaveLength(1)

    // A malformed id is a client error, not a uuid-cast failure in Postgres.
    await request(app.getHttpServer())
      .delete(`${base}/not-a-uuid`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400)
  })
})
