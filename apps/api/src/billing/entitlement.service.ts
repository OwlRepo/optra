import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { eq } from 'drizzle-orm'
import { db, workspaceSubscriptions, workspaces } from '@repo/db'
import type { BillingSummary } from '@repo/types'
import { TRIAL_DAYS, TRIAL_QUOTAS, isEntitledStatus, quotasFor } from './plans'

const DAY_MS = 24 * 60 * 60 * 1000

@Injectable()
export class EntitlementService {
  constructor(private readonly config: ConfigService) {}

  /** Computes only: no gate, no refusal, no side effect (gates ship in S4). */
  async resolve(workspaceId: string, now: Date = new Date()): Promise<BillingSummary> {
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
      used: { matchedLines: null, photoChecks: null },
    }

    if (workspace.billingExempt) {
      return { ...base, state: 'exempt', period: null, quotas: { matchedLines: null, photoChecks: null } }
    }

    if (sub && isEntitledStatus(sub.status, sub.endsAt, now)) {
      const y = now.getUTCFullYear()
      const m = now.getUTCMonth()
      return {
        ...base,
        state: 'subscribed',
        period: { start: new Date(Date.UTC(y, m, 1)).toISOString(), end: new Date(Date.UTC(y, m + 1, 1)).toISOString() },
        quotas: quotasFor(sub.plan, sub.seats),
      }
    }

    if (workspace.trialEndsAt && now.getTime() < workspace.trialEndsAt.getTime()) {
      return {
        ...base,
        state: 'trialing',
        plan: null,
        period: {
          start: new Date(workspace.trialEndsAt.getTime() - TRIAL_DAYS * DAY_MS).toISOString(),
          end: workspace.trialEndsAt.toISOString(),
        },
        quotas: { ...TRIAL_QUOTAS },
      }
    }

    return { ...base, state: 'none', period: null, quotas: null }
  }
}
