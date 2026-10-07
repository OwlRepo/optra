import { createHmac } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { LS_STORE_ID, LS_VARIANT_SOLO, LS_VARIANT_TEAM, LS_WEBHOOK_SECRET, WEB_URL } from './env'

// Builds and signs Lemon Squeezy webhook deliveries the way the real service
// does, so a spec can post them through the real Next.js BFF to the real API.

/** Lowercase hex HMAC-SHA256 of the exact body bytes, as X-Signature carries it. */
export function signBody(body: string): string {
  return createHmac('sha256', LS_WEBHOOK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex')
}

/** The `workspace_sig` the API's checkout puts in custom_data: hex HMAC-SHA256 of the workspace id. */
export function workspaceSig(workspaceId: string): string {
  return createHmac('sha256', LS_WEBHOOK_SECRET).update(workspaceId, 'utf8').digest('hex')
}

export interface SubscriptionEventInput {
  workspaceId: string
  subscriptionId: string
  status: string
  variantId?: string
  quantity?: number
  updatedAt?: string
  endsAt?: string | null
  renewsAt?: string | null
  userName?: string
  /** `subscription_created` unless a spec needs another event. */
  eventName?: string
}

/** The JSON string a real `subscription_created` delivery carries. */
export function subscriptionEvent(input: SubscriptionEventInput): string {
  return JSON.stringify({
    meta: {
      event_name: input.eventName ?? 'subscription_created',
      custom_data: { workspace_id: input.workspaceId, workspace_sig: workspaceSig(input.workspaceId) },
    },
    data: {
      type: 'subscriptions',
      id: input.subscriptionId,
      attributes: {
        store_id: Number(LS_STORE_ID),
        customer_id: 424242,
        variant_id: Number(input.variantId ?? LS_VARIANT_TEAM),
        status: input.status,
        first_subscription_item: { quantity: input.quantity ?? 1 },
        renews_at: input.renewsAt === undefined ? new Date(Date.now() + 30 * 86_400_000).toISOString() : input.renewsAt,
        ends_at: input.endsAt ?? null,
        updated_at: input.updatedAt ?? new Date().toISOString(),
        user_name: input.userName ?? 'E2E Buyer',
      },
    },
  })
}

export const SOLO_VARIANT = LS_VARIANT_SOLO
export const TEAM_VARIANT = LS_VARIANT_TEAM

/**
 * POSTs the exact bytes of `body` to the BFF webhook route. The signature
 * defaults to the correct one; pass another to forge a bad delivery.
 */
export async function postWebhook(
  request: APIRequestContext,
  body: string,
  signature: string = signBody(body),
): Promise<APIResponse> {
  const eventName = (JSON.parse(body) as { meta?: { event_name?: string } }).meta?.event_name ?? 'subscription_created'
  return request.post(`${WEB_URL}/api/webhooks/lemonsqueezy`, {
    data: Buffer.from(body, 'utf8'),
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature, 'X-Event-Name': eventName },
  })
}
