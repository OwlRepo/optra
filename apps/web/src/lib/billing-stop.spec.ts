/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BILLING_STOP_EVENT, announceBillingStop, announceBillingStopResponse, billingStopFrom } from './billing-stop'

const QUOTA_BODY = {
  statusCode: 402,
  message: "Your plan's matched-line allowance for this period is used up. Upgrade on the Billing page or wait for the next period.",
  code: 'QUOTA_EXCEEDED',
  quota: 'matchedLines',
}

describe('billingStopFrom', () => {
  it('error: a body without a code is not a billing stop', () => {
    expect(billingStopFrom({ statusCode: 402, message: 'Workspace monthly token budget reached' })).toBeNull()
    expect(billingStopFrom({ statusCode: 402, message: 'x', code: undefined })).toBeNull()
  })

  it('error: a 402 with an unknown code is not a billing stop', () => {
    expect(billingStopFrom({ statusCode: 402, message: 'x', code: 'SOMETHING_ELSE' })).toBeNull()
    expect(billingStopFrom({ statusCode: 402, message: 'x', code: 'quota_exceeded' })).toBeNull()
  })

  it('error: null, strings and a coded body with a status other than 402 are not billing stops', () => {
    expect(billingStopFrom(null)).toBeNull()
    expect(billingStopFrom(undefined)).toBeNull()
    expect(billingStopFrom('QUOTA_EXCEEDED')).toBeNull()
    expect(billingStopFrom(402)).toBeNull()
    expect(billingStopFrom({ statusCode: 403, message: 'x', code: 'QUOTA_EXCEEDED' })).toBeNull()
    expect(billingStopFrom({ statusCode: 402, message: 42, code: 'QUOTA_EXCEEDED' })).toBeNull()
  })

  it('edge: QUOTA_EXCEEDED keeps quota and drops an invalid one', () => {
    expect(billingStopFrom(QUOTA_BODY)).toEqual(QUOTA_BODY)
    expect(billingStopFrom({ ...QUOTA_BODY, quota: 'photoChecks' })).toEqual({ ...QUOTA_BODY, quota: 'photoChecks' })

    const dropped = billingStopFrom({ ...QUOTA_BODY, quota: 'bogus' })
    expect(dropped).toEqual({ statusCode: 402, message: QUOTA_BODY.message, code: 'QUOTA_EXCEEDED' })
    expect(dropped).not.toHaveProperty('quota')
  })
})

describe('announceBillingStop', () => {
  let handler: ReturnType<typeof vi.fn<(event: Event) => void>>

  beforeEach(() => {
    handler = vi.fn<(event: Event) => void>()
    window.addEventListener(BILLING_STOP_EVENT, handler)
  })

  afterEach(() => {
    window.removeEventListener(BILLING_STOP_EVENT, handler)
  })

  it('edge: announceBillingStop dispatches nothing for a non-stop and one event for a stop', () => {
    announceBillingStop({ statusCode: 402, message: 'legacy' })
    announceBillingStop(null)
    announceBillingStop({ statusCode: 500, message: 'boom' })
    expect(handler).not.toHaveBeenCalled()

    announceBillingStop(QUOTA_BODY)

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0] as CustomEvent
    expect(event.type).toBe('optra:billing-stop')
    expect(event.detail).toEqual(QUOTA_BODY)
  })

  it('edge: announceBillingStopResponse ignores non-402 responses and unreadable bodies and does not consume the original body', async () => {
    await announceBillingStopResponse(new Response(JSON.stringify(QUOTA_BODY), { status: 200 }))
    await announceBillingStopResponse(new Response(JSON.stringify(QUOTA_BODY), { status: 500 }))
    await announceBillingStopResponse(new Response('not json at all', { status: 402 }))
    expect(handler).not.toHaveBeenCalled()

    const response = new Response(JSON.stringify(QUOTA_BODY), { status: 402 })
    await announceBillingStopResponse(response)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(response.bodyUsed).toBe(false)
    expect(await response.json()).toEqual(QUOTA_BODY)
  })
})

describe('billingStopFrom codes', () => {
  it('happy: each of the three codes parses to a BillingStopBody', () => {
    for (const code of ['SUBSCRIPTION_REQUIRED', 'QUOTA_EXCEEDED', 'AI_BUDGET_EXCEEDED']) {
      expect(billingStopFrom({ statusCode: 402, message: `msg ${code}`, code })).toEqual({
        statusCode: 402,
        message: `msg ${code}`,
        code,
      })
    }
  })
})
