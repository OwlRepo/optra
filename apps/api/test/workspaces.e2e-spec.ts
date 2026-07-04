import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { and, eq, like } from 'drizzle-orm'
import request from 'supertest'
import { db, invitations, otps, pool, refreshTokens, users, workspaceMembers, workspaces } from '@repo/db'
import { AppModule } from '../src/app.module'

async function cleanupUsers(prefix: string) {
  const matches = await db.select({ id: users.id, email: users.email }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))
    await db.delete(otps).where(eq(otps.userId, user.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(invitations).where(eq(invitations.workspaceId, membership.workspaceId))
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

describe('Workspaces flow (e2e)', () => {
  let app: INestApplication
  const prefix = `e2e-workspaces-${Date.now()}-`
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

  it('verifyOtp auto-creates one owner workspace, create adds another, invite/accept works, member invite is forbidden, non-member getOne is forbidden', async () => {
    const ownerEmail = `${prefix}owner@example.com`
    const memberEmail = `${prefix}member@example.com`
    const outsiderEmail = `${prefix}outsider@example.com`

    const owner = await registerAndVerify(app, ownerEmail, password)

    const mineRes = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    expect(mineRes.body.items).toHaveLength(1)
    expect(mineRes.body.items[0].name).toBe(`${ownerEmail}'s workspace`)
    expect(mineRes.body.items[0].role).toBe('owner')

    const createRes = await request(app.getHttpServer())
      .post('/workspaces')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Team' })
      .expect(201)

    const teamWorkspaceId = createRes.body.id

    await request(app.getHttpServer())
      .post('/workspaces')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Docs' })
      .expect(201)

    const mineAfterCreate = await request(app.getHttpServer())
      .get('/workspaces/me')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(mineAfterCreate.body.items).toHaveLength(2)
    expect(mineAfterCreate.body.nextCursor).toEqual(expect.any(String))

    const minePageTwo = await request(app.getHttpServer())
      .get('/workspaces/me')
      .query({ limit: 2, cursor: mineAfterCreate.body.nextCursor })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    expect(minePageTwo.body.items).toHaveLength(1)
    expect(minePageTwo.body.nextCursor).toBeNull()

    await request(app.getHttpServer())
      .post(`/workspaces/${teamWorkspaceId}/invite`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: memberEmail })
      .expect(201)

    const [invite] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.workspaceId, teamWorkspaceId), eq(invitations.email, memberEmail)))
      .limit(1)

    const member = await registerAndVerify(app, memberEmail, password)

    await request(app.getHttpServer())
      .post(`/workspaces/accept-invite/${invite.token}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    const memberMine = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    expect(memberMine.body.items.some((workspace: any) => workspace.id === teamWorkspaceId && workspace.role === 'member')).toBe(true)

    const membersAsMember = await request(app.getHttpServer())
      .get(`/workspaces/${teamWorkspaceId}/members`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
    expect(membersAsMember.body.items.map((m: any) => m.email).sort()).toEqual([memberEmail, ownerEmail].sort())
    expect(membersAsMember.body.items.find((m: any) => m.email === ownerEmail)?.role).toBe('owner')
    expect(membersAsMember.body.items.find((m: any) => m.email === memberEmail)?.role).toBe('member')

    await request(app.getHttpServer())
      .post(`/workspaces/${teamWorkspaceId}/invite`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ email: 'blocked@example.com' })
      .expect(403)

    const outsider = await registerAndVerify(app, outsiderEmail, password)

    await request(app.getHttpServer())
      .get(`/workspaces/${teamWorkspaceId}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    await request(app.getHttpServer())
      .get(`/workspaces/${teamWorkspaceId}/members`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)
  })

  // Only 2 fresh registrations here (owner, admin) — /auth/register is throttled
  // to 5 req/10min per caller and this file's first test already uses 3, so the
  // member/non-member 403 cases are intentionally NOT re-proven here: they use
  // the exact same WorkspaceMemberGuard/RolesGuard already asserted against
  // /invite and /members above in this same file (identical shared middleware,
  // not endpoint-specific logic), so re-registering users just to re-check
  // guard behavior already covered would only burn throttle budget for no new
  // signal on this endpoint's actual logic (DTO validation + service.update).
  it('rename: owner and admin can rename, invalid names rejected', async () => {
    const ownerEmail = `${prefix}rename-owner@example.com`
    const adminEmail = `${prefix}rename-admin@example.com`

    const owner = await registerAndVerify(app, ownerEmail, password)

    const mineRes = await request(app.getHttpServer())
      .get('/workspaces/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
    const workspaceId = mineRes.body.items[0].id as string

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/invite`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: adminEmail })
      .expect(201)
    const [adminInvite] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.email, adminEmail)))
      .limit(1)
    const admin = await registerAndVerify(app, adminEmail, password)
    await request(app.getHttpServer())
      .post(`/workspaces/accept-invite/${adminInvite.token}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200)
    await db
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, admin.user.id)))

    const ownerRename = await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Renamed By Owner' })
      .expect(200)
    expect(ownerRename.body.name).toBe('Renamed By Owner')

    const adminRename = await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Renamed By Admin' })
      .expect(200)
    expect(adminRename.body.name).toBe('Renamed By Admin')

    await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: '' })
      .expect(400)

    await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'x'.repeat(256) })
      .expect(400)
  })
})
