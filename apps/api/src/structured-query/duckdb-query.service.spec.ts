import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DuckDbQueryService, SqlExecutionError, UnsafeSqlError } from './duckdb-query.service'

describe('DuckDbQueryService', () => {
  let service: DuckDbQueryService
  let dir: string
  let csvPath: string

  beforeEach(() => {
    service = new DuckDbQueryService()
    dir = mkdtempSync(join(tmpdir(), 'duckdb-query-spec-'))
    csvPath = join(dir, 'sales.csv')
    writeFileSync(
      csvPath,
      ['product,quarter,revenue', 'Widget,Q1,1000', 'Gadget,Q1,1500', 'Widget,Q2,1200'].join('\n'),
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs a validated SELECT against the loaded CSV and returns rows', async () => {
    const rows = await service.runReadOnlyQuery(
      csvPath,
      'dataset',
      `SELECT product, SUM(revenue) AS total FROM dataset WHERE quarter = 'Q1' GROUP BY product ORDER BY total DESC`,
    )

    expect(rows).toEqual([
      { product: 'Gadget', total: 1500 },
      { product: 'Widget', total: 1000 },
    ])
  })

  it('rejects a multi-statement payload', async () => {
    await expect(
      service.runReadOnlyQuery(csvPath, 'dataset', 'SELECT 1; DROP TABLE dataset'),
    ).rejects.toThrow(UnsafeSqlError)
  })

  it('rejects a statement that is not SELECT/WITH', async () => {
    await expect(
      service.runReadOnlyQuery(csvPath, 'dataset', "UPDATE dataset SET revenue = 0"),
    ).rejects.toThrow(UnsafeSqlError)
  })

  it.each([
    'DELETE FROM dataset',
    'DROP TABLE dataset',
    "ATTACH 'evil.db' AS evil",
    "COPY dataset TO 'out.csv'",
    'SET enable_external_access=true',
    "INSERT INTO dataset VALUES ('x', 'Q1', 1)",
  ])('rejects forbidden statement: %s', async (sql) => {
    await expect(service.runReadOnlyQuery(csvPath, 'dataset', sql)).rejects.toThrow(UnsafeSqlError)
  })

  it('rejects an unsafe table identifier before ever touching the filesystem', async () => {
    await expect(
      service.runReadOnlyQuery(csvPath, 'dataset"; DROP TABLE x; --', 'SELECT 1'),
    ).rejects.toThrow(UnsafeSqlError)
  })

  it('cannot read a second file after the trusted load locks down external access', async () => {
    const secretPath = join(dir, 'secret.csv')
    writeFileSync(secretPath, 'secret\nleaked')

    await expect(
      service.runReadOnlyQuery(csvPath, 'dataset', `SELECT * FROM read_csv_auto('${secretPath}')`),
    ).rejects.toThrow(SqlExecutionError)
  })

  it('truncates results beyond the row cap', async () => {
    const bigDir = mkdtempSync(join(tmpdir(), 'duckdb-query-spec-big-'))
    const bigCsvPath = join(bigDir, 'big.csv')
    const rows = ['n']
    for (let i = 0; i < 600; i++) rows.push(String(i))
    writeFileSync(bigCsvPath, rows.join('\n'))

    try {
      const result = await service.runReadOnlyQuery(bigCsvPath, 'dataset', 'SELECT n FROM dataset')
      expect(result.length).toBe(500)
    } finally {
      rmSync(bigDir, { recursive: true, force: true })
    }
  })

  it('propagates a real DuckDB error (e.g. unknown column) as SqlExecutionError', async () => {
    await expect(
      service.runReadOnlyQuery(csvPath, 'dataset', 'SELECT nonexistent_column FROM dataset'),
    ).rejects.toThrow(SqlExecutionError)
  })

  describe('runReadOnlyMultiTableQuery (V2 F5)', () => {
    it('loads N tables into the same instance and runs a JOIN across them', async () => {
      const refundsPath = join(dir, 'refunds.csv')
      writeFileSync(refundsPath, ['product,quarter,refund_amount', 'Widget,Q1,100'].join('\n'))

      const rows = await service.runReadOnlyMultiTableQuery(
        [
          { csvPath, tableName: 't1' },
          { csvPath: refundsPath, tableName: 't2' },
        ],
        `SELECT t1.product, t1.revenue, t2.refund_amount FROM t1 JOIN t2 ON t1.product = t2.product AND t1.quarter = t2.quarter WHERE t1.product = 'Widget' AND t1.quarter = 'Q1'`,
      )

      expect(rows).toEqual([{ product: 'Widget', revenue: 1000, refund_amount: 100 }])
    })

    it('rejects forbidden keywords against any of the loaded tables', async () => {
      await expect(
        service.runReadOnlyMultiTableQuery([{ csvPath, tableName: 't1' }], 'DROP TABLE t1'),
      ).rejects.toThrow(UnsafeSqlError)
    })
  })
})
