import { apiFetch, uploadFile, uploadFiles } from './client'
import { fetchDownload } from '../http/download'

/** What the vision model thought the photographed document was. */
export type DetectedProcurementKind = 'purchase_order' | 'invoice' | 'goods_receipt' | 'unknown'
export type ProcurementDocStatus = 'pending' | 'processing' | 'done' | 'failed'
export type ProcurementDocSummary = { id: string; name: string; status: ProcurementDocStatus }
export type ProcurementDoc = {
  id: string
  name: string
  status: ProcurementDocStatus
  rowCount: number | null
  lastError: string | null
  createdAt: string
  // False when the header row has no stored object behind it — the column is
  // nullable, so a document can exist with nothing to download.
  hasSourceFile: boolean
  // S3b header fields. All nullable: documents uploaded before migration 0025
  // have none of them, and the table renders a dash rather than hiding the row.
  currency: string | null
  // Purchase orders only.
  poNumber?: string | null
  // S9. When the order was placed, if the uploader said. Null means they did
  // not, and the table shows the upload date instead, labelled as such.
  orderedAt?: string | null
  vendorId?: string | null
  vendorName?: string | null
  // Invoices only.
  invoiceNumber?: string | null
  // Invoices and goods receipts: both link to the PO they answer.
  purchaseOrderId?: string | null
  // Goods receipts only (S5). No currency — a receipt records what arrived,
  // not what it cost.
  grnNumber?: string | null
  // Photo intake. Optional: an API older than migration 0036 omits them.
  // `sourceKind` is 'image' for a photographed document. A photo document is
  // never compared until a person confirms what was read (`reviewedAt`).
  sourceKind?: string
  pageCount?: number | null
  reviewRequired?: boolean
  reviewedAt?: string | null
  detectedKind?: DetectedProcurementKind | null
}

// POLICY v1 #3: the vendor is chosen from the workspace's existing vendors.
export type PurchaseOrderHeader = {
  vendorId: string
  poNumber: string
  currency: string
  // S9. Optional. Contract applicability asks which agreed price was live when
  // the order was PLACED, which is not the same as when the file was uploaded.
  orderedAt?: string
}

// POLICY v1 #2: the user selects the PO; a number read off the document is
// advisory and never auto-links.
export type InvoiceHeader = {
  purchaseOrderId: string
  invoiceNumber: string
  currency: string
}

// Same explicit link (POLICY v1 #2). No currency: a goods receipt records what
// arrived, not what it cost.
export type GoodsReceiptHeader = {
  purchaseOrderId: string
  grnNumber: string
}

export type ProcurementDocKind = 'purchase-orders' | 'invoices' | 'goods-receipts'
// S6. Eight values in three groups: the four original PO-vs-invoice types, the
// two receiving types, and the two "needs review" types — the pair POLICY v1 #4
// and #6 route there, recognisable by carrying no delta.
export type DiscrepancyFlagType =
  | 'quantity_mismatch'
  | 'price_mismatch'
  | 'missing_on_invoice'
  | 'missing_on_po'
  | 'short_receipt'
  | 'invoice_exceeds_received'
  | 'uom_mismatch'
  | 'currency_mismatch'
  | 'contract_price_variance'
  | 'contract_price_unavailable'
export type DiscrepancyFlagStatus = 'open' | 'dismissed'
// S2. Mirrors DiscrepancyLineCitation in @repo/types. No page number, by design.
export type DiscrepancyLineCitation = {
  lineNumber: number | null
  sourceRow: number | null
  sourceSheet: string | null
  extractionConfidence: number | null
  documentId: string
  // Line provenance: 'csv' | 'xlsx' | 'pdf-extraction' | 'image-extraction' | 'manual'.
  sourceKind?: string | null
  // Set when a reviewer corrected the line before it was compared.
  editedAt?: string | null
}
export type DiscrepancyFlag = {
  id: string
  workspaceId: string
  purchaseOrderId: string
  invoiceId: string
  // Null on flags written before comparison runs existed (S1).
  comparisonRunId: string | null
  poLineItemId: string | null
  invoiceLineItemId: string | null
  // S6. Null on every pre-0027 flag, and on any flag the receiving side had no
  // part in — including `currency_mismatch`, which belongs to the two document
  // headers and references no line at all.
  goodsReceiptLineItemId: string | null
  sku: string | null
  flagType: DiscrepancyFlagType
  poValue: string | null
  // What was actually accepted, between ordered and billed. On `uom_mismatch`
  // these three columns carry units rather than quantities: the unit is what is
  // in dispute, and no quantity comparison is valid across different ones.
  receivedValue: string | null
  invoiceValue: string | null
  // S9. The unit prices behind the line, on every flag that has one — not only
  // on `price_mismatch`. Null means the side stated no single price.
  poUnitPrice: string | null
  invoiceUnitPrice: string | null
  // S9. Only the two `contract_price_*` types carry these: the agreed price
  // this line was judged against, and which term said so. Null on an
  // unavailable finding, because the point of that type is that the system
  // will not name a price.
  contractUnitPrice: string | null
  contractTermId: string | null
  // Null whenever no difference can honestly be computed — both needs-review
  // types, by POLICY v1 #4.
  delta: string | null
  reason: string
  status: DiscrepancyFlagStatus
  dismissedAt: string | null
  dismissedBy: string | null
  createdAt: string
  // S2. Optional-safe: absent on responses from an API older than the contract.
  poLine?: DiscrepancyLineCitation | null
  invoiceLine?: DiscrepancyLineCitation | null
  receiptLine?: DiscrepancyLineCitation | null
}
export type CompareResult = {
  runId: string
  comparedAt: string
  counts: {
    quantity_mismatch: number
    price_mismatch: number
    missing_on_invoice: number
    missing_on_po: number
    short_receipt: number
    invoice_exceeds_received: number
    uom_mismatch: number
    currency_mismatch: number
  }
  flags: DiscrepancyFlag[]
}

