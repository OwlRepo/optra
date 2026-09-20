import { apiFetch, uploadFile } from './client'

export type ProcurementDocStatus = 'pending' | 'processing' | 'done' | 'failed'
export type ProcurementDocSummary = { id: string; name: string; status: ProcurementDocStatus }
export type ProcurementDoc = {
  id: string
  name: string
  status: ProcurementDocStatus
  rowCount: number | null
  lastError: string | null
  createdAt: string
}
export type DiscrepancyFlagType = 'quantity_mismatch' | 'price_mismatch' | 'missing_on_invoice' | 'missing_on_po'
export type DiscrepancyFlagStatus = 'open' | 'dismissed'
export type DiscrepancyFlag = {
  id: string
  workspaceId: string
  purchaseOrderId: string
  invoiceId: string
  // Null on flags written before comparison runs existed (S1).
  comparisonRunId: string | null
  poLineItemId: string | null
  invoiceLineItemId: string | null
  sku: string | null
  flagType: DiscrepancyFlagType
  poValue: string | null
  invoiceValue: string | null
  delta: string | null
  reason: string
  status: DiscrepancyFlagStatus
  dismissedAt: string | null
  dismissedBy: string | null
  createdAt: string
}
export type CompareResult = {
  runId: string
  comparedAt: string
  counts: {
    quantity_mismatch: number
    price_mismatch: number
    missing_on_invoice: number
    missing_on_po: number
  }
  flags: DiscrepancyFlag[]
}

export function uploadPurchaseOrder(workspaceId: string, file: File): Promise<ProcurementDocSummary> {
  return uploadFile(`/api/workspaces/${workspaceId}/procurement/purchase-orders`, file)
}

export function listPurchaseOrders(workspaceId: string): Promise<ProcurementDoc[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/purchase-orders`)
}

export function uploadInvoice(workspaceId: string, file: File): Promise<ProcurementDocSummary> {
  return uploadFile(`/api/workspaces/${workspaceId}/procurement/invoices`, file)
}

export function listInvoices(workspaceId: string): Promise<ProcurementDoc[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/invoices`)
}

export function compareDocuments(
  workspaceId: string,
  payload: { purchaseOrderId: string; invoiceId: string },
): Promise<CompareResult> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/discrepancies/compare`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listDiscrepancies(
  workspaceId: string,
  // Omitting runId returns the current flags: the latest succeeded run for
  // each PO/invoice pair, plus pre-S1 flags for pairs never re-compared.
  opts?: { purchaseOrderId?: string; invoiceId?: string; status?: DiscrepancyFlagStatus; runId?: string },
): Promise<DiscrepancyFlag[]> {
  const params = new URLSearchParams()
  if (opts?.purchaseOrderId) params.set('purchaseOrderId', opts.purchaseOrderId)
  if (opts?.invoiceId) params.set('invoiceId', opts.invoiceId)
  if (opts?.status) params.set('status', opts.status)
  if (opts?.runId) params.set('runId', opts.runId)
  const query = params.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/procurement/discrepancies${query ? `?${query}` : ''}`)
}

export type DiscrepancyDecisionOutcome = 'false_positive' | 'approved_exception' | 'vendor_dispute' | 'resolved'

export type DiscrepancyDecision = {
  id: string
  discrepancyFlagId: string
  comparisonRunId: string | null
  actorUserId: string | null
  actorRole: string
  outcome: DiscrepancyDecisionOutcome
  note: string
  createdAt: string
}

/** Append-only history, oldest first. Readable by any workspace member. */
export function listDiscrepancyDecisions(workspaceId: string, flagId: string): Promise<DiscrepancyDecision[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/discrepancies/${flagId}/decisions`)
}

/** Owner/admin only. The note is required — see POLICY v1 #7. */
export function recordDiscrepancyDecision(
  workspaceId: string,
  flagId: string,
  payload: { outcome: DiscrepancyDecisionOutcome; note: string },
): Promise<DiscrepancyDecision> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/discrepancies/${flagId}/decisions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function dismissDiscrepancy(workspaceId: string, flagId: string): Promise<DiscrepancyFlag> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/discrepancies/${flagId}/dismiss`, {
    method: 'PATCH',
  })
}
