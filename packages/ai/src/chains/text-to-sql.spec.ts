import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetColumn } from '@repo/db'

const invokeMock = vi.fn()

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    invoke = invokeMock
  },
}))

const COLUMNS: DatasetColumn[] = [
  { name: 'product', type: 'string' },
  { name: 'revenue', type: 'number' },
]

describe('generateSql', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('strips markdown code fences and a trailing semicolon from the model response', async () => {
    invokeMock.mockResolvedValue({ content: '```sql\nSELECT product FROM dataset;\n```' })

    const { generateSql } = await import('./text-to-sql')
    const result = await generateSql('list products', 'dataset', COLUMNS)

    expect(result).toBe('SELECT product FROM dataset')
  })

  it('passes the schema and prior error into the prompt on a repair attempt', async () => {
    invokeMock.mockResolvedValue({ content: 'SELECT product FROM dataset' })

    const { generateSql } = await import('./text-to-sql')
    await generateSql('list products', 'dataset', COLUMNS, 'column "x" does not exist')

    const [, humanMessage] = invokeMock.mock.calls[0][0]
    expect(humanMessage.content).toContain('product (string)')
    expect(humanMessage.content).toContain('revenue (number)')
    expect(humanMessage.content).toContain('column "x" does not exist')
  })

  it('throws UnanswerableQuestionError when the model returns the unanswerable sentinel', async () => {
    invokeMock.mockResolvedValue({ content: 'SELECT NULL AS unanswerable WHERE FALSE' })

    const { generateSql, UnanswerableQuestionError } = await import('./text-to-sql')

    await expect(generateSql('unrelated question', 'dataset', COLUMNS)).rejects.toThrow(
      UnanswerableQuestionError,
    )
  })
})

describe('generateMultiTableSql (V2 F5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const TABLES = [
    { tableName: 't1', name: 'sales.csv', columns: COLUMNS },
    { tableName: 't2', name: 'refunds.csv', columns: [{ name: 'product', type: 'string' as const }, { name: 'refund_amount', type: 'number' as const }] },
  ]

  it('strips markdown fences and includes every table with its source name in the prompt', async () => {
    invokeMock.mockResolvedValue({ content: '```sql\nSELECT t1.product FROM t1 JOIN t2 ON t1.product = t2.product;\n```' })

    const { generateMultiTableSql } = await import('./text-to-sql')
    const result = await generateMultiTableSql('compare sales and refunds by product', TABLES)

    expect(result).toBe('SELECT t1.product FROM t1 JOIN t2 ON t1.product = t2.product')
    const [, humanMessage] = invokeMock.mock.calls[0][0]
    expect(humanMessage.content).toContain('Table: t1 (source: "sales.csv")')
    expect(humanMessage.content).toContain('Table: t2 (source: "refunds.csv")')
  })

  it('throws UnanswerableQuestionError when the model returns the unanswerable sentinel', async () => {
    invokeMock.mockResolvedValue({ content: 'SELECT NULL AS unanswerable WHERE FALSE' })

    const { generateMultiTableSql, UnanswerableQuestionError } = await import('./text-to-sql')

    await expect(generateMultiTableSql('unrelated question', TABLES)).rejects.toThrow(
      UnanswerableQuestionError,
    )
  })
})