export function uploadPurchaseOrder(
  workspaceId: string,
  file: File,
  header: PurchaseOrderHeader,
): Promise<ProcurementDocSummary> {
  return uploadFile(`/api/workspaces/${workspaceId}/procurement/purchase-orders`, file, { ...header })
}

export function listPurchaseOrders(workspaceId: string): Promise<ProcurementDoc[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/purchase-orders`)
}

export function uploadInvoice(
  workspaceId: string,
  file: File,
  header: InvoiceHeader,
): Promise<ProcurementDocSummary> {
  return uploadFile(`/api/workspaces/${workspaceId}/procurement/invoices`, file, { ...header })
}

export function listInvoices(workspaceId: string): Promise<ProcurementDoc[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/invoices`)
}

export function uploadGoodsReceipt(
  workspaceId: string,
  file: File,
  header: GoodsReceiptHeader,
): Promise<ProcurementDocSummary> {
  return uploadFile(`/api/workspaces/${workspaceId}/procurement/goods-receipts`, file, { ...header })
}

export function listGoodsReceipts(workspaceId: string): Promise<ProcurementDoc[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/goods-receipts`)
}

// Photo intake: 1-5 photos of one paper document, stitched server-side into one
// document that waits for a human review before it is compared.
export function uploadPurchaseOrderPhotos(
  workspaceId: string,
  files: File[],
  header: PurchaseOrderHeader,
): Promise<ProcurementDocSummary> {
  return uploadFiles(`/api/workspaces/${workspaceId}/procurement/purchase-orders/photos`, files, { ...header })
}

export function uploadInvoicePhotos(
  workspaceId: string,
  files: File[],
  header: InvoiceHeader,
): Promise<ProcurementDocSummary> {
  return uploadFiles(`/api/workspaces/${workspaceId}/procurement/invoices/photos`, files, { ...header })
}

export function uploadGoodsReceiptPhotos(
  workspaceId: string,
  files: File[],
  header: GoodsReceiptHeader,
): Promise<ProcurementDocSummary> {
  return uploadFiles(`/api/workspaces/${workspaceId}/procurement/goods-receipts/photos`, files, { ...header })
}

// Mirrors ProcurementReviewDocument / ProcurementReviewLine / ReviewLineInput
// in @repo/types; this app does not import that package. Decimals are strings.
export type ProcurementReviewDocument = {
  id: string
  name: string
  status: ProcurementDocStatus
  sourceKind: string
  pageCount: number | null
  detectedKind: DetectedProcurementKind | null
  reviewRequired: boolean
  reviewedAt: string | null
  reviewedBy: string | null
}

export type ProcurementReviewLine = {
  id: string
  lineNumber: number | null
  sku: string | null
  description: string | null
  quantity: string | null
  unitPrice: string | null
  lineTotal: string | null
  uom: string | null
  // Goods receipts only.
  quantityReceived?: string | null
  quantityAccepted?: string | null
  quantityRejected?: string | null
  extractionConfidence: number | null
  sourceKind: string
  editedAt: string | null
  editedBy: string | null
}

export type ProcurementDocumentLines = {
  document: ProcurementReviewDocument
  items: ProcurementReviewLine[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// With `id`: an existing line (kept or edited). Without: a new line. Existing
// lines left out of the body are deleted.
export type ReviewLineInput = {
  id?: string
  sku?: string | null
  description?: string | null
  quantity?: string | null
  unitPrice?: string | null
  lineTotal?: string | null
  uom?: string | null
  quantityReceived?: string | null
  quantityAccepted?: string | null
  quantityRejected?: string | null
}

export type ReviewDocumentResponse = { id: string; reviewedAt: string; rowCount: number }

export function listDocumentLines(
  workspaceId: string,
  kind: ProcurementDocKind,
  docId: string,
  opts?: { page?: number; pageSize?: number },
): Promise<ProcurementDocumentLines> {
  const params = new URLSearchParams()
  if (opts?.page) params.set('page', String(opts.page))
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const query = params.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/procurement/${kind}/${docId}/lines${query ? `?${query}` : ''}`)
}

