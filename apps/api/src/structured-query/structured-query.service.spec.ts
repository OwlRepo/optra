import { writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { datasets, db, pool, tickets, users, workspaceMembers, workspaces, type DatasetColumn } from '@repo/db'
import { StructuredQueryService } from './structured-query.service'
import { DuckDbQueryService } from './duckdb-query.service'
import { StorageService } from '../storage/storage.service'

const { embedQuery, generateSql, generateMultiTableSql, classifyTicketIntent, classifyComparisonIntent, UnanswerableQuestionError } =
  jest.requireMock('@repo/ai') as {
    embedQuery: jest.Mock
    generateSql: jest.Mock
    generateMultiTableSql: jest.Mock
    classifyTicketIntent: jest.Mock
    classifyComparisonIntent: jest.Mock
    UnanswerableQuestionError: typeof Error
  }

jest.mock('@repo/ai', () => ({
  embedQuery: jest.fn(),
  generateSql: jest.fn(),
  generateMultiTableSql: jest.fn(),
  classifyTicketIntent: jest.fn(() => false),
  classifyComparisonIntent: jest.fn(() => false),
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

  let filesByStorageKey: Map<string, string>

  beforeEach(async () => {
    jest.clearAllMocks()
    filesByStorageKey = new Map()
    storage = { getToTempFile: jest.fn((storageKey: string) => Promise.resolve(filesByStorageKey.get(storageKey))) }
    service = new StructuredQueryService(storage as unknown as StorageService, new DuckDbQueryService())
    await db.delete(datasets).where(eq(datasets.workspaceId, workspaceId))
  })

  async function seedDataset(overrides: {
    description: string
    embeddingSeed: number
    columns?: DatasetColumn[]
    csvContent?: string
    name?: string
  }) {
    const csvPath = `/tmp/structured-query-spec-${randomUUID()}.csv`
    writeFileSync(csvPath, overrides.csvContent ?? 'product,revenue\nWidget,1000\nGadget,1500')
    const storageKey = `k/${randomUUID()}`
    filesByStorageKey.set(storageKey, csvPath)

    const [dataset] = await db
      .insert(datasets)
      .values({
        workspaceId,
        name: overrides.name ?? 'sales.csv',
        storageKey,
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

  describe('cross-file comparison queries (V2 F5)', () => {
    it('joins two datasets when comparison intent matches and both score above the comparison threshold', async () => {
      const sales = await seedDataset({
        description: 'Sales by product',
        embeddingSeed: 1,
        name: 'sales.csv',
        csvContent: 'product,revenue\nWidget,1000',
      })
      const refunds = await seedDataset({
        description: 'Refunds by product',
        embeddingSeed: 2,
        name: 'refunds.csv',
        columns: [
          { name: 'product', type: 'string' },
          { name: 'refund_amount', type: 'number' },
        ],
        csvContent: 'product,refund_amount\nWidget,100',
      })
      embedQuery.mockResolvedValue(fakeEmbedding(1))
      classifyComparisonIntent.mockReturnValue(true)
      generateMultiTableSql.mockResolvedValue(
        'SELECT t1.product, t1.revenue, t2.refund_amount FROM t1 JOIN t2 ON t1.product = t2.product',
      )

      const result = await service.answer(workspaceId, 'compare sales.csv vs refunds.csv by product')

      expect(result.state).toBe('confident')
      expect(result.answer).toContain('Widget')
      expect(result.datasets?.map((d) => d.id).sort()).toEqual([refunds.id, sales.id].sort())
      const [, tables] = generateMultiTableSql.mock.calls[0]
      expect(tables.map((t: { tableName: string }) => t.tableName)).toEqual(['t1', 't2'])
    })

    it('falls back to single-dataset flow when comparison intent matches but only one dataset is comparable', async () => {
      await seedDataset({ description: 'Sales by product', embeddingSeed: 1 })
      embedQuery.mockResolvedValue(fakeEmbedding(1))
      classifyComparisonIntent.mockReturnValue(true)
      generateSql.mockResolvedValue('SELECT product, revenue FROM dataset')

      const result = await service.answer(workspaceId, 'compare revenue over time')

      expect(result.state).toBe('confident')
      expect(generateMultiTableSql).not.toHaveBeenCalled()
      expect(result.datasetName).toBe('sales.csv')
    })

    it('returns correction state when the joined SQL fails on repair too', async () => {
      await seedDataset({ description: 'Sales by product', embeddingSeed: 1, name: 'sales.csv' })
      await seedDataset({ description: 'Refunds by product', embeddingSeed: 2, name: 'refunds.csv' })
      embedQuery.mockResolvedValue(fakeEmbedding(1))
      classifyComparisonIntent.mockReturnValue(true)
      generateMultiTableSql.mockResolvedValue('SELECT nonexistent_column FROM t1')

      const result = await service.answer(workspaceId, 'compare sales vs refunds')

      expect(result.state).toBe('correction')
    })
  })

  describe('ticket trend queries (V2 F2)', () => {
    afterEach(async () => {
      await db.delete(tickets).where(eq(tickets.workspaceId, workspaceId))
    })

    it('exports done tickets to DuckDB and answers without touching the dataset selector', async () => {
      classifyTicketIntent.mockReturnValue(true)
      await db.insert(tickets).values([
        {
          workspaceId,
          transcript: 't1',
          transcriptHash: 'h1',
          status: 'done',
          category: 'billing',
          severity: 'high',
        },
        {
          workspaceId,
          transcript: 't2',
          transcriptHash: 'h2',
          status: 'done',
          category: 'billing',
          severity: 'low',
        },
      ])
      generateSql.mockResolvedValue("SELECT category, COUNT(*) AS n FROM tickets GROUP BY category")

      const result = await service.answer(workspaceId, 'which ticket category is most common')

      expect(result.state).toBe('confident')
      expect(result.answer).toContain('billing')
      expect(embedQuery).not.toHaveBeenCalled()
    })

    it('returns empty state when there are no processed tickets yet', async () => {
      classifyTicketIntent.mockReturnValue(true)

      const result = await service.answer(workspaceId, 'ticket trends by severity')

      expect(result.state).toBe('empty')
      expect(generateSql).not.toHaveBeenCalled()
    })
  })
})
