import { ExecutionContext, ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { db, pool, users, workspaces, workspaceMembers, type User, type Workspace } from '@repo/db'
import { WorkspaceMemberGuard } from './workspace-member.guard'

function fakeContext(params: Record<string, string>, user?: { userId: string }): ExecutionContext {
  const req: any = { params, user }
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
}

describe('WorkspaceMemberGuard', () => {
  let guard: WorkspaceMemberGuard
  let testUser: User
  let memberWorkspace: Workspace
  let otherWorkspace: Workspace

  beforeAll(async () => {
    guard = new WorkspaceMemberGuard()

    const [user] = await db
      .insert(users)
      .values({ email: `guard-spec-${Date.now()}@example.com`, passwordHash: 'x' })
      .returning()
    testUser = user

    const [ws1] = await db
      .insert(workspaces)
      .values({ name: 'Guard Spec WS', ownerId: testUser.id })
      .returning()
    memberWorkspace = ws1

    const [ws2] = await db
      .insert(workspaces)
      .values({ name: 'Guard Spec Other WS', ownerId: testUser.id })
      .returning()
    otherWorkspace = ws2

    await db.insert(workspaceMembers).values({
      workspaceId: memberWorkspace.id,
      userId: testUser.id,
      role: 'admin',
    })
  })

  afterAll(async () => {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, testUser.id))
    await db.delete(workspaces).where(eq(workspaces.id, memberWorkspace.id))
    await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id))
    await db.delete(users).where(eq(users.id, testUser.id))
    await pool.end()
  })

  it('allows a real member and attaches workspaceId + role to the request', async () => {
    const ctx = fakeContext({ workspaceId: memberWorkspace.id }, { userId: testUser.id })

    await expect(guard.canActivate(ctx)).resolves.toBe(true)

    const req = ctx.switchToHttp().getRequest()
    expect(req.workspaceMember).toEqual({ workspaceId: memberWorkspace.id, role: 'admin' })
  })

  it('rejects a user who is not a member of the requested workspace', async () => {
    const ctx = fakeContext({ workspaceId: otherWorkspace.id }, { userId: testUser.id })

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('rejects when the route has no :workspaceId param', async () => {
    const ctx = fakeContext({}, { userId: testUser.id })

    await expect(guard.canActivate(ctx)).rejects.toThrow(InternalServerErrorException)
  })

  it('rejects when there is no authenticated user on the request', async () => {
    const ctx = fakeContext({ workspaceId: memberWorkspace.id })

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('rejects when workspaceId param is an empty string (falsy, same path as missing)', async () => {
    const ctx = fakeContext({ workspaceId: '' }, { userId: testUser.id })

    await expect(guard.canActivate(ctx)).rejects.toThrow(InternalServerErrorException)
  })

  it('rejects when workspaceId is a well-formed but nonexistent UUID', async () => {
    const ctx = fakeContext(
      { workspaceId: '00000000-0000-0000-0000-000000000000' },
      { userId: testUser.id },
    )

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('rejects cleanly (not a raw DB error) when workspaceId is not a valid UUID at all', async () => {
    const ctx = fakeContext({ workspaceId: 'not-a-uuid' }, { userId: testUser.id })

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('attaches the correct role per workspace when the user belongs to more than one', async () => {
    await db.insert(workspaceMembers).values({
      workspaceId: otherWorkspace.id,
      userId: testUser.id,
      role: 'member',
    })

    const ctxOwnerSide = fakeContext({ workspaceId: memberWorkspace.id }, { userId: testUser.id })
    await guard.canActivate(ctxOwnerSide)
    expect(ctxOwnerSide.switchToHttp().getRequest().workspaceMember).toEqual({
      workspaceId: memberWorkspace.id,
      role: 'admin',
    })

    const ctxMemberSide = fakeContext({ workspaceId: otherWorkspace.id }, { userId: testUser.id })
    await guard.canActivate(ctxMemberSide)
    expect(ctxMemberSide.switchToHttp().getRequest().workspaceMember).toEqual({
      workspaceId: otherWorkspace.id,
      role: 'member',
    })
  })
})
