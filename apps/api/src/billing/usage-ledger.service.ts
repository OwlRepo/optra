import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { TokenMeter } from '@repo/ai'
import { db, usageEvents } from '@repo/db'
import { and, eq, gte, lt, sql } from 'drizzle-orm'

export type ReserveResult = 'charged' | 'duplicate' | 'over'

export interface Window {
  start: Date
  end: Date
}

/**
 * The append-only billing ledger (usage_events). Quota checks and their insert
 * share one transaction under a per-workspace advisory lock (the same lock the
 * Lemon Squeezy webhook takes), so two simultaneous requests cannot both pass
 * the check. occurred_at is always written from the app clock, never the DB default.
 */
@Injectable()
export class UsageLedgerService {
  async reserve(input: {
    workspaceId: string
    kind: 'matched_line' | 'photo_check'
    idempotencyKey: string
    quantity: number
    limit: number | null
    window: Window
    now?: Date
  }): Promise<ReserveResult> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId}))`)

      const [existing] = await tx
        .select({ id: usageEvents.id })
        .from(usageEvents)
        .where(and(eq(usageEvents.workspaceId, input.workspaceId), eq(usageEvents.idempotencyKey, input.idempotencyKey)))
        .limit(1)
      if (existing) return 'duplicate'

      if (input.limit !== null) {
        const [row] = await tx
          .select({ total: sql<string>`coalesce(sum(${usageEvents.quantity}), 0)::text` })
          .from(usageEvents)
          .where(
            and(
              eq(usageEvents.workspaceId, input.workspaceId),
              eq(usageEvents.kind, input.kind),
              gte(usageEvents.occurredAt, input.window.start),
              lt(usageEvents.occurredAt, input.window.end),
            ),
          )
        if (Number(row?.total ?? 0) + input.quantity > input.limit) return 'over'
      }

      const inserted = await tx
        .insert(usageEvents)
        .values({
          workspaceId: input.workspaceId,
          kind: input.kind,
          quantity: input.quantity,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.now ?? new Date(),
        })
        .onConflictDoNothing({ target: usageEvents.idempotencyKey })
        .returning({ id: usageEvents.id })
      return inserted.length === 0 ? 'duplicate' : 'charged'
    })
  }

  /** Throws on a database error; BillingGateService.recordLlmCost catches it. */
  async recordLlmCost(input: {
    workspaceId: string
    meter: Pick<TokenMeter, 'total' | 'costMicroUsd' | 'inputTokens' | 'outputTokens' | 'dominantModel'>
    now?: Date
  }): Promise<void> {
    if (input.meter.total === 0) return
    await db.insert(usageEvents).values({
      workspaceId: input.workspaceId,
      kind: 'llm_cost',
      quantity: input.meter.costMicroUsd,
      inputTokens: input.meter.inputTokens,
      outputTokens: input.meter.outputTokens,
      model: input.meter.dominantModel?.slice(0, 64) ?? null,
      idempotencyKey: `llm:${randomUUID()}`,
      occurredAt: input.now ?? new Date(),
    })
  }

  async sumsByKind(
    workspaceId: string,
    window: Window,
  ): Promise<{ matchedLines: number; photoChecks: number; llmCostMicroUsd: number }> {
    const rows = await db
      .select({ kind: usageEvents.kind, total: sql<string>`coalesce(sum(${usageEvents.quantity}), 0)::text` })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.workspaceId, workspaceId),
          gte(usageEvents.occurredAt, window.start),
          lt(usageEvents.occurredAt, window.end),
        ),
      )
      .groupBy(usageEvents.kind)
    const by = new Map(rows.map((row) => [row.kind, Number(row.total)]))
    return {
      matchedLines: by.get('matched_line') ?? 0,
      photoChecks: by.get('photo_check') ?? 0,
      llmCostMicroUsd: by.get('llm_cost') ?? 0,
    }
  }
}
