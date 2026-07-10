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
  opts?: { purchaseOrderId?: string; invoiceId?: string; status?: DiscrepancyFlagStatus },
): Promise<DiscrepancyFlag[]> {
  const params = new URLSearchParams()
  if (opts?.purchaseOrderId) params.set('purchaseOrderId', opts.purchaseOrderId)
  if (opts?.invoiceId) params.set('invoiceId', opts.invoiceId)
  if (opts?.status) params.set('status', opts.status)
  const query = params.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/procurement/discrepancies${query ? `?${query}` : ''}`)
}

export function dismissDiscrepancy(workspaceId: string, flagId: string): Promise<DiscrepancyFlag> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/discrepancies/${flagId}/dismiss`, {
    method: 'PATCH',
  })
}
