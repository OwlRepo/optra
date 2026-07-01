import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { and, eq, like } from 'drizzle-orm'
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
      const kbs = await db
        .select({ id: knowledgeBases.id })
        .from(knowledgeBases)
        .where(eq(knowledgeBases.workspaceId, membership.workspaceId))

      for (const kb of kbs) {
        await db.delete(documents).where(eq(documents.knowledgeBaseId, kb.id))
      }

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

describe('Knowledge bases flow (e2e)', () => {
  let app: INestApplication
  const prefix = `e2e-kb-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
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

  it('owner/admin can create, member can list but not create, non-member gets 403, delete empty is 200, non-empty is 409, cross-workspace delete is 404', async () => {
    const owner = await registerAndVerify(app, `${prefix}owner@example.com`, password)
    const member = await registerAndVerify(app, `${prefix}member@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)

    const ownerMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const ownerWorkspaceId = ownerMine.body.items[0].id as string

    const memberMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    const memberOwnWorkspaceId = memberMine.body.items[0].id as string

    const outsiderMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(200)
    const outsiderWorkspaceId = outsiderMine.body.items[0].id as string

    const createRes = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Runbooks' })
      .expect(201)
    const kbId = createRes.body.id as string

    await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/invite`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: member.user.email })
      .expect(201)

    const [invite] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.workspaceId, ownerWorkspaceId), eq(invitations.email, member.user.email)))
      .limit(1)

    await request(app.getHttpServer())
      .post(`/workspaces/accept-invite/${invite.token}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'How-to' })
      .expect(201)

    await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Playbooks' })
      .expect(201)

    const pageOne = await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(pageOne.body.items).toHaveLength(2)
    expect(pageOne.body.nextCursor).toEqual(expect.any(String))

    const pageTwo = await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .query({ limit: 2, cursor: pageOne.body.nextCursor })
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(pageTwo.body.items).toHaveLength(1)
    expect(pageTwo.body.nextCursor).toBeNull()

    await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ name: 'Blocked' })
      .expect(403)

    await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    await request(app.getHttpServer())
      .delete(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${kbId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    const nonEmptyRes = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Seeded KB' })
      .expect(201)
    const nonEmptyKbId = nonEmptyRes.body.id as string

    await db.insert(documents).values({
      workspaceId: ownerWorkspaceId,
      knowledgeBaseId: nonEmptyKbId,
      title: 'Doc',
      status: 'pending',
    })

    await request(app.getHttpServer())
      .delete(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${nonEmptyKbId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(409)

    const foreignKbRes = await request(app.getHttpServer())
      .post(`/workspaces/${outsiderWorkspaceId}/knowledge-bases`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ name: 'Outsider KB' })
      .expect(201)

    const foreignKbId = foreignKbRes.body.id as string

    await request(app.getHttpServer())
      .delete(`/workspaces/${ownerWorkspaceId}/knowledge-bases/${foreignKbId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404)
  })
})
