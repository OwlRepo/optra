import { writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { datasets, db, pool, users, workspaceMembers, workspaces, type DatasetColumn } from '@repo/db'
import { StructuredQueryService } from './structured-query.service'
import { DuckDbQueryService } from './duckdb-query.service'
import { StorageService } from '../storage/storage.service'

const { embedQuery, generateSql, UnanswerableQuestionError } = jest.requireMock('@repo/ai') as {
  embedQuery: jest.Mock
  generateSql: jest.Mock
  UnanswerableQuestionError: typeof Error
}

jest.mock('@repo/ai', () => ({
  embedQuery: jest.fn(),
  generateSql: jest.fn(),
  UnanswerableQuestionError: class UnanswerableQuestionError extends Error {},
}))

function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(seed + i) * 0.01)
}

describe('StructuredQueryService', () => {
  let service: StructuredQueryService
  let storage: { getToTempFile: jest.Mock }
  const prefix = `structured-query-spec-${Date.now()}-`
  let workspaceId: string

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${prefix}@example.com`, passwordHash: 'x', isVerified: true })
      .returning()
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: prefix, ownerId: user.id })
      .returning()
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
    workspaceId = workspace.id
  })

  afterAll(async () => {
    await db.delete(datasets).where(eq(datasets.workspaceId, workspaceId))
    await pool.end()
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    storage = { getToTempFile: jest.fn() }
    service = new StructuredQueryService(storage as unknown as StorageService, new DuckDbQueryService())
    await db.delete(datasets).where(eq(datasets.workspaceId, workspaceId))
  })

  async function seedDataset(overrides: {
    description: string
    embeddingSeed: number
    columns?: DatasetColumn[]
    csvContent?: string
  }) {
    const csvPath = `/tmp/structured-query-spec-${randomUUID()}.csv`
    writeFileSync(csvPath, overrides.csvContent ?? 'product,revenue\nWidget,1000\nGadget,1500')
    storage.getToTempFile.mockResolvedValue(csvPath)

    const [dataset] = await db
      .insert(datasets)
      .values({
        workspaceId,
        name: 'sales.csv',
        storageKey: `k/${randomUUID()}`,
        status: 'done',
        description: overrides.description,
        descriptionEmbedding: fakeEmbedding(overrides.embeddingSeed),
        columnsSchema: overrides.columns ?? [
          { name: 'product', type: 'string' },
          { name: 'revenue', type: 'number' },
        ],
        rowCount: 2,
      })
      .returning()

    return dataset
  }

  it('reports no ready datasets when none exist', async () => {
    expect(await service.hasReadyDatasets(workspaceId)).toBe(false)
  })

  it('returns empty state when the workspace has no datasets at all', async () => {
    embedQuery.mockResolvedValue(fakeEmbedding(1))
    const result = await service.answer(workspaceId, 'total revenue')
    expect(result.state).toBe('empty')
  })

  it('runs a confident query end-to-end against a real dataset file', async () => {
    await seedDataset({ description: 'Sales by product', embeddingSeed: 1 })
    embedQuery.mockResolvedValue(fakeEmbedding(1))
    generateSql.mockResolvedValue('SELECT product, revenue FROM dataset ORDER BY revenue DESC')

    expect(await service.hasReadyDatasets(workspaceId)).toBe(true)

    const result = await service.answer(workspaceId, 'show revenue by product')

    expect(result.state).toBe('confident')
    expect(result.answer).toContain('Gadget')
    expect(result.answer).toContain('Widget')
    expect(result.datasetName).toBe('sales.csv')
  })

  it('retries once when the generated SQL fails, then succeeds', async () => {
    await seedDataset({ description: 'Sales by product', embeddingSeed: 1 })
    embedQuery.mockResolvedValue(fakeEmbedding(1))
    generateSql
      .mockResolvedValueOnce('SELECT nonexistent_column FROM dataset')
      .mockResolvedValueOnce('SELECT product FROM dataset')

    const result = await service.answer(workspaceId, 'bad first attempt')

    expect(generateSql).toHaveBeenCalledTimes(2)
    expect(result.state).toBe('confident')
  })

  it('returns correction state when the repaired SQL also fails', async () => {
    await seedDataset({ description: 'Sales by product', embeddingSeed: 1 })
    embedQuery.mockResolvedValue(fakeEmbedding(1))
    generateSql.mockResolvedValue('SELECT nonexistent_column FROM dataset')

    const result = await service.answer(workspaceId, 'always broken')

    expect(result.state).toBe('correction')
  })

  it('returns empty state when the model declares the question unanswerable', async () => {
    await seedDataset({ description: 'Sales by product', embeddingSeed: 1 })
    embedQuery.mockResolvedValue(fakeEmbedding(1))
    generateSql.mockRejectedValue(new UnanswerableQuestionError('nope'))

    const result = await service.answer(workspaceId, 'unrelated question')

    expect(result.state).toBe('empty')
  })

  it('returns ambiguous state when two datasets score within the gap threshold', async () => {
    await seedDataset({ description: 'Sales by product', embeddingSeed: 1 })
    await seedDataset({ description: 'Sales by product too', embeddingSeed: 1.0001 })
    embedQuery.mockResolvedValue(fakeEmbedding(1))

    const result = await service.answer(workspaceId, 'compare the two')

    expect(result.state).toBe('ambiguous')
    expect(result.candidates?.length).toBeGreaterThan(1)
    expect(generateSql).not.toHaveBeenCalled()
  })
})
