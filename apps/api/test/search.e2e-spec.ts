import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { eq, like } from 'drizzle-orm'
import request from 'supertest'
import { db, otps, pool, refreshTokens, users, workspaceMembers, workspaces } from '@repo/db'
import { AppModule } from '../src/app.module'
import { SearchService } from '../src/search/search.service'

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

describe('Search flow (e2e)', () => {
  let app: INestApplication
  const prefix = `e2e-search-${Date.now()}-`
  const password = 'password123'

  beforeAll(async () => {
    const search = {
      search: jest.fn().mockResolvedValue({ documents: [], tickets: [], chatMessages: [] }),
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SearchService)
      .useValue(search)
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

  it('non-members get 403 and members get grouped empty search shape', async () => {
    const owner = await registerAndVerify(app, `${prefix}owner@example.com`, password)
    const member = await registerAndVerify(app, `${prefix}member@example.com`, password)
    const outsider = await registerAndVerify(app, `${prefix}outsider@example.com`, password)

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.ownerId, owner.user.id)).limit(1)
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: member.user.id, role: 'member' })

    await request(app.getHttpServer())
      .get(`/workspaces/${workspace.id}/search`)
      .query({ q: 'otp' })
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403)

    const response = await request(app.getHttpServer())
      .get(`/workspaces/${workspace.id}/search`)
      .query({ q: 'otp' })
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)

    expect(response.body).toEqual({ documents: [], tickets: [], chatMessages: [] })
  })
})
