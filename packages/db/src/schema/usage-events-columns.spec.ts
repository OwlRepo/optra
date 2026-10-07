import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './index'
import { usageEvents, usageKindEnum } from './usageEvents'
import { workspaces } from './workspaces'

const drizzleDir = join(__dirname, '..', '..', 'drizzle')

function indexes() {
  return getTableConfig(usageEvents).indexes.map((i) => ({
    unique: Boolean(i.config.unique),
    columns: i.config.columns.map((c) => (c as { name: string }).name),
  }))
}

describe('usage_events ledger columns (migration 0038)', () => {
  it('error: usage_events.workspace_id is NOT NULL and cascades on workspace delete', () => {
    const col = getTableColumns(usageEvents).workspaceId
    expect(col.name).toBe('workspace_id')
    expect(col.notNull).toBe(true)
    const fk = getTableConfig(usageEvents).foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === 'workspace_id'),
    )
    expect(fk, 'workspace_id foreign key missing').toBeDefined()
    expect(fk!.onDelete).toBe('cascade')
    expect(fk!.reference().foreignTable).toBe(workspaces)
  })

  it('error: usage_events.kind, quantity, idempotency_key and occurred_at are NOT NULL', () => {
    const cols = getTableColumns(usageEvents)
    for (const col of [cols.kind, cols.quantity, cols.idempotencyKey, cols.occurredAt]) {
      expect(col.notNull).toBe(true)
    }
    expect(cols.kind.name).toBe('kind')
    expect(cols.quantity.name).toBe('quantity')
    expect(cols.idempotencyKey.name).toBe('idempotency_key')
    expect(cols.occurredAt.name).toBe('occurred_at')
  })

  it('edge: usage_events.idempotency_key has a unique index', () => {
    expect(indexes()).toContainEqual({ unique: true, columns: ['idempotency_key'] })
  })

  it('edge: usage_events has an index on (workspace_id, kind, occurred_at) in that order', () => {
    expect(indexes()).toContainEqual({ unique: false, columns: ['workspace_id', 'kind', 'occurred_at'] })
  })

  it('edge: input_tokens, output_tokens and model are nullable', () => {
    const cols = getTableColumns(usageEvents)
    expect(cols.inputTokens.name).toBe('input_tokens')
    expect(cols.outputTokens.name).toBe('output_tokens')
    expect(cols.model.name).toBe('model')
    expect(cols.inputTokens.notNull).toBe(false)
    expect(cols.outputTokens.notNull).toBe(false)
    expect(cols.model.notNull).toBe(false)
  })

  it('regression: migration 0038 contains no DROP, RENAME or SET NOT NULL on an existing column', () => {
    const files = readdirSync(drizzleDir).filter((f) => /^0038_.*\.sql$/.test(f))
    expect(files, 'drizzle/0038_*.sql missing').toHaveLength(1)
    const sql = readFileSync(join(drizzleDir, files[0]), 'utf8')
    expect(sql).toContain('usage_events')
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/\bRENAME\b/i)
    expect(sql).not.toMatch(/SET NOT NULL/i)
  })

  it('regression: the usage_kind enum holds exactly matched_line, photo_check and llm_cost', () => {
    expect(usageKindEnum.enumName).toBe('usage_kind')
    expect(usageKindEnum.enumValues).toEqual(['matched_line', 'photo_check', 'llm_cost'])
  })

  it('happy: the schema index exports usageEvents and usageKindEnum', () => {
    expect(schema.usageEvents).toBe(usageEvents)
    expect(schema.usageKindEnum).toBe(usageKindEnum)
  })
})
