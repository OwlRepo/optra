import { Test } from '@nestjs/testing'
import { eq, like } from 'drizzle-orm'
import { RefineEmptyError, RefineRefusalError, refineMessage } from '@repo/ai'
import { db, pool, savedRefinedMessages, users, workspaceMembers, workspaces } from '@repo/db'
import { RefineService } from './refine.service'

jest.mock('@repo/ai', () => ({
  refineMessage: jest.fn(),
  RefineEmptyError: class RefineEmptyError extends Error {},
  RefineRefusalError: class RefineRefusalError extends Error {},
}))

async function cleanupRefineFixtures(prefix: string) {
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${prefix}%`))

  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    await db.delete(savedRefinedMessages).where(eq(savedRefinedMessages.userId, user.id))

    for (const membership of memberships) {
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspaceFixture(email: string, workspaceName: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', isVerified: true })
    .returning()
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: workspaceName, ownerId: user.id })
    .returning()

  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  })

  return { user, workspace }
}

describe('RefineService', () => {
  let service: RefineService
  const prefix = `refine-service-spec-${Date.now()}-`

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [RefineService],
    }).compile()

    service = moduleRef.get(RefineService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupRefineFixtures(prefix)
    await pool.end()
  })

  it('refine() returns the original and refined text on the happy path', async () => {
    ;(refineMessage as jest.Mock).mockResolvedValue('Refined question text')

    const result = await service.refine('raw rough question')

    expect(refineMessage).toHaveBeenCalledWith('raw rough question')
    expect(result).toEqual({ original: 'raw rough question', refined: 'Refined question text' })
  })

  it('propagates RefineEmptyError uncaught for the controller to map', async () => {
    ;(refineMessage as jest.Mock).mockRejectedValue(new RefineEmptyError())

    await expect(service.refine('raw')).rejects.toBeInstanceOf(RefineEmptyError)
  })

  it('propagates RefineRefusalError uncaught for the controller to map', async () => {
    ;(refineMessage as jest.Mock).mockRejectedValue(new RefineRefusalError())

    await expect(service.refine('raw')).rejects.toBeInstanceOf(RefineRefusalError)
  })

  it('saveRefinedMessage inserts a row scoped to workspaceId and userId', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}save@example.com`,
      'Refine Spec Save',
    )

    const saved = await service.saveRefinedMessage(workspace.id, user.id, {
      originalText: 'raw text',
      refinedText: 'clean text',
    })

    expect(saved.originalText).toBe('raw text')
    expect(saved.refinedText).toBe('clean text')
    expect(saved.id).toBeDefined()
    expect(saved.createdAt).toBeDefined()

    const [row] = await db
      .select()
      .from(savedRefinedMessages)
      .where(eq(savedRefinedMessages.id, saved.id))
      .limit(1)

    expect(row.workspaceId).toBe(workspace.id)
    expect(row.userId).toBe(user.id)
  })

  it('saveRefinedMessage round-trips text up to 4000 characters', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}roundtrip@example.com`,
      'Refine Spec Roundtrip',
    )
    const longText = 'x'.repeat(4000)

    const saved = await service.saveRefinedMessage(workspace.id, user.id, {
      originalText: longText,
      refinedText: longText,
    })

    expect(saved.originalText).toHaveLength(4000)
    expect(saved.refinedText).toHaveLength(4000)
  })

  it('listSavedRefinedMessages isolates by userId within the same workspace', async () => {
    const { user: userA, workspace } = await seedWorkspaceFixture(
      `${prefix}isolate-a@example.com`,
      'Refine Spec Isolate',
    )
    const [userB] = await db
      .insert(users)
      .values({ email: `${prefix}isolate-b@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: userB.id,
      role: 'member',
    })

    await service.saveRefinedMessage(workspace.id, userA.id, {
      originalText: 'a raw',
      refinedText: 'a refined',
    })
    await service.saveRefinedMessage(workspace.id, userB.id, {
      originalText: 'b raw',
      refinedText: 'b refined',
    })

    const aList = await service.listSavedRefinedMessages(workspace.id, userA.id)
    const bList = await service.listSavedRefinedMessages(workspace.id, userB.id)

    expect(aList.map((m) => m.refinedText)).toEqual(['a refined'])
    expect(bList.map((m) => m.refinedText)).toEqual(['b refined'])
  })

  it('listSavedRefinedMessages returns newest-first, capped at 20', async () => {
    const { user, workspace } = await seedWorkspaceFixture(
      `${prefix}cap@example.com`,
      'Refine Spec Cap',
    )

    for (let i = 0; i < 25; i += 1) {
      await db.insert(savedRefinedMessages).values({
        workspaceId: workspace.id,
        userId: user.id,
        originalText: `raw ${i}`,
        refinedText: `refined ${i}`,
        createdAt: new Date(Date.now() + i * 1000),
      })
    }

    const list = await service.listSavedRefinedMessages(workspace.id, user.id)

    expect(list).toHaveLength(20)
    expect(list[0]?.refinedText).toBe('refined 24')
    expect(list.at(-1)?.refinedText).toBe('refined 5')
  })

  it('listSavedRefinedMessages never returns another workspace’s rows for the same user', async () => {
    const { user, workspace: workspaceOne } = await seedWorkspaceFixture(
      `${prefix}cross-ws@example.com`,
      'Refine Spec Cross WS One',
    )
    const [workspaceTwo] = await db
      .insert(workspaces)
      .values({ name: 'Refine Spec Cross WS Two', ownerId: user.id })
      .returning()
    await db.insert(workspaceMembers).values({
      workspaceId: workspaceTwo.id,
      userId: user.id,
      role: 'owner',
    })

    await service.saveRefinedMessage(workspaceOne.id, user.id, {
      originalText: 'one raw',
      refinedText: 'one refined',
    })
    await service.saveRefinedMessage(workspaceTwo.id, user.id, {
      originalText: 'two raw',
      refinedText: 'two refined',
    })

    const listOne = await service.listSavedRefinedMessages(workspaceOne.id, user.id)
    const listTwo = await service.listSavedRefinedMessages(workspaceTwo.id, user.id)

    expect(listOne.map((m) => m.refinedText)).toEqual(['one refined'])
    expect(listTwo.map((m) => m.refinedText)).toEqual(['two refined'])

    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceTwo.id))
    await db.delete(workspaces).where(eq(workspaces.id, workspaceTwo.id))
  })
})
