import type { BillingStopBody, BillingStopCode } from '@repo/types'

export const BILLING_STOP_EVENT = 'optra:billing-stop'

const CODES: readonly BillingStopCode[] = ['SUBSCRIPTION_REQUIRED', 'QUOTA_EXCEEDED', 'AI_BUDGET_EXCEEDED']

/** A 402 body that carries a known `code`; anything else (including the legacy token-budget 402) is not a billing stop. */
export function billingStopFrom(value: unknown): BillingStopBody | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (body.statusCode !== 402) return null
  if (typeof body.message !== 'string' || !CODES.includes(body.code as BillingStopCode)) return null
  const quota = body.quota === 'matchedLines' || body.quota === 'photoChecks' ? body.quota : undefined
  return {
    statusCode: 402,
    message: body.message,
    code: body.code as BillingStopCode,
    ...(quota ? { quota } : {}),
  }
}

/** Tells the workspace shell a billing stop happened; callers still throw the body as before. */
export function announceBillingStop(value: unknown): void {
  const stop = billingStopFrom(value)
  if (!stop || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<BillingStopBody>(BILLING_STOP_EVENT, { detail: stop }))
}

/** For the chat stream, which does not go through apiFetch: reads the 402 body from a clone. */
export async function announceBillingStopResponse(response: Response): Promise<void> {
  if (response.status !== 402) return
  announceBillingStop(await response.clone().json().catch(() => null))
}