/** Owner/admin only. Full replacement of the document's lines, 1-200. */
export function reviewDocument(
  workspaceId: string,
  kind: ProcurementDocKind,
  docId: string,
  payload: { lines: ReviewLineInput[] },
): Promise<ReviewDocumentResponse> {
  return apiFetch(`/api/workspaces/${workspaceId}/procurement/${kind}/${docId}/review`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** URL of one normalized page image; the BFF attaches the bearer, so an <img> can load it. */
export function documentPageUrl(workspaceId: string, kind: ProcurementDocKind, docId: string, n: number): string {
  return `/api/workspaces/${workspaceId}/procurement/${kind}/${docId}/pages/${n}`
}

/**
 * Downloads the original uploaded file. Always an attachment, and the browser
 * names it from the API's Content-Disposition via `fetchDownload`.
 */
export function downloadProcurementDocument(workspaceId: string, kind: ProcurementDocKind, docId: string) {
  return fetchDownload(
    `/api/workspaces/${workspaceId}/procurement/${kind}/${docId}/download`,
    { method: 'GET' },
    kind === 'purchase-orders' ? 'purchase-order' : kind === 'invoices' ? 'invoice' : 'goods-receipt',
  )
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

export type DiscrepancyFlagCounts = Record<DiscrepancyFlagType, number>

/**
 * Offset paging, the house convention for admin tables.
 *
 * `counts` describes the whole filtered set, not the page. The stat cards read
 * it, and computing them from `items` would report whatever happened to land
 * on screen. They always carry all eight types, zero-filled.
 */
export type DiscrepancyListResult = {
  items: DiscrepancyFlag[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  counts: DiscrepancyFlagCounts
}

export function listDiscrepancies(
  workspaceId: string,
  // Omitting runId returns the current flags: the latest succeeded run for
  // each PO/invoice pair, plus pre-S1 flags for pairs never re-compared.
  opts?: {
    purchaseOrderId?: string
    invoiceId?: string
    status?: DiscrepancyFlagStatus
    runId?: string
    page?: number
    pageSize?: number
  },
): Promise<DiscrepancyListResult> {
  const params = new URLSearchParams()
  if (opts?.purchaseOrderId) params.set('purchaseOrderId', opts.purchaseOrderId)
  if (opts?.invoiceId) params.set('invoiceId', opts.invoiceId)
  if (opts?.status) params.set('status', opts.status)
  if (opts?.runId) params.set('runId', opts.runId)
  if (opts?.page) params.set('page', String(opts.page))
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const query = params.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/procurement/discrepancies${query ? `?${query}` : ''}`)
}

export type DiscrepancyDecisionOutcome = 'false_positive' | 'approved_exception' | 'vendor_dispute' | 'resolved'

export type DiscrepancyDecision = {
  id: string
  discrepancyFlagId: string
  comparisonRunId: string | null
  actorUserId: string | null
  // Joined from `users`, which carries no display name. Null when the account
  // was deleted — the decision stays in the trail regardless.
  actorEmail: string | null
  // Captured at decision time, not joined: memberships change, the record
  // should not.
  actorRole: string
  outcome: DiscrepancyDecisionOutcome
  note: string
  createdAt: string
}

/** One comparison attempt. Append-only evidence — see S1. */
export type ComparisonRun = {
  id: string
  purchaseOrderId: string
  invoiceId: string
  mode: 'two_way' | 'three_way'
  strategyVersion: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  initiatedBy: string | null
  initiatedByEmail: string | null
  poLineCount: number | null
  invoiceLineCount: number | null
  goodsReceiptLineCount: number | null
  flagCount: number | null
  startedAt: string
  finishedAt: string | null
  // Already client-safe: a reference id, never the engine's own text.
  lastError: string | null
  createdAt: string
}

export type ComparisonRunListResult = {
  items: ComparisonRun[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** Run history. Readable by any member; the pair filter is the common case. */
export function listComparisonRuns(
  workspaceId: string,
  opts?: { purchaseOrderId?: string; invoiceId?: string; page?: number; pageSize?: number },
): Promise<ComparisonRunListResult> {
  const params = new URLSearchParams()
  if (opts?.purchaseOrderId) params.set('purchaseOrderId', opts.purchaseOrderId)
  if (opts?.invoiceId) params.set('invoiceId', opts.invoiceId)
  if (opts?.page) params.set('page', String(opts.page))
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const query = params.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/procurement/comparison-runs${query ? `?${query}` : ''}`)
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
