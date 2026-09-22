import { apiFetch, uploadFile } from './client'

export type Vendor = { id: string; name: string }
export type VendorDetail = Vendor & { contactInfo: string | null; createdAt: string }

export type CatalogSourceKind = 'pdf' | 'csv' | 'scrape'
export type CatalogStatus = 'pending' | 'processing' | 'done' | 'failed'
export type CatalogSummary = { id: string; name: string; status: 'pending' }
export type ScrapeCatalogSummary = { id: string; status: string }
export type Catalog = {
  id: string
  name: string
  sourceKind: CatalogSourceKind
  status: CatalogStatus
  rowCount: number | null
  lastError: string | null
  createdAt: string
}
export type CatalogItem = {
  id: string
  sku: string | null
  description: string | null
  photoStorageKey: string | null
  sourcePageNumber: number | null
}

export type CatalogMatchType = 'sourcing' | 'compliance'
export type CatalogMatchStatus = 'open' | 'dismissed'
export type CatalogMatch = {
  id: string
  matchType: CatalogMatchType
  queryPoLineItemId: string | null
  queryInvoiceLineItemId: string | null
  catalogItemId: string
  vendorId: string
  score: string | null
  isMatch: boolean
  reason: string
  status: CatalogMatchStatus
  createdAt: string
  // Resolved server-side so the match can be rendered as products rather than
  // as raw ids. Null when the referenced row no longer exists.
  catalogItem: {
    id: string
    sku: string | null
    description: string | null
    photoStorageKey: string | null
  } | null
  queryItem: { id: string; sku: string | null; description: string | null } | null
}

/** URL of a catalog item photo, served through the web app's auth proxy. */
export function catalogItemPhotoUrl(workspaceId: string, itemId: string): string {
  return `/api/workspaces/${workspaceId}/catalog-items/${itemId}/photo`
}
export type CatalogMatchQuery =
  | { purchaseOrderLineItemId: string; invoiceLineItemId?: never }
  | { invoiceLineItemId: string; purchaseOrderLineItemId?: never }

export function createVendor(workspaceId: string, payload: { name: string; contactInfo?: string }): Promise<Vendor> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listVendors(workspaceId: string): Promise<VendorDetail[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors`)
}

// S9. One vendor, by id — the page used to scan the whole list to find it.
export function getVendor(workspaceId: string, vendorId: string): Promise<VendorDetail> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors/${vendorId}`)
}

export type VendorPriceHistoryRow = {
  poLineItemId: string
  purchaseOrderId: string
  poNumber: string | null
  poName: string
  currency: string | null
  // When the order was placed, if the uploader said so; `recordedAt` is when
  // the file reached Optra. The table shows the first and labels the second.
  orderedAt: string | null
  recordedAt: string
  sku: string | null
  uom: string | null
  quantity: string | null
  unitPrice: string | null
  // The price agreed for THIS order's date. Null means no single agreed price
  // applied — no contract, or more than one covering that day.
  contractUnitPrice: string | null
}

export type VendorPriceHistoryPage = {
  items: VendorPriceHistoryRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  // Every item ever bought from this vendor, not just the filtered ones.
  skus: string[]
}

export type VendorExceptionSummary = {
  counts: Record<string, number>
  openTotal: number
  purchaseOrderCount: number
}

export function listVendorPriceHistory(
  workspaceId: string,
  vendorId: string,
  params: { sku?: string; page?: number; pageSize?: number } = {},
): Promise<VendorPriceHistoryPage> {
  const query = new URLSearchParams()
  if (params.sku) query.set('sku', params.sku)
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return apiFetch(`/api/workspaces/${workspaceId}/vendors/${vendorId}/price-history${suffix}`)
}

export function getVendorExceptionSummary(
  workspaceId: string,
  vendorId: string,
): Promise<VendorExceptionSummary> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors/${vendorId}/exception-summary`)
}

export type VendorPriceTerm = {
  id: string
  sku: string
  uom: string | null
  unitPrice: string
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  sourceReference: string | null
  supersedesId: string | null
}

export function listVendorPriceTerms(workspaceId: string, vendorId: string): Promise<VendorPriceTerm[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors/${vendorId}/price-terms`)
}

export function uploadCatalog(workspaceId: string, vendorId: string, file: File): Promise<CatalogSummary> {
  return uploadFile(`/api/workspaces/${workspaceId}/vendors/${vendorId}/catalogs`, file)
}

export function scrapeCatalog(
  workspaceId: string,
  vendorId: string,
  payload: { seedUrl: string; maxDepth?: number; maxPages?: number },
): Promise<ScrapeCatalogSummary> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors/${vendorId}/catalogs/scrape`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listCatalogs(workspaceId: string, vendorId: string): Promise<Catalog[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors/${vendorId}/catalogs`)
}

export function listCatalogItems(
  workspaceId: string,
  vendorId: string,
  catalogId: string,
): Promise<CatalogItem[]> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors/${vendorId}/catalogs/${catalogId}/items`)
}

export function searchCatalogMatches(
  workspaceId: string,
  payload: CatalogMatchQuery,
): Promise<{ matches: CatalogMatch[] }> {
  return apiFetch(`/api/workspaces/${workspaceId}/catalog-matches/search`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function verifyCatalogMatches(
  workspaceId: string,
  vendorId: string,
  payload: CatalogMatchQuery,
): Promise<{ matches: CatalogMatch[] }> {
  return apiFetch(`/api/workspaces/${workspaceId}/vendors/${vendorId}/catalog-matches/verify`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listCatalogMatches(
  workspaceId: string,
  opts?: {
    vendorId?: string
    status?: CatalogMatchStatus
    poLineItemId?: string
    invoiceLineItemId?: string
  },
): Promise<CatalogMatch[]> {
  const params = new URLSearchParams()
  if (opts?.vendorId) params.set('vendorId', opts.vendorId)
  if (opts?.status) params.set('status', opts.status)
  if (opts?.poLineItemId) params.set('poLineItemId', opts.poLineItemId)
  if (opts?.invoiceLineItemId) params.set('invoiceLineItemId', opts.invoiceLineItemId)
  const query = params.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/catalog-matches${query ? `?${query}` : ''}`)
}

export function dismissCatalogMatch(workspaceId: string, matchId: string): Promise<CatalogMatch> {
  return apiFetch(`/api/workspaces/${workspaceId}/catalog-matches/${matchId}/dismiss`, {
    method: 'PATCH',
  })
}
