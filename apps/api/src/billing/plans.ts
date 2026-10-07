import type { BillingPlan } from '@repo/types'

/**
 * Trial length in days. apps/web/src/lib/legal-facts.ts#TRIAL_DAYS states the
 * same fact for the public copy; the api cannot import apps/web, so
 * plans.spec.ts reads that file and fails if the two differ.
 */
export const TRIAL_DAYS = 14

export const SEATS_MIN = 1
export const SEATS_MAX = 25

export interface PlanQuota {
  matchedLines: number
  photoChecks: number
}

/** Mirrors the landing pricing section (program plan "Plans"). Team pools per buyer. */
export function quotasFor(plan: BillingPlan, seats: number): PlanQuota {
  return plan === 'team'
    ? { matchedLines: 2000 * seats, photoChecks: 300 * seats }
    : { matchedLines: 400, photoChecks: 100 }
}

/** The trial grants the Solo allowance (owner decision 2026-10-08). */
export const TRIAL_QUOTAS: PlanQuota = quotasFor('solo', 1)

type EnvReader = { get(key: string): string | undefined }

const VARIANT_ENV: Record<BillingPlan, string> = {
  solo: 'LEMONSQUEEZY_VARIANT_SOLO',
  team: 'LEMONSQUEEZY_VARIANT_TEAM',
}

export function variantIdFor(plan: BillingPlan, env: EnvReader): string | null {
  const value = env.get(VARIANT_ENV[plan])?.trim()
  return value ? value : null
}

export function planForVariant(variantId: string | number | null | undefined, env: EnvReader): BillingPlan | null {
  if (variantId === null || variantId === undefined || variantId === '') return null
  const id = String(variantId)
  for (const plan of ['solo', 'team'] as const) {
    if (variantIdFor(plan, env) === id) return plan
  }
  return null
}

/** LS statuses that grant access: https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object (status). */
const ENTITLED_STATUSES = new Set(['active', 'past_due', 'on_trial'])

/**
 * past_due is LS retrying the card (4 retries over 2 weeks) and stays entitled.
 * cancelled is a grace period until ends_at. paused, unpaid and expired are not.
 */
export function isEntitledStatus(status: string, endsAt: Date | null, now: Date): boolean {
  if (ENTITLED_STATUSES.has(status)) return true
  return status === 'cancelled' && endsAt !== null && now.getTime() < endsAt.getTime()
}
