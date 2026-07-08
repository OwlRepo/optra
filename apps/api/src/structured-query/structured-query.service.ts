import { mkdtemp, rm, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Injectable, Logger } from '@nestjs/common'
import { and, count, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import Papa from 'papaparse'
import { datasets, db, tickets, users, type DatasetColumn } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { DuckDbQueryService, SqlExecutionError, UnsafeSqlError } from './duckdb-query.service'

const TICKET_TABLE_NAME = 'tickets'
const TICKET_COLUMNS: DatasetColumn[] = [
  { name: 'category', type: 'string' },
  { name: 'severity', type: 'string' },
  { name: 'productArea', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'createdAt', type: 'date' },
  { name: 'resolvedAt', type: 'date' },
  { name: 'reviewedByEmail', type: 'string' },
  { name: 'assigneeEmail', type: 'string' },
]

export type StructuredQueryState = 'confident' | 'ambiguous' | 'correction' | 'empty'

export interface StructuredQueryCandidate {
  id: string
  name: string
  description: string | null
}

export interface StructuredQueryDatasetRef {
  id: string
  name: string
}

export interface StructuredQueryResult {
  state: StructuredQueryState
  answer: string
  datasetId?: string
  datasetName?: string
  candidates?: StructuredQueryCandidate[]
  // V2 F5: set instead of datasetId/datasetName when the confident answer
  // came from a cross-file comparison across 2+ datasets.
  datasets?: StructuredQueryDatasetRef[]
}

const TABLE_NAME = 'dataset'
const CONFIDENT_MIN_SCORE = Number.parseFloat(process.env.STRUCTURED_QUERY_MIN_SCORE ?? '0.5')
const AMBIGUOUS_SCORE_GAP = Number.parseFloat(process.env.STRUCTURED_QUERY_AMBIGUOUS_GAP ?? '0.05')
// V2 F5: looser than CONFIDENT_MIN_SCORE — a comparison question's semantic
// similarity naturally splits across the two topics it mentions, so neither
// dataset alone scores as high as a single-topic question would.
const COMPARISON_MIN_SCORE = Number.parseFloat(process.env.STRUCTURED_QUERY_COMPARISON_MIN_SCORE ?? '0.35')
const MAX_COMPARE_DATASETS = 3

interface DatasetCandidateRow {
  id: string
  name: string
  description: string | null
  columnsSchema: DatasetColumn[] | null
  storageKey: string | null
  score: number
}

@Injectable()
export class StructuredQueryService {
  private readonly logger = new Logger(StructuredQueryService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly duckDb: DuckDbQueryService,
  ) {}

  async hasReadyDatasets(workspaceId: string): Promise<boolean> {
    const [{ value }] = await db
      .select({ value: count() })
      .from(datasets)
      .where(and(eq(datasets.workspaceId, workspaceId), eq(datasets.status, 'done')))

    return Number(value) > 0
  }

  async answer(workspaceId: string, question: string): Promise<StructuredQueryResult> {
    const { classifyComparisonIntent, classifyTicketIntent, embedQuery } = await import('@repo/ai')

    if (classifyTicketIntent(question)) {
      return this.answerFromTickets(workspaceId, question)
    }

    const embedding = await embedQuery(question)
    const candidates = await this.selectCandidates(workspaceId, embedding)

    if (candidates.length === 0) {
      return {
        state: 'empty',
        answer: "I don't see any ready datasets in this workspace yet. Upload a CSV to get started.",
      }
    }

    if (classifyComparisonIntent(question)) {
      const comparable = candidates.filter(
        (candidate) => candidate.score >= COMPARISON_MIN_SCORE && candidate.storageKey && candidate.columnsSchema,
      )
      if (comparable.length >= 2) {
        return this.answerAcrossDatasets(question, comparable.slice(0, MAX_COMPARE_DATASETS))
      }
      // Not enough comparable datasets found — fall through to the normal
      // single-dataset flow below rather than forcing a comparison.
    }

    const [top, second] = candidates

    if (top.score < CONFIDENT_MIN_SCORE) {
      return { state: 'empty', answer: "I couldn't find a dataset that matches this question." }
    }

    if (second && top.score - second.score < AMBIGUOUS_SCORE_GAP) {
      return {
        state: 'ambiguous',
        answer: 'I found more than one dataset that might answer this — which one did you mean?',
        candidates: candidates
          .slice(0, 3)
          .map((row) => ({ id: row.id, name: row.name, description: row.description })),
      }
    }

    if (!top.storageKey || !top.columnsSchema) {
      return { state: 'empty', answer: `The "${top.name}" dataset is not ready yet.` }
    }

    const tempPath = await this.storage.getToTempFile(top.storageKey)

    try {
      return await this.runTextToSqlFlow(question, tempPath, TABLE_NAME, top.columnsSchema, {
        label: top.name,
        datasetId: top.id,
        datasetName: top.name,
      })
    } finally {
      await unlink(tempPath).catch(() => undefined)
    }
  }

  /**
   * Ticket trends (V2 F2): tickets are not a user-uploaded dataset, so there's
   * no candidate-selection step — trusted Drizzle code exports this
   * workspace's tickets (mandatory workspaceId filter) into the same
   * ephemeral-DuckDB executor a real dataset would use. LLM-generated SQL
   * never touches Postgres directly.
   */
  private async answerFromTickets(workspaceId: string, question: string): Promise<StructuredQueryResult> {
    const reviewedByUser = alias(users, 'reviewed_by_user')
    const assigneeUser = alias(users, 'assignee_user')

    const rows = await db
      .select({
        category: tickets.category,
        severity: tickets.severity,
        productArea: tickets.productArea,
        status: tickets.status,
        createdAt: tickets.createdAt,
        resolvedAt: tickets.resolvedAt,
        reviewedByEmail: reviewedByUser.email,
        assigneeEmail: assigneeUser.email,
      })
      .from(tickets)
      .leftJoin(reviewedByUser, eq(tickets.reviewedBy, reviewedByUser.id))
      .leftJoin(assigneeUser, eq(tickets.assigneeId, assigneeUser.id))
      .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.status, 'done')))

    if (rows.length === 0) {
      return { state: 'empty', answer: "I don't see any processed tickets in this workspace yet." }
    }

    const csvContent = Papa.unparse(rows)
    const dir = await mkdtemp(join(tmpdir(), 'mnemra-tickets-'))
    const csvPath = join(dir, 'tickets.csv')

    try {
      await writeFile(csvPath, csvContent, 'utf-8')
      return await this.runTextToSqlFlow(question, csvPath, TICKET_TABLE_NAME, TICKET_COLUMNS, {
        label: 'your tickets',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /**
   * Cross-file comparison (V2 F5): loads each candidate dataset's CSV into
   * its own table (t1, t2, ...) in the SAME ephemeral DuckDB instance, so
   * the generated SQL can JOIN across them. Reuses the entire S1 engine —
   * same trusted-load-then-lockdown hardening, same repair-retry shape.
   */
  private async answerAcrossDatasets(
    question: string,
    candidates: DatasetCandidateRow[],
  ): Promise<StructuredQueryResult> {
    const tables = await Promise.all(
      candidates.map(async (candidate, index) => ({
        id: candidate.id,
        name: candidate.name,
        tableName: `t${index + 1}`,
        csvPath: await this.storage.getToTempFile(candidate.storageKey!),
        columns: candidate.columnsSchema!,
      })),
    )

    try {
      return await this.runMultiTableTextToSqlFlow(question, tables)
    } finally {
      await Promise.all(tables.map((table) => unlink(table.csvPath).catch(() => undefined)))
    }
  }

  private async runMultiTableTextToSqlFlow(
    question: string,
    tables: { id: string; name: string; tableName: string; csvPath: string; columns: DatasetColumn[] }[],
  ): Promise<StructuredQueryResult> {
    const { generateMultiTableSql, UnanswerableQuestionError } = await import('@repo/ai')

    const schemaInput = tables.map(({ tableName, name, columns }) => ({ tableName, name, columns }))
    const tableRefs = tables.map(({ csvPath, tableName }) => ({ csvPath, tableName }))
    const label = tables.map((table) => table.name).join(', ')
    const datasetRefs: StructuredQueryDatasetRef[] = tables.map(({ id, name }) => ({ id, name }))

    try {
      let generatedSql = await generateMultiTableSql(question, schemaInput)

      try {
        const rows = await this.duckDb.runReadOnlyMultiTableQuery(tableRefs, generatedSql)
        return { state: 'confident', answer: this.verbalize(rows), datasets: datasetRefs }
      } catch (firstError) {
        if (firstError instanceof UnsafeSqlError) {
          throw firstError
        }
        const message = firstError instanceof Error ? firstError.message : String(firstError)
        generatedSql = await generateMultiTableSql(question, schemaInput, message)
        const rows = await this.duckDb.runReadOnlyMultiTableQuery(tableRefs, generatedSql)
        return { state: 'confident', answer: this.verbalize(rows), datasets: datasetRefs }
      }
    } catch (error) {
      if (error instanceof UnanswerableQuestionError) {
        return { state: 'empty', answer: `This question can't be answered from ${label}.` }
      }
      if (error instanceof SqlExecutionError || error instanceof UnsafeSqlError) {
        this.logger.warn(`Multi-dataset structured query correction sources=${label}: ${error.message}`)
        return {
          state: 'correction',
          answer: `I couldn't run a valid query across ${label}. Could you rephrase it?`,
        }
      }
      throw error
    }
  }

  private async runTextToSqlFlow(
    question: string,
    csvPath: string,
    tableName: string,
    columns: DatasetColumn[],
    source: { label: string; datasetId?: string; datasetName?: string },
  ): Promise<StructuredQueryResult> {
    const { generateSql, UnanswerableQuestionError } = await import('@repo/ai')

    try {
      let generatedSql = await generateSql(question, tableName, columns)

      try {
        const rows = await this.duckDb.runReadOnlyQuery(csvPath, tableName, generatedSql)
        return {
          state: 'confident',
          answer: this.verbalize(rows),
          datasetId: source.datasetId,
          datasetName: source.datasetName,
        }
      } catch (firstError) {
        if (firstError instanceof UnsafeSqlError) {
          throw firstError
        }
        // One repair retry: feed the execution error back to the model.
        const message = firstError instanceof Error ? firstError.message : String(firstError)
        generatedSql = await generateSql(question, tableName, columns, message)
        const rows = await this.duckDb.runReadOnlyQuery(csvPath, tableName, generatedSql)
        return {
          state: 'confident',
          answer: this.verbalize(rows),
          datasetId: source.datasetId,
          datasetName: source.datasetName,
        }
      }
    } catch (error) {
      if (error instanceof UnanswerableQuestionError) {
        return {
          state: 'empty',
          answer: `This question can't be answered from ${source.label}.`,
          datasetId: source.datasetId,
          datasetName: source.datasetName,
        }
      }
      if (error instanceof SqlExecutionError || error instanceof UnsafeSqlError) {
        this.logger.warn(`Structured query correction source=${source.label}: ${error.message}`)
        return {
          state: 'correction',
          answer: `I couldn't run a valid query for that question against ${source.label}. Could you rephrase it?`,
          datasetId: source.datasetId,
          datasetName: source.datasetName,
        }
      }
      throw error
    }
  }

  private async selectCandidates(workspaceId: string, embedding: number[]): Promise<DatasetCandidateRow[]> {
    const vectorString = `[${embedding.join(',')}]`

    const result = await db.execute<{
      id: string
      name: string
      description: string | null
      columnsSchema: DatasetColumn[] | null
      storageKey: string | null
      score: number
    }>(sql`
      SELECT
        id,
        name,
        description,
        columns_schema AS "columnsSchema",
        storage_key AS "storageKey",
        1 - (description_embedding <=> ${vectorString}::vector) AS score
      FROM datasets
      WHERE workspace_id = ${workspaceId}::uuid
        AND status = 'done'
        AND description_embedding IS NOT NULL
      ORDER BY description_embedding <=> ${vectorString}::vector
      LIMIT 3
    `)

    return result.rows
  }

  private verbalize(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) {
      return 'No matching rows found.'
    }

    const headers = Object.keys(rows[0])
    const headerLine = `| ${headers.join(' | ')} |`
    const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`
    const dataLines = rows.map((row) => `| ${headers.map((header) => String(row[header] ?? '')).join(' | ')} |`)

    return [headerLine, separatorLine, ...dataLines].join('\n')
  }
}
