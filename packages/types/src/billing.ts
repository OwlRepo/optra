// Billing contract (slice S3 "billing core", docs/plans/lemon-squeezy-billing-1-core.md).
// Request/response shapes of GET|POST /workspaces/:workspaceId/billing*. Dates
// are ISO-8601 strings on the wire. Mirrors docs/ai/contracts/api-contracts.md.

/** The two paid plans. The trial and the exempt flag are states, not plans. */
export type BillingPlan = 'solo' | 'team'

/**
 * What a workspace is entitled to right now, decided by
 * `EntitlementService.resolve` (apps/api/src/billing/entitlement.service.ts).
 * Precedence: `exempt` > `subscribed` > `trialing` > `none`.
 */
export type BillingState = 'exempt' | 'subscribed' | 'trialing' | 'none'

/** A monthly allowance. `null` = unlimited (exempt workspaces). */
export interface BillingQuotas {
  /** Matched PO/invoice lines per period. */
  matchedLines: number | null
  /** Photo catalog checks per period. */
  photoChecks: number | null
}

/**
 * Consumption in the current period. `null` = not metered yet: the usage
 * ledger ships in slice S4, so S3 always returns `null` for both.
 */
export interface BillingUsed {
  matchedLines: number | null
  photoChecks: number | null
}

/** GET /workspaces/:workspaceId/billing */
export interface BillingSummary {
  state: BillingState
  /**
   * `true` when BILLING_ENFORCEMENT=on: a `none` workspace is refused. In S3
   * nothing is refused yet (gates ship in S4), so the UI uses this only to
   * decide how loudly to say "subscription required".
   */
  enforced: boolean
  /** The paid plan; `null` while `trialing`, `exempt` or `none`. */
  plan: BillingPlan | null
  /** Billed buyers (team) or 1 (solo); `null` without a subscription. */
  seats: number | null
  /** LS subscription status as last received (`active`, `past_due`, `cancelled`, ...); `null` without a subscription. */
  subscriptionStatus: string | null
  /** End of the app-side trial; set only for a workspace's first, trial-eligible creation. */
  trialEndsAt: string | null
  /** Next renewal; `null` unless subscribed. */
  renewsAt: string | null
  /** When a cancelled/expired subscription stops (or stopped) granting access. */
  endsAt: string | null
  /** The quota window: UTC calendar month for paid plans, trial start..end while trialing. `null` for `none`/`exempt`. */
  period: { start: string; end: string } | null
  /** `null` for `none`. While `trialing` these are the Solo quotas. */
  quotas: BillingQuotas | null
  used: BillingUsed
}

/** POST /workspaces/:workspaceId/billing/checkout */
export interface CreateCheckoutRequest {
  plan: BillingPlan
  /** Team only, integer 1..25, default 1. Sending it with `solo` is a 400. */
  seats?: number
}

export interface CreateCheckoutResponse {
  /** Hosted Lemon Squeezy checkout URL; the browser navigates to it. */
  url: string
}

/** POST /workspaces/:workspaceId/billing/portal */
export interface PortalResponse {
  /** Signed, expiring Lemon Squeezy customer-portal URL. */
  url: string
}
