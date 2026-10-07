import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './index'
import { billingEvents } from './billingEvents'
import { billingPlanEnum, workspaceSubscriptions } from './workspaceSubscriptions'
import { workspaces } from './workspaces'

const drizzleDir = join(__dirname, '..', '..', 'drizzle')

function uniqueIndexColumns(table: Parameters<typeof getTableConfig>[0]): string[][] {
  return getTableConfig(table)
    .indexes.filter((i) => i.config.unique)
    .map((i) => i.config.columns.map((c) => (c as { name: string }).name))
}

// Repo convention: timestamp without timezone, same mode as workspaces.createdAt.
function expectRepoTimestamp(col: unknown) {
  const c = col as { columnType: string; withTimezone: boolean; mode: string }
  const ref = getTableColumns(workspaces).createdAt as unknown as typeof c
  expect(c.columnType).toBe('PgTimestamp')
  expect(c.withTimezone).toBe(false)
  expect(c.mode).toBe(ref.mode)
}

describe('billing columns and tables (migration 0037)', () => {
  it('error: workspaces.billing_exempt is NOT NULL with default false', () => {
    const col = getTableColumns(workspaces).billingExempt
    expect(col, 'billingExempt missing').toBeDefined()
    expect(col.name).toBe('billing_exempt')
    expect(col.notNull).toBe(true)
    expect(col.hasDefault).toBe(true)
    expect(col.default).toBe(false)
  })

  it('error: workspace_subscriptions.workspace_id is NOT NULL and cascades on workspace delete', () => {
    const col = getTableColumns(workspaceSubscriptions).workspaceId
    expect(col.name).toBe('workspace_id')
    expect(col.notNull).toBe(true)
    const fks = getTableConfig(workspaceSubscriptions).foreignKeys
    const fk = fks.find((f) => f.reference().columns.some((c) => c.name === 'workspace_id'))
    expect(fk, 'workspace_id foreign key missing').toBeDefined()
    expect(fk!.onDelete).toBe('cascade')
    expect(fk!.reference().foreignTable).toBe(workspaces)
  })

  it('edge: workspaces.trial_ends_at is a nullable timestamp (repo convention, no timezone) with no default', () => {
    const col = getTableColumns(workspaces).trialEndsAt
    expect(col, 'trialEndsAt missing').toBeDefined()
    expect(col.name).toBe('trial_ends_at')
    expect(col.notNull).toBe(false)
    expect(col.hasDefault).toBe(false)
    expectRepoTimestamp(col)
  })

  it('edge: every new timestamp column follows the repo timestamp convention', () => {
    const subs = getTableColumns(workspaceSubscriptions)
    const events = getTableColumns(billingEvents)
    for (const col of [
      subs.renewsAt,
      subs.endsAt,
      subs.lsUpdatedAt,
      subs.createdAt,
      subs.updatedAt,
      events.receivedAt,
      events.processedAt,
    ]) {
      expect(col, 'timestamp column missing').toBeDefined()
      expectRepoTimestamp(col)
    }
  })

  it('edge: workspace_subscriptions has unique indexes on workspace_id and ls_subscription_id', () => {
    const unique = uniqueIndexColumns(workspaceSubscriptions)
    expect(unique).toContainEqual(['workspace_id'])
    expect(unique).toContainEqual(['ls_subscription_id'])
  })

  it('edge: billing_events.body_sha256 is unique and payload is NOT NULL', () => {
    const cols = getTableColumns(billingEvents)
    expect(cols.bodySha256.name).toBe('body_sha256')
    expect(cols.payload.notNull).toBe(true)
    expect(uniqueIndexColumns(billingEvents)).toContainEqual(['body_sha256'])
  })

  it('edge: billing_events.processed_at and last_error are nullable', () => {
    const cols = getTableColumns(billingEvents)
    expect(cols.processedAt.name).toBe('processed_at')
    expect(cols.processedAt.notNull).toBe(false)
    expect(cols.lastError.name).toBe('last_error')
    expect(cols.lastError.notNull).toBe(false)
  })

  it('regression: migration 0037 contains no DROP, RENAME or SET NOT NULL on an existing column', () => {
    const files = readdirSync(drizzleDir).filter((f) => /^0037_.*\.sql$/.test(f))
    expect(files, 'drizzle/0037_*.sql missing').toHaveLength(1)
    const sql = readFileSync(join(drizzleDir, files[0]), 'utf8')
    expect(sql).toContain('billing_exempt')
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/\bRENAME\b/i)
    expect(sql).not.toMatch(/SET NOT NULL/i)
  })

  it('regression: the billing_plan enum holds exactly solo and team', () => {
    expect(billingPlanEnum.enumName).toBe('billing_plan')
    expect(billingPlanEnum.enumValues).toEqual(['solo', 'team'])
  })

  it('happy: the schema index exports workspaceSubscriptions and billingEvents', () => {
    expect(schema.workspaceSubscriptions).toBe(workspaceSubscriptions)
    expect(schema.billingEvents).toBe(billingEvents)
  })
})
