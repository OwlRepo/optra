import type { BillingSummary, CreateCheckoutRequest, CreateCheckoutResponse, PortalResponse } from '@repo/types'
import { apiFetch } from './client'

export function getBilling(workspaceId: string): Promise<BillingSummary> {
  return apiFetch(`/api/workspaces/${workspaceId}/billing`)
}

export function startCheckout(workspaceId: string, input: CreateCheckoutRequest): Promise<CreateCheckoutResponse> {
  return apiFetch(`/api/workspaces/${workspaceId}/billing/checkout`, { method: 'POST', body: JSON.stringify(input) })
}

export function openPortal(workspaceId: string): Promise<PortalResponse> {
  return apiFetch(`/api/workspaces/${workspaceId}/billing/portal`, { method: 'POST' })
}
