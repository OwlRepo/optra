import { eq, like } from 'drizzle-orm'
import { db, pool, users, vendors, workspaceMembers, workspaces } from '@repo/db'
import { VendorsService } from './vendors.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(vendors).where(eq(vendors.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspace(email: string, name: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  return workspace
}

describe('VendorsService', () => {
  let service: VendorsService
  const prefix = `vendors-spec-${Date.now()}-`

  beforeEach(() => {
    service = new VendorsService()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('creates a vendor scoped to the workspace', async () => {
    const workspace = await seedWorkspace(`${prefix}create@example.com`, 'Vendor Create')

    const result = await service.create(workspace.id, { name: 'Acme Supply', contactInfo: 'acme@example.com' })

    expect(result.name).toBe('Acme Supply')
    const [row] = await db.select().from(vendors).where(eq(vendors.id, result.id))
    expect(row.workspaceId).toBe(workspace.id)
    expect(row.contactInfo).toBe('acme@example.com')
  })

  it('lists vendors for a workspace newest-first', async () => {
    const workspace = await seedWorkspace(`${prefix}list@example.com`, 'Vendor List')
    await db.insert(vendors).values({ workspaceId: workspace.id, name: 'a-vendor' })
    await db.insert(vendors).values({ workspaceId: workspace.id, name: 'b-vendor' })

    const items = await service.list(workspace.id)

    expect(items.map((item) => item.name)).toEqual(['b-vendor', 'a-vendor'])
  })

  it('excludes vendors from other workspaces', async () => {
    const mine = await seedWorkspace(`${prefix}isolation-mine@example.com`, 'Vendor Isolation Mine')
    const other = await seedWorkspace(`${prefix}isolation-other@example.com`, 'Vendor Isolation Other')
    await db.insert(vendors).values({ workspaceId: other.id, name: 'other-vendor' })

    const items = await service.list(mine.id)

    expect(items).toHaveLength(0)
  })
})
