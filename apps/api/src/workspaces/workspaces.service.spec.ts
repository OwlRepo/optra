import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { and, eq, like } from 'drizzle-orm'
import { db, invitations, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { NotificationsService } from '../notifications/notifications.service'
import { WorkspacesService } from './workspaces.service'

async function cleanupWorkspaceFixtures(emailPrefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${emailPrefix}%`))

  for (const user of testUsers) {
    const memberRows = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))

    for (const row of memberRows) {
      await db.delete(invitations).where(eq(invitations.workspaceId, row.workspaceId))
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
  }

  const owned = await db.select({ id: workspaces.id }).from(workspaces).where(like(workspaces.name, 'Spec WS %'))
  for (const workspace of owned) {
    await db.delete(invitations).where(eq(invitations.workspaceId, workspace.id))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id))
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id))
  }

  await db.delete(users).where(like(users.email, `${emailPrefix}%`))
}

describe('WorkspacesService', () => {
  let service: WorkspacesService
  let notifications: { sendInvite: jest.Mock }

  beforeAll(async () => {
    notifications = { sendInvite: jest.fn().mockResolvedValue(undefined) }

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        WorkspacesService,
        { provide: NotificationsService, useValue: notifications },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
      ],
    }).compile()

    service = moduleRef.get(WorkspacesService)
  })

  afterAll(async () => {
    await cleanupWorkspaceFixtures('workspaces-spec-')
    await pool.end()
  })

  it('create inserts a workspace and owner membership', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `workspaces-spec-create-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()

    const workspace = await service.create(user.id, 'Spec WS Create')
    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, user.id)))
      .limit(1)

    expect(workspace.name).toBe('Spec WS Create')
    expect(membership.role).toBe('owner')
  })

  it('listForUser returns only workspaces the user belongs to, with role', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `workspaces-spec-list-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [other] = await db
      .insert(users)
      .values({ email: `workspaces-spec-list-other-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()

    const mine = await service.create(user.id, 'Spec WS Mine')
    const hidden = await service.create(other.id, 'Spec WS Hidden')

    const list = await service.listForUser(user.id, {})

    expect(list.items.map((w: any) => w.id)).toContain(mine.id)
    expect(list.items.map((w: any) => w.id)).not.toContain(hidden.id)
    expect(list.items.find((w: any) => w.id === mine.id)?.role).toBe('owner')
    expect(list.nextCursor).toBeNull()
  })

  it('paginates workspaces newest first with cursor', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `workspaces-spec-paginate-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()

    const older = await service.create(user.id, 'Spec WS Older')
    const middle = await service.create(user.id, 'Spec WS Middle')
    const newer = await service.create(user.id, 'Spec WS Newer')

    await db.update(workspaces).set({ createdAt: new Date('2026-07-01T00:00:01.000Z') }).where(eq(workspaces.id, older.id))
    await db.update(workspaces).set({ createdAt: new Date('2026-07-01T00:00:02.000Z') }).where(eq(workspaces.id, middle.id))
    await db.update(workspaces).set({ createdAt: new Date('2026-07-01T00:00:03.000Z') }).where(eq(workspaces.id, newer.id))

    const firstPage = await service.listForUser(user.id, { limit: 2 })

    expect(firstPage.items.map((workspace: any) => workspace.name)).toEqual(['Spec WS Newer', 'Spec WS Middle'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await service.listForUser(user.id, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    })

    expect(secondPage.items.map((workspace: any) => workspace.name)).toEqual(['Spec WS Older'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('invite inserts an invitation and calls notifications.sendInvite', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `workspaces-spec-invite-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const workspace = await service.create(user.id, 'Spec WS Invite')

    const result = await service.invite(workspace.id, 'invitee@example.com')
    const [invite] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.workspaceId, workspace.id), eq(invitations.email, 'invitee@example.com')))
      .limit(1)

    expect(result.message).toMatch(/invite/i)
    expect(invite.token).toBeDefined()
    expect(notifications.sendInvite).toHaveBeenCalled()
  })

  it('acceptInvite adds member and marks invitation accepted', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-accept-owner-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [invitee] = await db
      .insert(users)
      .values({ email: `workspaces-spec-accept-user-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const workspace = await service.create(owner.id, 'Spec WS Accept')
    await service.invite(workspace.id, invitee.email)
    const [invite] = await db.select().from(invitations).where(eq(invitations.email, invitee.email)).limit(1)

    const joined = await service.acceptInvite(invitee.id, invitee.email, invite.token)
    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, invitee.id)))
      .limit(1)
    const [updatedInvite] = await db.select().from(invitations).where(eq(invitations.id, invite.id)).limit(1)

    expect(joined.id).toBe(workspace.id)
    expect(membership.role).toBe('member')
    expect(updatedInvite.acceptedAt).toBeTruthy()
  })

  it('acceptInvite rejects expired, already accepted, and unknown tokens', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-reject-owner-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [invitee] = await db
      .insert(users)
      .values({ email: `workspaces-spec-reject-user-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const workspace = await service.create(owner.id, 'Spec WS Reject')
    await service.invite(workspace.id, invitee.email)
    const [invite] = await db.select().from(invitations).where(eq(invitations.email, invitee.email)).limit(1)

    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, invite.id))
    await expect(service.acceptInvite(invitee.id, invitee.email, invite.token)).rejects.toThrow(BadRequestException)

    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), acceptedAt: new Date() })
      .where(eq(invitations.id, invite.id))
    await expect(service.acceptInvite(invitee.id, invitee.email, invite.token)).rejects.toThrow(BadRequestException)

    await expect(service.acceptInvite(invitee.id, invitee.email, 'missing-token')).rejects.toThrow(NotFoundException)
  })

  it('removeMember deletes a non-owner member', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-remove-owner-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [member] = await db
      .insert(users)
      .values({ email: `workspaces-spec-remove-member-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const workspace = await service.create(owner.id, 'Spec WS Remove')
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: member.id, role: 'member' })

    await expect(service.removeMember(workspace.id, member.id)).resolves.toEqual({ message: 'Member removed' })

    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, member.id)))
      .limit(1)
    expect(membership).toBeUndefined()
  })

  it('blocks removing the last owner', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-last-owner-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const workspace = await service.create(owner.id, 'Spec WS Last Owner')

    await expect(service.removeMember(workspace.id, owner.id)).rejects.toThrow(ForbiddenException)
  })

  it('listMembers returns the offset page shape, scoped to the workspace, with roles', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-owner-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [member] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-member-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [otherOwner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-other-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()

    const workspace = await service.create(owner.id, 'Spec WS Members')
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: member.id, role: 'member' })
    const otherWorkspace = await service.create(otherOwner.id, 'Spec WS Members Other')

    const list = await service.listMembers(workspace.id, {})

    expect(list.items.map((m: any) => m.email).sort()).toEqual([member.email, owner.email].sort())
    expect(list.items.find((m: any) => m.userId === owner.id)?.role).toBe('owner')
    expect(list.items.find((m: any) => m.userId === member.id)?.role).toBe('member')
    expect(list.items.some((m: any) => m.userId === otherOwner.id)).toBe(false)
    expect(list.page).toBe(1)
    expect(list.pageSize).toBe(20)
    expect(list.total).toBe(2)
    expect(list.totalPages).toBe(1)

    await service.removeMember(otherWorkspace.id, otherOwner.id).catch(() => undefined)
  })

  it('paginates members newest-joined first with page/pageSize and total metadata', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-page-owner-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [memberA] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-page-a-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [memberB] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-page-b-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()

    const workspace = await service.create(owner.id, 'Spec WS Members Page')
    // joinedAt: owner=00, memberA=01, memberB=02 -> newest-first (DESC): memberB, memberA, owner
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: memberA.id,
      role: 'member',
      joinedAt: new Date('2026-07-01T00:00:01.000Z'),
    })
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: memberB.id,
      role: 'member',
      joinedAt: new Date('2026-07-01T00:00:02.000Z'),
    })
    await db
      .update(workspaceMembers)
      .set({ joinedAt: new Date('2026-07-01T00:00:00.000Z') })
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, owner.id)))

    const firstPage = await service.listMembers(workspace.id, { page: '1', pageSize: '2' })
    expect(firstPage.items.map((m: any) => m.userId)).toEqual([memberB.id, memberA.id])
    expect(firstPage.total).toBe(3)
    expect(firstPage.totalPages).toBe(2)

    const secondPage = await service.listMembers(workspace.id, { page: '2', pageSize: '2' })
    expect(secondPage.items.map((m: any) => m.userId)).toEqual([owner.id])
    expect(secondPage.page).toBe(2)
  })

  it('filters members by role', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-role-owner-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [member] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-role-member-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()

    const workspace = await service.create(owner.id, 'Spec WS Members Role')
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: member.id, role: 'member' })

    const owners = await service.listMembers(workspace.id, { role: 'owner' })
    expect(owners.items.map((m: any) => m.userId)).toEqual([owner.id])
    expect(owners.total).toBe(1)

    const members = await service.listMembers(workspace.id, { role: 'member' })
    expect(members.items.map((m: any) => m.userId)).toEqual([member.id])
  })

  it('update changes the workspace name', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `workspaces-spec-update-${Date.now()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const workspace = await service.create(user.id, 'Spec WS Before Rename')

    const updated = await service.update(workspace.id, 'Spec WS After Rename')

    expect(updated.name).toBe('Spec WS After Rename')
    expect(updated.id).toBe(workspace.id)

    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id)).limit(1)
    expect(row.name).toBe('Spec WS After Rename')
  })

  it('update throws NotFoundException for an unknown workspaceId', async () => {
    await expect(service.update('00000000-0000-0000-0000-000000000000', 'Nope')).rejects.toThrow(
      NotFoundException,
    )
  })

  it('searches members by email substring', async () => {
    const stamp = Date.now()
    const [owner] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-search-owner-${stamp}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [member] = await db
      .insert(users)
      .values({ email: `workspaces-spec-members-search-zzneedle-${stamp}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()

    const workspace = await service.create(owner.id, 'Spec WS Members Search')
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: member.id, role: 'member' })

    const hit = await service.listMembers(workspace.id, { q: `zzneedle-${stamp}` })
    expect(hit.items.map((m: any) => m.userId)).toEqual([member.id])
    expect(hit.total).toBe(1)
  })
})
