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
  opts?: { vendorId?: string; status?: CatalogMatchStatus },
): Promise<CatalogMatch[]> {
  const params = new URLSearchParams()
  if (opts?.vendorId) params.set('vendorId', opts.vendorId)
  if (opts?.status) params.set('status', opts.status)
  const query = params.toString()

  return apiFetch(`/api/workspaces/${workspaceId}/catalog-matches${query ? `?${query}` : ''}`)
}

export function dismissCatalogMatch(workspaceId: string, matchId: string): Promise<CatalogMatch> {
  return apiFetch(`/api/workspaces/${workspaceId}/catalog-matches/${matchId}/dismiss`, {
    method: 'PATCH',
  })
}
