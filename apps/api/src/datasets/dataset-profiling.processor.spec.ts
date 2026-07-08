import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq, like } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { datasets, db, pool, users, workspaceMembers, workspaces } from '@repo/db'
import { DatasetProfilingProcessor } from './dataset-profiling.processor'
import { StorageService } from '../storage/storage.service'

const mockEmbedQuery = jest.fn()

jest.mock('@repo/ai', () => ({
  embedQuery: (...args: unknown[]) => mockEmbedQuery(...args),
}))

async function cleanupFixtures(prefix: string) {
  const matches = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`))
  for (const user of matches) {
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

describe('DatasetProfilingProcessor', () => {
  const prefix = `dataset-profiling-spec-${Date.now()}-`
  let dir: string
  let storage: { getToTempFile: jest.Mock; save: jest.Mock }
  let processor: DatasetProfilingProcessor

  beforeEach(() => {
    jest.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'dataset-profiling-spec-'))
    storage = { getToTempFile: jest.fn(), save: jest.fn().mockResolvedValue(undefined) }
    processor = new DatasetProfilingProcessor(storage as unknown as StorageService)
    mockEmbedQuery.mockResolvedValue(new Array(1536).fill(0.01))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  afterAll(async () => {
    await cleanupFixtures(prefix)
    await pool.end()
  })

  async function seedDataset(csvContent: string, name = 'sales.csv') {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    const csvPath = join(dir, `${randomUUID()}.csv`)
    writeFileSync(csvPath, csvContent)
    storage.getToTempFile.mockResolvedValue(csvPath)

    const [dataset] = await db
      .insert(datasets)
      .values({
        workspaceId: workspace.id,
        name,
        storageKey: `k/${randomUUID()}`,
        status: 'pending',
      })
      .returning()

    return dataset
  }

  async function seedXlsxDataset(rows: Record<string, unknown>[], name = 'sales.xlsx') {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}${randomUUID()}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db.insert(workspaces).values({ name: prefix, ownerId: user.id }).returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const xlsxPath = join(dir, `${randomUUID()}.xlsx`)
    writeFileSync(xlsxPath, buffer)
    storage.getToTempFile.mockResolvedValue(xlsxPath)

    const [dataset] = await db
      .insert(datasets)
      .values({
        workspaceId: workspace.id,
        name,
        storageKey: `k/${randomUUID()}`,
        status: 'pending',
      })
      .returning()

    return dataset
  }

  it('infers column types and writes a description + embedding on success', async () => {
    const dataset = await seedDataset(
      ['product,revenue,launched,active', 'Widget,1000,2024-01-15,true', 'Gadget,1500,2024-02-01,false'].join('\n'),
    )

    await processor.handleProfiling({ id: 'job-1', data: { datasetId: dataset.id } } as any)

    const [updated] = await db.select().from(datasets).where(eq(datasets.id, dataset.id))
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(2)
    expect(updated.columnsSchema).toEqual([
      { name: 'product', type: 'string' },
      { name: 'revenue', type: 'number' },
      { name: 'launched', type: 'date' },
      { name: 'active', type: 'boolean' },
    ])
    expect(updated.description).toContain('sales.csv')
    expect(updated.description).toContain('2 rows')
    expect(updated.descriptionEmbedding).not.toBeNull()
    expect(mockEmbedQuery).toHaveBeenCalledWith(updated.description)
  })

  it('marks the dataset failed with lastError when profiling throws', async () => {
    const dataset = await seedDataset('product,revenue\nWidget,1000')
    mockEmbedQuery.mockRejectedValue(new Error('embedding service unavailable'))

    await processor.handleProfiling({ id: 'job-2', data: { datasetId: dataset.id } } as any)

    const [updated] = await db.select().from(datasets).where(eq(datasets.id, dataset.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('embedding service unavailable')
  })

  it('fails cleanly when the dataset row has no storageKey', async () => {
    const dataset = await seedDataset('product,revenue\nWidget,1000')
    await db.update(datasets).set({ storageKey: null }).where(eq(datasets.id, dataset.id))

    await processor.handleProfiling({ id: 'job-3', data: { datasetId: dataset.id } } as any)

    const [updated] = await db.select().from(datasets).where(eq(datasets.id, dataset.id))
    expect(updated.status).toBe('failed')
    expect(updated.lastError).toContain('storageKey')
  })

  it('converts an XLSX upload to CSV, profiles it, and overwrites storage with the converted CSV', async () => {
    const dataset = await seedXlsxDataset([
      { product: 'Widget', revenue: 1000 },
      { product: 'Gadget', revenue: 1500 },
    ])

    await processor.handleProfiling({ id: 'job-xlsx', data: { datasetId: dataset.id } } as any)

    const [updated] = await db.select().from(datasets).where(eq(datasets.id, dataset.id))
    expect(updated.status).toBe('done')
    expect(updated.rowCount).toBe(2)
    expect(updated.columnsSchema).toEqual([
      { name: 'product', type: 'string' },
      { name: 'revenue', type: 'number' },
    ])

    expect(storage.save).toHaveBeenCalledWith(
      dataset.storageKey,
      expect.any(Buffer),
      'text/csv',
    )
    const [, savedBuffer] = storage.save.mock.calls[0]
    expect(savedBuffer.toString('utf-8')).toContain('Widget');
  })
})
