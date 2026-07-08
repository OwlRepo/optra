import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import type { DatasetColumn } from '@repo/db'
import { resolveModel } from './models'

const SYSTEM_PROMPT = `You write a single read-only DuckDB SQL SELECT statement that answers the user's question against one table.

Rules:
- Output ONLY the SQL statement. No markdown code fences, no explanation, no trailing semicolon.
- Exactly one statement. SELECT or WITH...SELECT only.
- Never use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, COPY, PRAGMA, CALL, SET, INSTALL, or LOAD.
- Only reference the table and columns given below — never invent columns.
- If the question cannot be answered from the given columns, return exactly: SELECT NULL AS unanswerable WHERE FALSE`

function buildSchemaDescription(tableName: string, columns: DatasetColumn[]): string {
  const columnList = columns.map((column) => `- ${column.name} (${column.type})`).join('\n')
  return `Table: ${tableName}\nColumns:\n${columnList}`
}

export interface MultiTableSchema {
  tableName: string
  name: string
  columns: DatasetColumn[]
}

const MULTI_TABLE_SYSTEM_PROMPT = `You write a single read-only DuckDB SQL SELECT statement that answers the user's question, which may require joining or comparing MULTIPLE tables listed below.

Rules:
- Output ONLY the SQL statement. No markdown code fences, no explanation, no trailing semicolon.
- Exactly one statement. SELECT or WITH...SELECT only.
- Never use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, COPY, PRAGMA, CALL, SET, INSTALL, or LOAD.
- Only reference the tables and columns given below — never invent tables or columns.
- Use JOIN when the question compares data across tables; a plain SELECT from one table is fine if the question only needs one of them.
- If the question cannot be answered from the given tables/columns, return exactly: SELECT NULL AS unanswerable WHERE FALSE`

function buildMultiSchemaDescription(tables: MultiTableSchema[]): string {
  return tables
    .map((table) => {
      const columnList = table.columns.map((column) => `- ${column.name} (${column.type})`).join('\n')
      return `Table: ${table.tableName} (source: "${table.name}")\nColumns:\n${columnList}`
    })
    .join('\n\n')
}

const multiTableLlm = new ChatOpenAI({
  modelName: resolveModel('sql'),
  temperature: 0,
})

function extractSql(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/;\s*$/, '')
    .trim()
}

/** Same contract as generateSql but across N named tables (V2 F5: cross-file comparison) — the model may JOIN, DuckDbQueryService still re-validates independently. */
export async function generateMultiTableSql(
  question: string,
  tables: MultiTableSchema[],
  priorError?: string,
): Promise<string> {
  const schema = buildMultiSchemaDescription(tables)
  const repairNote = priorError
    ? `\n\nThe previous attempt failed with this error — fix it:\n${priorError}`
    : ''

  const response = await multiTableLlm.invoke([
    new SystemMessage(MULTI_TABLE_SYSTEM_PROMPT),
    new HumanMessage(`${schema}\n\nQuestion: ${question}${repairNote}`),
  ])

  const raw = typeof response.content === 'string' ? response.content : String(response.content)
  const sql = extractSql(raw)

  if (/unanswerable/i.test(sql) && /where\s+false/i.test(sql)) {
    throw new UnanswerableQuestionError('Question cannot be answered from these datasets')
  }

  return sql
}

const llm = new ChatOpenAI({
  modelName: resolveModel('sql'),
  temperature: 0,
})

export class UnanswerableQuestionError extends Error {}

/** Generates a single validated-shape SQL SELECT for the given dataset schema. Caller still must run it through DuckDbQueryService's own safety validation — this chain only produces a candidate, it is not the security boundary. */
export async function generateSql(
  question: string,
  tableName: string,
  columns: DatasetColumn[],
  priorError?: string,
): Promise<string> {
  const schema = buildSchemaDescription(tableName, columns)
  const repairNote = priorError
    ? `\n\nThe previous attempt failed with this error — fix it:\n${priorError}`
    : ''

  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(`${schema}\n\nQuestion: ${question}${repairNote}`),
  ])

  const raw = typeof response.content === 'string' ? response.content : String(response.content)
  const sql = raw
    .trim()
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/;\s*$/, '')
    .trim()

  if (/unanswerable/i.test(sql) && /where\s+false/i.test(sql)) {
    throw new UnanswerableQuestionError('Question cannot be answered from this dataset')
  }

  return sql
}
