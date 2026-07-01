import { INestApplication, ValidationPipe } from '@nestjs/common'
import { getQueueToken } from '@nestjs/bull'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import {
  db,
  pool,
  tickets,
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

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(tickets).where(eq(tickets.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedUser(app: INestApplication, email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `${email} workspace`, ownerId: user.id })
    .returning()
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  })

  const jwtService = app.get(JwtService)
  const accessToken = jwtService.sign({ sub: user.id, email: user.email })

  return { user, workspace, accessToken }
}

describe('Tickets flow (e2e)', () => {
  let app: INestApplication
  let queue: { add: jest.Mock; getJob: jest.Mock; on: jest.Mock }
  const prefix = `e2e-tickets-${Date.now()}-`

  beforeAll(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'ticket-job-1' }),
      getJob: jest.fn().mockResolvedValue({ id: 'ticket-job-1' }),
      process: jest.fn(),
      on: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken('ticket-extraction-queue'))
      .useValue(queue)
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

  it('cross-workspace access gets 403 or 404', async () => {
    const owner = await seedUser(app, `${prefix}owner@example.com`)
    const outsider = await seedUser(app, `${prefix}outsider@example.com`)
    const ownerWorkspaceId = owner.workspace.id
    const outsiderWorkspaceId = outsider.workspace.id

    const created = await request(app.getHttpServer())
      .post(`/workspaces/${ownerWorkspaceId}/tickets`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ transcript: 'Customer says export hangs at 95 percent.' })
      .expect(202)

    await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/tickets`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    const outsiderTicket = await request(app.getHttpServer())
      .post(`/workspaces/${outsiderWorkspaceId}/tickets`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ transcript: 'Other workspace ticket.' })
      .expect(202)

    await request(app.getHttpServer())
      .get(`/workspaces/${ownerWorkspaceId}/tickets/${outsiderTicket.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404)
  })

  it('create, poll, patch feedback, and read back full ticket', async () => {
    const owner = await seedUser(app, `${prefix}flow-owner@example.com`)
    const coworker = await seedUser(app, `${prefix}flow-coworker@example.com`)
    const workspaceId = owner.workspace.id

    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: coworker.user.id,
      role: 'member',
    })

    const created = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/tickets`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ transcript: 'OTP verify sends user back to login.' })
      .expect(202)

    expect(created.body.status).toBe('pending')
    expect(queue.add).toHaveBeenCalled()

    const pendingList = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/tickets`)
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${coworker.accessToken}`)
      .expect(200)

    expect(pendingList.body.items[0].status).toBe('pending')
    expect(pendingList.body.nextCursor).toBeNull()

    await db
      .update(tickets)
      .set({
        status: 'done',
        title: 'OTP login loop',
        issueSummary: 'Users return to login after OTP verify.',
        reproSteps: '1. Verify OTP\n2. Watch redirect',
        severity: 'high',
        productArea: 'auth',
        hypothesizedRootCause: 'Cookie missing',
        nextAction: 'Trace verify cookie write',
        fieldConfidence: {
          title: 0.9,
          issueSummary: 0.9,
          reproSteps: 0.8,
          severity: 0.8,
          productArea: 0.8,
          hypothesizedRootCause: 0.7,
          nextAction: 0.8,
        },
      })
      .where(eq(tickets.id, created.body.id))

    const done = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${coworker.accessToken}`)
      .expect(200)

    expect(done.body.status).toBe('done')
    expect(done.body.title).toBe('OTP login loop')

    const patched = await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'OTP verification login loop',
        usefulness: 'useful',
        editState: 'accepted',
        feedbackNote: 'Ready for Linear',
      })
      .expect(200)

    expect(patched.body.title).toBe('OTP verification login loop')
    expect(patched.body.usefulness).toBe('useful')
    expect(patched.body.reviewedBy).toBe(owner.user.id)

    const readBack = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)

    expect(readBack.body.feedbackNote).toBe('Ready for Linear')
    expect(readBack.body.editState).toBe('accepted')
  })

  it('non-member cannot create ticket', async () => {
    const owner = await seedUser(app, `${prefix}owner2@example.com`)
    const outsider = await seedUser(app, `${prefix}outsider2@example.com`)
    const workspaceId = owner.workspace.id

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/tickets`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ transcript: 'Should not work' })
      .expect(403)
  })

  it('rejects oversized patch text fields with 400', async () => {
    const owner = await seedUser(app, `${prefix}maxlen-owner@example.com`)
    const workspaceId = owner.workspace.id

    const created = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/tickets`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ transcript: 'Length validation transcript' })
      .expect(202)

    await request(app.getHttpServer())
      .patch(`/workspaces/${workspaceId}/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        issueSummary: 'x'.repeat(4001),
      })
      .expect(400)
  })
})
