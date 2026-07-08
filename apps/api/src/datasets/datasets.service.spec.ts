import { NotFoundException } from '@nestjs/common'
import { eq, like } from 'drizzle-orm'
import { datasets, db, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { DatasetsService } from './datasets.service'
import { StorageService } from '../storage/storage.service'
import { DatasetProfilingService } from './dataset-profiling.service'

async function cleanupFixtures(prefix: string) {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of testUsers) {
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    for (const membership of memberships) {
      await db.delete(datasets).where(eq(datasets.workspaceId, membership.workspaceId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, membership.workspaceId))
      await db.delete(workspaces).where(eq(workspaces.id, membership.workspaceId))
    }
  }
  await db.delete(users).where(like(users.email, `${prefix}%`))
}

async function seedWorkspaceFixture(email: string, workspaceName: string) {
  const [user] = await db.insert(users).values({ email, passwordHash: 'x', isVerified: true }).returning()
  const [workspace] = await db.insert(workspaces).values({ name: workspaceName, ownerId: user.id }).returning()
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  return { user, workspace }
}

describe('DatasetsService', () => {
  let service: DatasetsService
  let storage: { save: jest.Mock; delete: jest.Mock }
  let profiling: { queueDataset: jest.Mock }
  const prefix = `datasets-spec-${Date.now()}-`

  beforeAll(() => {
    storage = { save: jest.fn(), delete: jest.fn() }
    profiling = { queueDataset: jest.fn() }
    service = new DatasetsService(
      storage as unknown as StorageService,
      profiling as unknown as DatasetProfilingService,
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  it('uploads a dataset, saves it to storage, and enqueues profiling', async () => {
    const { workspace } = await seedWorkspaceFixture(`${prefix}upload@example.com`, 'Datasets Spec Upload')
    storage.save.mockResolvedValue(undefined)
    profiling.queueDataset.mockResolvedValue({ queued: true })

    const file = { originalname: 'sales.csv', mimetype: 'text/csv', buffer: Buffer.from('a,b\n1,2') } as Express.Multer.File
    const result = await service.upload(workspace.id, file)

    expect(result.name).toBe('sales.csv')
    expect(result.status).toBe('pending')
    expect(storage.save).toHaveBeenCalledWith(expect.stringContaining(`${workspace.id}/datasets/`), file.buffer, 'text/csv')
    expect(profiling.queueDataset).toHaveBeenCalledWith(result.id)

    const [row] = await db.select().from(datasets).where(eq(datasets.id, result.id))
    expect(row.workspaceId).toBe(workspace.id)
  })

  it('marks the dataset failed when enqueueing profiling throws', async () => {
    const { workspace } = await seedWorkspaceFixture(`${prefix}enqueue-fail@example.com`, 'Datasets Spec Enqueue Fail')
    storage.save.mockResolvedValue(undefined)
    profiling.queueDataset.mockRejectedValue(new Error('queue down'))

    const file = { originalname: 'sales.csv', mimetype: 'text/csv', buffer: Buffer.from('a,b\n1,2') } as Express.Multer.File

    await expect(service.upload(workspace.id, file)).rejects.toThrow('queue down')

    const [row] = await db.select().from(datasets).where(eq(datasets.workspaceId, workspace.id))
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('queue down')
  })

  it('lists datasets for a workspace newest-first', async () => {
    const { workspace } = await seedWorkspaceFixture(`${prefix}list@example.com`, 'Datasets Spec List')
    await db.insert(datasets).values({ workspaceId: workspace.id, name: 'a.csv', status: 'done' })
    await db.insert(datasets).values({ workspaceId: workspace.id, name: 'b.csv', status: 'pending' })

    const items = await service.list(workspace.id)

    expect(items.map((item) => item.name)).toEqual(['b.csv', 'a.csv'])
  })

  it('deletes a dataset and its storage object', async () => {
    const { workspace } = await seedWorkspaceFixture(`${prefix}delete@example.com`, 'Datasets Spec Delete')
    const [dataset] = await db
      .insert(datasets)
      .values({ workspaceId: workspace.id, name: 'a.csv', status: 'done', storageKey: 'k/a.csv' })
      .returning()
    storage.delete.mockResolvedValue(undefined)

    await service.remove(workspace.id, dataset.id)

    expect(storage.delete).toHaveBeenCalledWith('k/a.csv')
    const remaining = await db.select().from(datasets).where(eq(datasets.id, dataset.id))
    expect(remaining).toHaveLength(0)
  })

  it('rejects deleting a dataset that belongs to another workspace', async () => {
    const { workspace: mine } = await seedWorkspaceFixture(`${prefix}delete-mine@example.com`, 'Datasets Spec Mine')
    const { workspace: other } = await seedWorkspaceFixture(`${prefix}delete-other@example.com`, 'Datasets Spec Other')
    const [dataset] = await db
      .insert(datasets)
      .values({ workspaceId: other.id, name: 'a.csv', status: 'done' })
      .returning()

    await expect(service.remove(mine.id, dataset.id)).rejects.toThrow(NotFoundException)
  })
})
