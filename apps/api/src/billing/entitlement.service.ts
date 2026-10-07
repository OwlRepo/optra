import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { eq } from 'drizzle-orm'
import { db, workspaceSubscriptions, workspaces } from '@repo/db'
import type { BillingSummary } from '@repo/types'
import {
  TRIAL_DAYS,
  TRIAL_QUOTAS,
  aiCapMicroUsd,
  currentMonthPeriod,
  isEntitledStatus,
  quotasFor,
} from './plans'
import { UsageLedgerService } from './usage-ledger.service'

const DAY_MS = 24 * 60 * 60 * 1000

export interface AiBudget {
  usedMicroUsd: number
  capMicroUsd: number
}

@Injectable()
export class EntitlementService {
  constructor(
    private readonly config: ConfigService,
    private readonly ledger: UsageLedgerService,
  ) {}

  async resolve(workspaceId: string, now: Date = new Date()): Promise<BillingSummary> {
    return (await this.load(workspaceId, now)).summary
  }

  /** The summary plus the period's AI spend and cap, from the same two reads (the gate's single call). */
  async resolveWithAiBudget(
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<{ summary: BillingSummary; ai: AiBudget }> {
    return this.load(workspaceId, now)
  }

  private async load(workspaceId: string, now: Date): Promise<{ summary: BillingSummary; ai: AiBudget }> {
    const [[workspace], [sub]] = await Promise.all([
      db
        .select({ trialEndsAt: workspaces.trialEndsAt, billingExempt: workspaces.billingExempt })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1),
      db
        .select({
          plan: workspaceSubscriptions.plan,
          seats: workspaceSubscriptions.seats,
          status: workspaceSubscriptions.status,
          renewsAt: workspaceSubscriptions.renewsAt,
          endsAt: workspaceSubscriptions.endsAt,
        })
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
        .limit(1),
    ])
    if (!workspace) throw new NotFoundException('Workspace not found')

    const enforced = this.config.get<string>('BILLING_ENFORCEMENT') === 'on'
    const base = {
      enforced,
      plan: sub?.plan ?? null,
      seats: sub?.seats ?? null,
      subscriptionStatus: sub?.status ?? null,
      trialEndsAt: workspace.trialEndsAt?.toISOString() ?? null,
      renewsAt: sub?.renewsAt?.toISOString() ?? null,
      endsAt: sub?.endsAt?.toISOString() ?? null,
    }

    let state: BillingSummary['state']
    let period: BillingSummary['period'] = null
    let quotas: BillingSummary['quotas'] = null
    let capMicroUsd = 0
    let plan = base.plan

    if (workspace.billingExempt) {
      state = 'exempt'
      quotas = { matchedLines: null, photoChecks: null }
      capMicroUsd = aiCapMicroUsd('exempt', 1, this.config)
    } else if (sub && isEntitledStatus(sub.status, sub.endsAt, now)) {
      state = 'subscribed'
      const month = currentMonthPeriod(now)
      period = { start: month.start.toISOString(), end: month.end.toISOString() }
      quotas = quotasFor(sub.plan, sub.seats)
      capMicroUsd = aiCapMicroUsd(sub.plan, sub.seats, this.config)
    } else if (workspace.trialEndsAt && now.getTime() < workspace.trialEndsAt.getTime()) {
      state = 'trialing'
      plan = null
      period = {
        start: new Date(workspace.trialEndsAt.getTime() - TRIAL_DAYS * DAY_MS).toISOString(),
        end: workspace.trialEndsAt.toISOString(),
      }
      quotas = { ...TRIAL_QUOTAS }
      capMicroUsd = aiCapMicroUsd('trial', 1, this.config)
    } else {
      state = 'none'
    }

    // Exempt and none have no quota window; their meters read the UTC calendar month.
    const window = period ? { start: new Date(period.start), end: new Date(period.end) } : currentMonthPeriod(now)
    const sums = await this.ledger.sumsByKind(workspaceId, window)

    const summary: BillingSummary = {
      ...base,
      plan,
      state,
      period,
      quotas,
      used: {
        matchedLines: sums.matchedLines,
        photoChecks: sums.photoChecks,
        aiBudgetPercent: capMicroUsd > 0 ? Math.min(100, Math.floor((100 * sums.llmCostMicroUsd) / capMicroUsd)) : 0,
      },
    }
    return { summary, ai: { usedMicroUsd: sums.llmCostMicroUsd, capMicroUsd } }
  }
}
