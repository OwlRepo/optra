import { Injectable, Logger } from '@nestjs/common'
import duckdb from 'duckdb'

export class UnsafeSqlError extends Error {}
export class SqlExecutionError extends Error {}

const QUERY_TIMEOUT_MS = 10_000
const MAX_RESULT_ROWS = 500
const MEMORY_LIMIT = '256MB'

// Statements that must never reach the untrusted (LLM-generated) SQL, even
// against the already-loaded in-memory table — enable_external_access=false
// stops filesystem/network access but does not stop DDL/DML against data
// already resident in memory.
const FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'attach',
  'detach',
  'copy',
  'pragma',
  'call',
  'export',
  'import',
  'install',
  'load',
  'set',
]

@Injectable()
export class DuckDbQueryService {
  private readonly logger = new Logger(DuckDbQueryService.name)

  /**
   * Loads exactly one workspace-scoped CSV file into a fresh ephemeral
   * in-memory DuckDB instance via TRUSTED code, locks down filesystem/network
   * access, then runs a single validated read-only statement (untrusted,
   * LLM-generated) against the already-materialized table. Verified
   * empirically: once `enable_external_access=false` is set, DuckDB refuses
   * both filesystem reads and any attempt to re-enable the setting for the
   * lifetime of the connection — see docs/ai/risk-register.md.
   */
  async runReadOnlyQuery(
    csvPath: string,
    tableName: string,
    sql: string,
  ): Promise<Record<string, unknown>[]> {
    this.assertReadOnlySelect(sql)

    const db = new duckdb.Database(':memory:')
    const conn = db.connect()

    try {
      await this.exec(conn, `SET memory_limit='${MEMORY_LIMIT}'`)
      await this.exec(
        conn,
        `CREATE TABLE "${this.assertSafeIdentifier(tableName)}" AS SELECT * FROM read_csv_auto('${this.escapeLiteral(csvPath)}')`,
      )
      await this.exec(conn, 'SET enable_external_access=false')

      const rows = await this.withTimeout(this.all(conn, sql), QUERY_TIMEOUT_MS)
      return rows.slice(0, MAX_RESULT_ROWS).map((row) => this.sanitizeRow(row))
    } catch (error) {
      if (error instanceof UnsafeSqlError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Structured query execution failed: ${message}`)
      throw new SqlExecutionError(message)
    } finally {
      conn.close()
      db.close(() => undefined)
    }
  }

  private assertReadOnlySelect(sql: string) {
    const trimmed = sql.trim()
    const statements = trimmed
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)

    if (statements.length !== 1) {
      throw new UnsafeSqlError('Only a single SELECT statement is allowed')
    }

    const normalized = statements[0].toLowerCase()
    if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
      throw new UnsafeSqlError('Only SELECT queries are allowed')
    }

    for (const keyword of FORBIDDEN_KEYWORDS) {
      if (new RegExp(`\\b${keyword}\\b`, 'i').test(normalized)) {
        throw new UnsafeSqlError(`Statement contains a forbidden keyword: ${keyword}`)
      }
    }
  }

  private assertSafeIdentifier(identifier: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
      throw new UnsafeSqlError(`Unsafe table identifier: ${identifier}`)
    }
    return identifier
  }

  private escapeLiteral(value: string): string {
    return value.replace(/'/g, "''")
  }

  private exec(conn: duckdb.Connection, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.exec(sql, (err: Error | null) => (err ? reject(err) : resolve()))
    })
  }

  private all(conn: duckdb.Connection, sql: string): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      conn.all(sql, (err: Error | null, res: Record<string, unknown>[]) =>
        err ? reject(err) : resolve(res),
      )
    })
  }

  // DuckDB's Node driver returns BIGINT/HUGEINT aggregate results (e.g. SUM)
  // as JS `bigint`, which JSON.stringify cannot serialize — every downstream
  // consumer (HTTP response, LLM verbalization) would crash on a bare SUM.
  private sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      sanitized[key] = typeof value === 'bigint' ? Number(value) : value
    }
    return sanitized
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new SqlExecutionError('Query timed out')), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }
}
