// Billing contract (slice S3 "billing core", docs/plans/lemon-squeezy-billing-1-core.md;
// slice S4 "metering", docs/plans/lemon-squeezy-billing-2-metering.md).
// Request/response shapes of GET|POST /workspaces/:workspaceId/billing*, plus the
// 402 body the metered routes answer. Dates are ISO-8601 strings on the wire.
// Mirrors docs/ai/contracts/api-contracts.md.

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
 * Consumption in the current period (`BillingSummary.period`; the UTC calendar
 * month for an exempt workspace). S3 returned `null` for everything because no
 * ledger existed; from S4 the API always returns numbers. `null` stays in the
 * type so S3-shaped fixtures and a rolled-back API still type-check.
 */
export interface BillingUsed {
  /** Distinct PO/invoice pairs' PO line counts compared this period (`usage_events.kind = 'matched_line'`). */
  matchedLines: number | null
  /** Catalog searches that fanned out to the vision model this period (`kind = 'photo_check'`). */
  photoChecks: number | null
  /**
   * S4, additive. Share of the period's AI allowance already spent, an integer
   * 0..100 (floor; 100 only at or over the cap). The dollar cap and the dollar
   * spend never leave the API: public copy makes no dollar promise
   * (docs/ai/risk-register.md "Landing Pricing Copy"). `undefined` from an S3 API.
   */
  aiBudgetPercent?: number | null
}

/** GET /workspaces/:workspaceId/billing */
export interface BillingSummary {
  state: BillingState
  /**
   * `true` when BILLING_ENFORCEMENT=on: a `none` workspace is refused with
   * 402 `SUBSCRIPTION_REQUIRED`, and quota/AI-cap overruns with 402
   * `QUOTA_EXCEEDED` / `AI_BUDGET_EXCEEDED` (S4 gates). Meters still record
   * when `false`; nothing is refused. The UI uses this to decide how loudly to
   * say "subscription required".
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

/**
 * Why a metered route answered 402. Set on the response body next to the
 * existing `statusCode` / `message`; clients branch on `code`, never on the
 * message text. A 402 without `code` is the legacy token-budget refusal
 * (`BILLING_ENFORCEMENT` off), same status, same `isBudgetExceeded` handling.
 */
export type BillingStopCode =
  /** State `none` while enforcement is on: no trial, no subscription, not exempt. */
  | 'SUBSCRIPTION_REQUIRED'
  /** A new PO/invoice pair (matched lines) or a catalog search (photo checks) would pass the plan quota. */
  | 'QUOTA_EXCEEDED'
  /** The period's AI cost has reached the plan's dollar cap. */
  | 'AI_BUDGET_EXCEEDED'

/** The JSON body of every billing 402. `quota` is set only with `QUOTA_EXCEEDED`. */
export interface BillingStopBody {
  statusCode: 402
  /** A readable sentence that already points at the Billing page. */
  message: string
  code: BillingStopCode
  quota?: 'matchedLines' | 'photoChecks'
}
