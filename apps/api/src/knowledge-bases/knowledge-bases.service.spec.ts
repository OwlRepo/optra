import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { and, eq, like } from 'drizzle-orm'
import { db, documents, knowledgeBases, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { KnowledgeBasesService } from './knowledge-bases.service'

async function cleanupKnowledgeBaseFixtures(emailPrefix: string) {
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${emailPrefix}%`))

  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      const kbs = await db
        .select({ id: knowledgeBases.id })
        .from(knowledgeBases)
        .where(eq(knowledgeBases.workspaceId, membership.workspaceId))

      for (const kb of kbs) {
        await db.delete(documents).where(eq(documents.knowledgeBaseId, kb.id))
      }

      await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, membership.workspaceId))
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  }

  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.name, 'KB Spec WS %'))

  for (const workspace of owned) {
    await db.delete(knowledgeBases).where(eq(knowledgeBases.workspaceId, workspace.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id))
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id))
  }

  await db.delete(users).where(like(users.email, `${emailPrefix}%`))
}

describe('KnowledgeBasesService', () => {
  let service: KnowledgeBasesService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [KnowledgeBasesService],
    }).compile()

    service = moduleRef.get(KnowledgeBasesService)
  })

  afterAll(async () => {
    await cleanupKnowledgeBaseFixtures('kb-spec-')
    await pool.end()
  })

  it('create inserts a KB scoped to the workspace', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `kb-spec-create-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS Create', ownerId: user.id })
      .returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    const kb = await service.create(workspace.id, 'Runbooks')

    expect(kb.workspaceId).toBe(workspace.id)
    expect(kb.name).toBe('Runbooks')
  })

  it('listForWorkspace returns only that workspace KBs', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `kb-spec-list-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [otherUser] = await db
      .insert(users)
      .values({ email: `kb-spec-list-other-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS List', ownerId: user.id })
      .returning()
    const [otherWorkspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS Other', ownerId: otherUser.id })
      .returning()

    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    await db.insert(workspaceMembers).values({
      workspaceId: otherWorkspace.id,
      userId: otherUser.id,
      role: 'owner',
    })

    const mine = await service.create(workspace.id, 'Mine KB')
    await service.create(otherWorkspace.id, 'Hidden KB')

    const list = await service.listForWorkspace(workspace.id, {})

    expect(list.items.map((kb) => kb.id)).toContain(mine.id)
    expect(list.items).toHaveLength(1)
    expect(list.nextCursor).toBeNull()
  })

  it('paginates workspace knowledge bases newest first with cursor', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `kb-spec-paginate-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS Paginate', ownerId: user.id })
      .returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    const older = await service.create(workspace.id, 'Older KB')
    const middle = await service.create(workspace.id, 'Middle KB')
    const newer = await service.create(workspace.id, 'Newer KB')

    await db.update(knowledgeBases).set({ createdAt: new Date('2026-07-01T00:00:01.000Z') }).where(eq(knowledgeBases.id, older.id))
    await db.update(knowledgeBases).set({ createdAt: new Date('2026-07-01T00:00:02.000Z') }).where(eq(knowledgeBases.id, middle.id))
    await db.update(knowledgeBases).set({ createdAt: new Date('2026-07-01T00:00:03.000Z') }).where(eq(knowledgeBases.id, newer.id))

    const firstPage = await service.listForWorkspace(workspace.id, { limit: 2 })

    expect(firstPage.items.map((kb) => kb.name)).toEqual(['Newer KB', 'Middle KB'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await service.listForWorkspace(workspace.id, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    })

    expect(secondPage.items.map((kb) => kb.name)).toEqual(['Older KB'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('rejects invalid knowledge base cursor', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `kb-spec-bad-cursor-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS Bad Cursor', ownerId: user.id })
      .returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    await expect(service.listForWorkspace(workspace.id, { cursor: '%%%bad%%%' })).rejects.toThrow(BadRequestException)
  })

  it('remove deletes an empty KB', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `kb-spec-remove-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS Remove', ownerId: user.id })
      .returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    const kb = await service.create(workspace.id, 'Empty KB')

    await expect(service.remove(workspace.id, kb.id)).resolves.toEqual({
      message: 'Knowledge base deleted',
    })

    const [deleted] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kb.id)).limit(1)
    expect(deleted).toBeUndefined()
  })

  it('remove throws ConflictException when KB has documents', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `kb-spec-nonempty-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS NonEmpty', ownerId: user.id })
      .returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    const kb = await service.create(workspace.id, 'NonEmpty KB')
    await db.insert(documents).values({
      workspaceId: workspace.id,
      knowledgeBaseId: kb.id,
      title: 'Seeded Doc',
      status: 'pending',
    })

    await expect(service.remove(workspace.id, kb.id)).rejects.toThrow(ConflictException)
  })

  it('remove throws NotFoundException for cross-workspace KB ids', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `kb-spec-cross-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [otherUser] = await db
      .insert(users)
      .values({ email: `kb-spec-cross-other-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS Cross', ownerId: user.id })
      .returning()
    const [otherWorkspace] = await db
      .insert(workspaces)
      .values({ name: 'KB Spec WS Cross Other', ownerId: otherUser.id })
      .returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    await db.insert(workspaceMembers).values({
      workspaceId: otherWorkspace.id,
      userId: otherUser.id,
      role: 'owner',
    })

    const otherKb = await service.create(otherWorkspace.id, 'Other Workspace KB')

    await expect(service.remove(workspace.id, otherKb.id)).rejects.toThrow(NotFoundException)
  })
})
