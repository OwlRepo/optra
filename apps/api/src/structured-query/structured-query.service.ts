import { unlink } from 'fs/promises'
import { Injectable, Logger } from '@nestjs/common'
import { and, count, eq, sql } from 'drizzle-orm'
import { datasets, db, type DatasetColumn } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { DuckDbQueryService, SqlExecutionError, UnsafeSqlError } from './duckdb-query.service'

export type StructuredQueryState = 'confident' | 'ambiguous' | 'correction' | 'empty'

export interface StructuredQueryCandidate {
  id: string
  name: string
  description: string | null
}

export interface StructuredQueryResult {
  state: StructuredQueryState
  answer: string
  datasetId?: string
  datasetName?: string
  candidates?: StructuredQueryCandidate[]
}

const TABLE_NAME = 'dataset'
const CONFIDENT_MIN_SCORE = Number.parseFloat(process.env.STRUCTURED_QUERY_MIN_SCORE ?? '0.5')
const AMBIGUOUS_SCORE_GAP = Number.parseFloat(process.env.STRUCTURED_QUERY_AMBIGUOUS_GAP ?? '0.05')

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
    const { embedQuery } = await import('@repo/ai')

    const embedding = await embedQuery(question)
    const candidates = await this.selectCandidates(workspaceId, embedding)

    if (candidates.length === 0) {
      return {
        state: 'empty',
        answer: "I don't see any ready datasets in this workspace yet. Upload a CSV to get started.",
      }
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
