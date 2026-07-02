import { randomUUID } from 'crypto'
import { Test } from '@nestjs/testing'
import { and, eq, like } from 'drizzle-orm'
import {
  db,
  pool,
  users,
  workspaceEvents,
  workspaceMembers,
  workspaces,
} from '@repo/db'
import { EventsService } from './events.service'

async function cleanupEventFixtures(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))

  for (const user of matches) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const membership of memberships) {
      await db.delete(workspaceEvents).where(eq(workspaceEvents.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  }

  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspaceFixture(prefix: string) {
  const [owner] = await db
    .insert(users)
    .values({ email: `${prefix}owner-${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [member] = await db
    .insert(users)
    .values({ email: `${prefix}member-${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()
  const [otherMember] = await db
    .insert(users)
    .values({ email: `${prefix}other-${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
    .returning()

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Events Spec WS ${Date.now()}`, ownerId: owner.id })
    .returning()

  await db.insert(workspaceMembers).values([
    { workspaceId: workspace.id, userId: owner.id, role: 'owner' },
    { workspaceId: workspace.id, userId: member.id, role: 'member' },
    { workspaceId: workspace.id, userId: otherMember.id, role: 'member' },
  ])

  return { workspace, owner, member, otherMember }
}

describe('EventsService', () => {
  let service: EventsService
  const prefix = `events-service-spec-${Date.now()}-`

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EventsService],
    }).compile()

    service = moduleRef.get(EventsService)
  })

  afterAll(async () => {
    await cleanupEventFixtures(prefix)
    await pool.end()
  })

  it('record inserts a workspace event row', async () => {
    const { workspace } = await seedWorkspaceFixture(prefix)
    const entityId = randomUUID()

    await service.record(workspace.id, 'document_ingested', entityId, 'Imported guide', 'done')

    const [event] = await db
      .select()
      .from(workspaceEvents)
      .where(and(eq(workspaceEvents.workspaceId, workspace.id), eq(workspaceEvents.entityId, entityId)))
      .limit(1)

    expect(event.type).toBe('document_ingested')
    expect(event.title).toBe('Imported guide')
    expect(event.detail).toBe('done')
  })

  it('lists newest-first with cursor pagination and no duplicates', async () => {
    const { workspace } = await seedWorkspaceFixture(prefix)

    const [older] = await db.insert(workspaceEvents).values({
      workspaceId: workspace.id,
      type: 'document_ingested',
      entityId: randomUUID(),
      title: 'Older event',
    }).returning()
    const [middle] = await db.insert(workspaceEvents).values({
      workspaceId: workspace.id,
      type: 'scrape_completed',
      entityId: randomUUID(),
      title: 'Middle event',
    }).returning()
    const [newer] = await db.insert(workspaceEvents).values({
      workspaceId: workspace.id,
      type: 'ticket_extracted',
      entityId: randomUUID(),
      title: 'Newer event',
    }).returning()

    await db.update(workspaceEvents).set({ createdAt: new Date('2026-07-02T00:00:01.000Z') }).where(eq(workspaceEvents.id, older.id))
    await db.update(workspaceEvents).set({ createdAt: new Date('2026-07-02T00:00:02.000Z') }).where(eq(workspaceEvents.id, middle.id))
    await db.update(workspaceEvents).set({ createdAt: new Date('2026-07-02T00:00:03.000Z') }).where(eq(workspaceEvents.id, newer.id))

    const firstPage = await service.list(workspace.id, { limit: 2 })
    expect(firstPage.items.map((event) => event.title)).toEqual(['Newer event', 'Middle event'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await service.list(workspace.id, { limit: 2, cursor: firstPage.nextCursor! })
    expect(secondPage.items.map((event) => event.title)).toEqual(['Older event'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('tracks unread count across null seen state, markSeen, and newly created events', async () => {
    const { workspace, member } = await seedWorkspaceFixture(prefix)

    await db.insert(workspaceEvents).values([
      {
        workspaceId: workspace.id,
        type: 'document_ingested',
        entityId: randomUUID(),
        title: 'Event A',
      },
      {
        workspaceId: workspace.id,
        type: 'scrape_completed',
        entityId: randomUUID(),
        title: 'Event B',
      },
    ])

    await expect(service.unreadCount(workspace.id, member.id)).resolves.toBe(2)

    await service.markSeen(workspace.id, member.id)
    await expect(service.unreadCount(workspace.id, member.id)).resolves.toBe(0)

    const entityId = randomUUID()
    await service.record(workspace.id, 'ticket_extracted', entityId, 'Event C')
    await db
      .update(workspaceEvents)
      .set({ createdAt: new Date(Date.now() + 1000) })
      .where(and(eq(workspaceEvents.workspaceId, workspace.id), eq(workspaceEvents.entityId, entityId)))
    await expect(service.unreadCount(workspace.id, member.id)).resolves.toBe(1)
  })

  it('markSeen only updates the caller membership row', async () => {
    const { workspace, member, otherMember } = await seedWorkspaceFixture(prefix)

    await service.markSeen(workspace.id, member.id)

    const [updatedMember] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, member.id)))
      .limit(1)
    const [untouchedMember] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, otherMember.id)))
      .limit(1)

    expect(updatedMember.eventsSeenAt).toBeTruthy()
    expect(untouchedMember.eventsSeenAt).toBeNull()
  })
})
