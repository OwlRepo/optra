import { HttpException } from '@nestjs/common'
import type { BillingStopBody, BillingStopCode } from '@repo/types'

const STATUS = 402

const MESSAGES = {
  SUBSCRIPTION_REQUIRED: 'Your workspace needs an active plan to do this. Choose a plan on the Billing page.',
  AI_BUDGET_EXCEEDED:
    "Your plan's AI allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
  matchedLines:
    "Your plan's matched-line allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
  photoChecks:
    "Your plan's photo-check allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
} as const

/** Status 402 keeps `isBudgetExceeded` (limits/usage.service.ts) and every processor's "final, no retry" branch working. */
export function billingStop(code: 'SUBSCRIPTION_REQUIRED' | 'AI_BUDGET_EXCEEDED'): HttpException
export function billingStop(code: 'QUOTA_EXCEEDED', quota: 'matchedLines' | 'photoChecks'): HttpException
export function billingStop(code: BillingStopCode, quota?: 'matchedLines' | 'photoChecks'): HttpException {
  const body: BillingStopBody =
    code === 'QUOTA_EXCEEDED' && quota
      ? { statusCode: STATUS, message: MESSAGES[quota], code, quota }
      : { statusCode: STATUS, message: MESSAGES[code as 'SUBSCRIPTION_REQUIRED' | 'AI_BUDGET_EXCEEDED'], code }
  return new HttpException(body, STATUS)
}
