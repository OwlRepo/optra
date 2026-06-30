import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { and, eq, like } from 'drizzle-orm'
import { readFile, unlink } from 'fs/promises'
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
  let storage: StorageService
  let ingest: { queueDocument: jest.Mock }
  const prefix = `e2e-docs-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    ingest = { queueDocument: jest.fn().mockResolvedValue({ queued: true }) }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IngestService)
      .useValue(ingest)
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    await app.init()
    storage = app.get(StorageService)
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
    const ownerWorkspaceId = ownerMine.body[0].id as string

    const outsiderMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(200)
    const outsiderWorkspaceId = outsiderMine.body[0].id as string

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

    await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .attach('file', Buffer.from('blocked'), 'blocked.txt')
      .expect(403)

    await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    const listRes = await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}/documents`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(listRes.body).toHaveLength(1)
    expect(listRes.body[0].id).toBe(uploadRes.body.id)

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
})
