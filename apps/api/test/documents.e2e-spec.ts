import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { and, eq, like } from 'drizzle-orm'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import request from 'supertest'
import {
  db,
  documents,
  invitations,
  knowledgeBases,
  otps,
  pool,
  refreshTokens,
  users,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { AppModule } from '../src/app.module'
import { IngestService } from '../src/ingest/ingest.service'
import { StorageService } from '../src/storage/storage.service'

function binaryParser(res: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = []
  res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
  res.on('end', () => callback(null, Buffer.concat(chunks)))
  res.on('error', (error) => callback(error))
}

jest.mock('@repo/ai', () => ({
  loadDocument: jest.fn(),
  chunkDocument: jest.fn(),
  embedChunks: jest.fn(),
  syncChunks: jest.fn(),
}))

async function cleanupUsers(prefix: string) {
  const matches = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
    await db.delete(otps).where(eq(otps.userId, user.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(documents).where(eq(documents.workspaceId, membership.workspaceId))
      await db.delete(invitations).where(eq(invitations.workspaceId, membership.workspaceId))
      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
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

  return {
    user,
    accessToken: verifyRes.body.accessToken as string,
  }
}

describe('Documents flow (e2e)', () => {
  let app: INestApplication
  let ingest: { queueDocument: jest.Mock }
  let storage: {
    save: jest.Mock
    getBuffer: jest.Mock
    getToTempFile: jest.Mock
    delete: jest.Mock
  }
  const prefix = `e2e-docs-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    ingest = { queueDocument: jest.fn().mockResolvedValue({ queued: true }) }
    const stored = new Map<string, Buffer>()
    storage = {
      save: jest.fn(async (key: string, body: Buffer) => {
        stored.set(key, Buffer.from(body))
        return key
      }),
      getBuffer: jest.fn(async (key: string) => {
        const body = stored.get(key)
        if (!body) {
          throw new Error(`Missing stored object ${key}`)
        }
        return Buffer.from(body)
      }),
      getToTempFile: jest.fn(async (key: string) => {
        const body = stored.get(key)
        if (!body) {
          throw new Error(`Missing stored object ${key}`)
        }

        const dir = await mkdtemp(join(tmpdir(), 'docs-e2e-'))
        const path = join(dir, key.split('/').pop() ?? 'file')
        await writeFile(path, body)
        return path
      }),
      delete: jest.fn(async (key: string) => {
        if (!stored.has(key)) {
          throw new Error(`Missing stored object ${key}`)
        }

        stored.delete(key)
      }),
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IngestService)
      .useValue(ingest)
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupUsers(prefix)
    await app.close()
    await pool.end()
  })

  it('owner can upload/list/delete, member upload is forbidden, non-member list is forbidden, cross-workspace delete is 404', async () => {
    const owner = await registerAndVerify(app, `${prefix}owner@example.com`, password)
    const admin = await registerAndVerify(app, `${prefix}admin@example.com`, password)
    const member = await registerAndVerify(app, `${prefix}member@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)

    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const ownerWorkspaceId = ownerMine.body.items[0].id as string

    const outsiderMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(200)
    const outsiderWorkspaceId = outsiderMine.body.items[0].id as string

    const kbRes = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Docs KB' })
      .expect(201)
    const kbId = kbRes.body.id as string

    for (const invitee of [admin.user.email, member.user.email]) {
      await request(app.getHttpServer())
        .post(`/workspaces/${ownerWorkspaceId}/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invitee })
        .expect(201)

      const [invite] = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.workspaceId, ownerWorkspaceId), eq(invitations.email, invitee)))
        .limit(1)

      const token = invitee === admin.user.email ? admin.accessToken : member.accessToken
      await request(app.getHttpServer())
        .post(`/workspaces/accept-invite/${invite.token}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    }

    await db
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(and(eq(workspaceMembers.workspaceId, ownerWorkspaceId), eq(workspaceMembers.userId, admin.user.id)))

    const uploadRes = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .attach('file', Buffer.from('seaweed test doc'), 'test.txt')
      .expect(201)

    expect(uploadRes.body.status).toBe('pending')
    expect(ingest.queueDocument).toHaveBeenCalledWith(uploadRes.body.id)

    const [saved] = await db.select().from(documents).where(eq(documents.id, uploadRes.body.id)).limit(1)
    expect(saved.status).toBe('pending')

    const tempPath = await storage.getToTempFile(saved.storageKey!)
    await expect(readFile(tempPath, 'utf8')).resolves.toBe('seaweed test doc')
    await unlink(tempPath)
    await rm(join(tempPath, '..'), { recursive: true, force: true })

    await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .attach('file', Buffer.from('blocked'), 'blocked.txt')
      .expect(403)

    await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    const secondUpload = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .attach('file', Buffer.from('second doc'), 'second.txt')
      .expect(201)

    const thirdUpload = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .attach('file', Buffer.from('third doc'), 'third.txt')
      .expect(201)

    const listRes = await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .query({ page: 1, pageSize: 2 })
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(listRes.body.items).toHaveLength(2)
    expect(listRes.body.items[0].id).toBe(thirdUpload.body.id)
    expect(listRes.body.items[1].id).toBe(secondUpload.body.id)
    expect(listRes.body.page).toBe(1)
    expect(listRes.body.pageSize).toBe(2)
    expect(listRes.body.total).toBe(3)
    expect(listRes.body.totalPages).toBe(2)

    const pageTwoRes = await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .query({ page: 2, pageSize: 2 })
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(pageTwoRes.body.items).toHaveLength(1)
    expect(pageTwoRes.body.items[0].id).toBe(uploadRes.body.id)
    expect(pageTwoRes.body.page).toBe(2)

    const singleDownload = await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents/${uploadRes.body.id}/download`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    expect(singleDownload.headers['content-disposition']).toBe('attachment; filename="test.txt"')
    expect(singleDownload.body.toString()).toBe('seaweed test doc')

    const bulkDownload = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents/download`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ documentIds: [uploadRes.body.id, secondUpload.body.id] })
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
    expect(bulkDownload.headers['content-type']).toContain('application/zip')
    expect(bulkDownload.headers['content-disposition']).toBe('attachment; filename="documents.zip"')
    expect(bulkDownload.body.subarray(0, 2).toString()).toBe('PK')

    const outsiderKbRes = await request(app.getHttpServer())
      .post(`/workspaces/${outsiderWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ name: 'Outsider KB' })
      .expect(201)

    const foreignUpload = await request(app.getHttpServer())
      .post(`/workspaces/${outsiderWorkspaceId}/knowledge-bases/${outsiderKbRes.body.id}/documents`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .attach('file', Buffer.from('other workspace'), 'other.txt')
      .expect(201)

    await request(app.getHttpServer())
      .delete(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents/${foreignUpload.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404)

    await request(app.getHttpServer())
      .delete(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    await expect(storage.getToTempFile(saved.storageKey!)).rejects.toThrow()
  })

  it('rejects oversized and disallowed uploads, allows supported small txt upload', async () => {
    const owner = await registerAndVerify(app, `${prefix}limits@example.com`, password)

    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = ownerMine.body.items[0].id as string

    const kbRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Upload Limits KB' })
      .expect(201)
    const kbId = kbRes.body.id as string

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.alloc(26 * 1024 * 1024, 'a'), 'too-big.txt')
      .expect(413)

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from('bad'), 'malware.exe')
      .expect(400)

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from('allowed text'), 'allowed.txt')
      .expect(201)
  })
})
