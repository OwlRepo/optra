'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  EmptyState,
  Eyebrow,
  Input,
  Modal,
  PageSection,
  PhotoGrid,
  SkeletonRows,
  StatStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui'
import { Upload } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { useWorkspaceContext } from '@/components/workspace-context'
import type { VendorExceptionSummary, VendorPriceHistoryRow } from '@/lib/api/catalog'
import {
  catalogItemPhotoUrl,
  getVendor,
  getVendorExceptionSummary,
  listCatalogItems,
  listCatalogs,
  listVendorPriceHistory,
  scrapeCatalog,
  uploadCatalog,
  type Catalog,
  type CatalogItem,
  type CatalogSourceKind,
  type CatalogStatus,
  type VendorDetail,
} from '@/lib/api/catalog'
import { formatDate } from '@/lib/format-date'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { TourReplayButton } from '@/components/tour/tour-replay-button'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }

// Storyboard C03 document status: waiting states read neutral (Processing
// adds the pulse dot), Ready teal, Failed red.
const statusTone: Record<CatalogStatus, 'neutral' | 'teal' | 'red'> = {
  pending: 'neutral',
  processing: 'neutral',
  done: 'teal',
  failed: 'red',
}

const statusLabel: Record<CatalogStatus, string> = {
  pending: 'Queued',
  processing: 'Processing',
  done: 'Ready',
  failed: 'Failed',
}

const sourceKindLabel: Record<CatalogSourceKind, string> = {
  pdf: 'Upload',
  csv: 'Upload',
  scrape: 'Scrape',
}

const roleLabel: Record<WorkspaceMembership['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

const seedUrlPattern = /^https?:\/\/.+/i

export default function VendorDetailPage({ params }: { params: { id: string; vendorId: string } }) {
  const workspaceId = params.id
  const vendorId = params.vendorId
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const { workspace, membership, status: workspaceStatus } = useWorkspaceContext()
  const [vendor, setVendor] = React.useState<VendorDetail | null>(null)
  const [catalogs, setCatalogs] = React.useState<Catalog[]>([])
  const [history, setHistory] = React.useState<VendorPriceHistoryRow[]>([])
  const [summary, setSummary] = React.useState<VendorExceptionSummary | null>(null)

  // Derived here rather than asked of the API: an average across quarters
  // would silently mix units and currencies, which POLICY v1 #4 and #6 forbid
  // comparing. Counting rows is safe; averaging them is not.
  const priceStats = React.useMemo(() => {
    const skus = new Set(history.map((row) => row.sku).filter(Boolean))
    const offContract = history.filter(
      (row) =>
        row.unitPrice !== null &&
        row.contractUnitPrice !== null &&
        Number(row.unitPrice) !== Number(row.contractUnitPrice),
    ).length
    return { skuCount: skus.size, offContract }
  }, [history])
  const [isLoading, setIsLoading] = React.useState(true)
  // B18. Set when the first load answers 403; the page then shows only the
  // no-access state instead of empty content.
  const [pageAccessDenied, setAccessDenied] = React.useState(false)
  const accessDenied = pageAccessDenied || workspaceStatus === 'denied'
  const [isUploading, setIsUploading] = React.useState(false)

  const [isScrapeModalOpen, setIsScrapeModalOpen] = React.useState(false)
  const [isSubmittingScrape, setIsSubmittingScrape] = React.useState(false)
  const [scrapeSeedUrl, setScrapeSeedUrl] = React.useState('')
  const [scrapeMaxDepth, setScrapeMaxDepth] = React.useState('')
  const [scrapeMaxPages, setScrapeMaxPages] = React.useState('')

  const [viewingCatalog, setViewingCatalog] = React.useState<Catalog | null>(null)
  const [catalogItems, setCatalogItems] = React.useState<CatalogItem[]>([])
  const [isLoadingItems, setIsLoadingItems] = React.useState(false)

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'
  const isValidSeedUrl = seedUrlPattern.test(scrapeSeedUrl.trim())
  const showSeedUrlError = scrapeSeedUrl.trim() !== '' && !isValidSeedUrl

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback

  const loadPage = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [vendorData, catalogData, historyData, summaryData] = await Promise.all([
        // S9. Fetched by id. This used to load every vendor in the workspace
        // and find this one in the array.
        getVendor(workspaceId, vendorId),
        listCatalogs(workspaceId, vendorId),
        listVendorPriceHistory(workspaceId, vendorId, { pageSize: 50 }),
        getVendorExceptionSummary(workspaceId, vendorId),
      ])
      setVendor(vendorData ?? null)
      setHistory(historyData?.items ?? [])
      setSummary(summaryData ?? null)
      setCatalogs(Array.isArray(catalogData) ? catalogData : [])
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      if (isForbidden(err)) {
        setAccessDenied(true)
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Failed to load vendor',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsLoading(false)
    }
  }, [router, vendorId, workspaceId])

  React.useEffect(() => {
    void loadPage()
  }, [loadPage])

  // Catalog ingestion (upload parsing or a website crawl) runs async on the
  // backend, so poll while any catalog is still pending/processing to pick
  // up status/rowCount changes without a manual reload — same 3s interval
  // and in-flight check as datasets/page.tsx.
  const refreshCatalogs = React.useCallback(async () => {
    try {
      const data = await listCatalogs(workspaceId, vendorId)
      setCatalogs(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
      }
    }
  }, [router, vendorId, workspaceId])

  React.useEffect(() => {
    const hasInFlight = catalogs.some((catalog) => catalog.status === 'pending' || catalog.status === 'processing')
    if (!hasInFlight) return

    const interval = window.setInterval(() => void refreshCatalogs(), 3000)
    return () => window.clearInterval(interval)
  }, [catalogs, refreshCatalogs])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setIsUploading(true)
    try {
      await uploadCatalog(workspaceId, vendorId, file)
      toastRef.current({
        variant: 'success',
        title: 'Catalog uploaded',
        description: `${file.name} is being processed.`,
      })
      await loadPage()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Upload failed',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsUploading(false)
    }
  }

  const closeScrapeModal = React.useCallback(() => {
    if (isSubmittingScrape) return
    setIsScrapeModalOpen(false)
    setScrapeSeedUrl('')
    setScrapeMaxDepth('')
    setScrapeMaxPages('')
  }, [isSubmittingScrape])

  const submitScrape = React.useCallback(async () => {
    if (!isValidSeedUrl) return

    setIsSubmittingScrape(true)
    try {
      const payload: { seedUrl: string; maxDepth?: number; maxPages?: number } = {
        seedUrl: scrapeSeedUrl.trim(),
      }
      if (scrapeMaxDepth.trim() !== '') payload.maxDepth = Number(scrapeMaxDepth)
      if (scrapeMaxPages.trim() !== '') payload.maxPages = Number(scrapeMaxPages)

      await scrapeCatalog(workspaceId, vendorId, payload)
      setIsScrapeModalOpen(false)
      setScrapeSeedUrl('')
      setScrapeMaxDepth('')
      setScrapeMaxPages('')
      toastRef.current({
        variant: 'success',
        title: 'Scrape started',
        description: 'The catalog will populate once the crawl finishes.',
      })
      await loadPage()
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Failed to start scrape',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsSubmittingScrape(false)
    }
  }, [isValidSeedUrl, loadPage, router, scrapeMaxDepth, scrapeMaxPages, scrapeSeedUrl, vendorId, workspaceId])

  const handleViewItems = React.useCallback(
    async (catalog: Catalog) => {
      setViewingCatalog(catalog)
      setIsLoadingItems(true)
      setCatalogItems([])
      try {
        const items = await listCatalogItems(workspaceId, vendorId, catalog.id)
        setCatalogItems(Array.isArray(items) ? items : [])
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push('/login')
          return
        }
        toastRef.current({
          variant: 'error',
          title: 'Failed to load catalog items',
          description: extractErrorMessage(err, 'Try again in a moment.'),
        })
      } finally {
        setIsLoadingItems(false)
      }
    },
    [router, vendorId, workspaceId],
  )

  const closeViewItems = React.useCallback(() => {
    setViewingCatalog(null)
    setCatalogItems([])
  }, [])

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      userFooter={({ collapsed }) => <TourReplayButton collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      breadcrumb={
        <>
          {`${workspace?.name ?? 'Workspace'} / `}
          <Link href={`/workspaces/${workspaceId}/vendors`} className="text-primary-strong hover:text-primary-strong-hover">
            Vendors
          </Link>
        </>
      }
      title={vendor?.name ?? 'Vendor'}
      description={vendor?.contactInfo ?? 'Vendor catalogs'}
      badge={membership ? <Badge variant={membership.role === 'member' ? 'neutral' : 'teal'}>{roleLabel[membership.role]}</Badge> : null}
      actions={
        canManage ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setIsScrapeModalOpen(true)}>
              Scrape website
            </Button>
            <Button size="sm" onClick={handleUploadClick} isLoading={isUploading} loadingText="Uploading">
              {!isUploading ? <Upload className="size-4" /> : null}
              {!isUploading ? 'Upload catalog' : null}
            </Button>
          </>
        ) : null
      }
      onLogout={handleLogout}
    >
      <div className="flex flex-col gap-10">
        {accessDenied ? (
          <WorkspaceAccessDenied />
        ) : (
          <>
            {/* One hidden picker for every "Upload catalog" button, kept out of
                `actions` so it exists once however the shell places actions. */}
            {canManage ? (
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.csv,.xlsx"
                className="hidden"
                onChange={(event) => void handleFileSelected(event)}
              />
            ) : null}

            {/* S9. What this vendor has charged, and what has gone wrong with
                them. Rendered as numbers and a table rather than a chart:
                packages/ui has no chart component, and a handful of observations
                per item is a table's job, not a graph's. */}
            {!isLoading ? (
              <PageSection eyebrow={<Eyebrow>Price history</Eyebrow>} title="What this vendor has charged">
                <div className="flex flex-col gap-5">
                  <StatStrip
                    items={[
                      { label: 'Orders', value: summary?.purchaseOrderCount ?? 0 },
                      { label: 'Items bought', value: priceStats.skuCount },
                      { label: 'Priced off contract', value: priceStats.offContract, tone: 'amber' },
                      { label: 'Open exceptions', value: summary?.openTotal ?? 0, tone: 'amber' },
                    ]}
                  />

                  {history.length === 0 ? (
                    <EmptyState
                      label="Price history"
                      title="Nothing bought from this vendor yet"
                      description="Upload a purchase order against them and its prices will show up here."
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[120px] pl-6">Item</TableHead>
                          <TableHead>Order</TableHead>
                          <TableHead className="w-[170px]">Date</TableHead>
                          <TableHead className="w-[100px] text-right">Unit price</TableHead>
                          <TableHead className="w-[90px] text-right">Agreed</TableHead>
                          <TableHead className="w-[150px] pr-6">Against contract</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.map((row) => {
                          const ordered = row.unitPrice === null ? null : Number(row.unitPrice)
                          const agreed = row.contractUnitPrice === null ? null : Number(row.contractUnitPrice)
                          const gap = ordered !== null && agreed !== null ? ordered - agreed : null
                          return (
                            <TableRow key={row.poLineItemId}>
                              <TableCell className="pl-6 font-mono text-[13px] font-medium">{row.sku ?? '—'}</TableCell>
                              <TableCell className="font-mono text-[13px] text-ink-body">{row.poNumber ?? row.poName}</TableCell>
                              <TableCell className="font-mono text-[13px] text-ink-body">
                                {/* The order date when we have it; otherwise the day the
                                    file arrived, said out loud rather than passed off. */}
                                {row.orderedAt
                                  ? formatDate(row.orderedAt)
                                  : `${formatDate(row.recordedAt)} (uploaded)`}
                              </TableCell>
                              <TableCell numeric>{row.unitPrice ?? '—'}</TableCell>
                              <TableCell numeric className="text-ink-body">{row.contractUnitPrice ?? '—'}</TableCell>
                              <TableCell className="pr-6">
                                {gap === null ? (
                                  <span className="text-[13px] text-ink-muted">No agreed price</span>
                                ) : gap === 0 ? (
                                  <Badge variant="teal">On contract</Badge>
                                ) : (
                                  <Badge variant="amber" className="font-mono font-medium">
                                    {gap > 0 ? '+' : ''}
                                    {gap.toFixed(2)}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </PageSection>
            ) : null}

            <PageSection eyebrow={<Eyebrow>Catalogs</Eyebrow>} title="What they say they sell">
              {isLoading ? (
                <div aria-busy="true" className="rounded-[18px] border border-border-panel bg-card px-6 py-4">
                  <SkeletonRows rows={3} columns={6} />
                </div>
              ) : catalogs.length === 0 ? (
                <EmptyState
                  label="pdf / csv / xlsx · or a website"
                  title="No catalogs yet"
                  description="Upload a catalog file or scrape the vendor's website to build one."
                  actions={
                    canManage ? (
                      <>
                        <Button size="sm" onClick={handleUploadClick}>
                          Upload catalog
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setIsScrapeModalOpen(true)}>
                          Scrape website
                        </Button>
                      </>
                    ) : undefined
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Name</TableHead>
                      <TableHead className="w-[100px]">Source</TableHead>
                      <TableHead className="w-[128px]">Status</TableHead>
                      <TableHead className="w-[70px] text-right">Rows</TableHead>
                      <TableHead className="w-[120px]">Created</TableHead>
                      <TableHead className="w-[130px] pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {catalogs.map((catalog) => (
                      <TableRow key={catalog.id}>
                        <TableCell className="min-w-0 pl-6">
                          <div className="font-medium">{catalog.name}</div>
                          {catalog.status === 'failed' && catalog.lastError ? (
                            <p className="mt-1 text-[12px] text-destructive-strong-text">{catalog.lastError}</p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="chip">{sourceKindLabel[catalog.sourceKind]}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusTone[catalog.status]} pulse={catalog.status === 'processing'}>
                            {statusLabel[catalog.status]}
                          </Badge>
                        </TableCell>
                        <TableCell numeric>{catalog.rowCount ?? '—'}</TableCell>
                        <TableCell className="font-mono text-[13px] text-ink-body">
                          {catalog.createdAt ? formatDate(catalog.createdAt) : 'Recently created'}
                        </TableCell>
                        <TableCell className="py-2 pr-[18px] text-right">
                          <Button variant="outline" size="xs" onClick={() => void handleViewItems(catalog)}>
                            View items
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PageSection>
          </>
        )}
      </div>

      <Modal
        open={isScrapeModalOpen}
        onClose={closeScrapeModal}
        title="Scrape website"
        eyebrow="Catalog source"
        footer={
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={closeScrapeModal}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submitScrape()}
              isLoading={isSubmittingScrape}
              loadingText="Starting"
              disabled={!isValidSeedUrl || isSubmittingScrape}
            >
              Start scrape
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-[14px] font-medium">Website URL</span>
            <Input
              aria-label="Website URL"
              type="url"
              className="font-mono text-[13px]"
              aria-invalid={showSeedUrlError ? true : undefined}
              value={scrapeSeedUrl}
              onChange={(event) => setScrapeSeedUrl(event.target.value)}
              placeholder="https://example.com/catalog"
            />
            {showSeedUrlError ? (
              <span className="text-[13px] text-destructive-strong-text">Enter a valid URL starting with http:// or https://</span>
            ) : null}
          </label>
          <div className="grid grid-cols-2 gap-3.5">
            <label className="flex flex-col gap-2">
              <span className="text-[14px] font-medium">
                Max depth <span className="font-normal text-ink-muted">0–5</span>
              </span>
              <Input
                aria-label="Max depth"
                type="number"
                min={0}
                max={5}
                placeholder="3"
                className="font-mono text-[14px]"
                value={scrapeMaxDepth}
                onChange={(event) => setScrapeMaxDepth(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[14px] font-medium">
                Max pages <span className="font-normal text-ink-muted">1–2000</span>
              </span>
              <Input
                aria-label="Max pages"
                type="number"
                min={1}
                max={2000}
                placeholder="500"
                className="font-mono text-[14px]"
                value={scrapeMaxPages}
                onChange={(event) => setScrapeMaxPages(event.target.value)}
              />
            </label>
          </div>
          <span className="text-[13px] text-ink-muted">Both optional. The catalog fills in once the crawl finishes.</span>
        </div>
      </Modal>

      <Modal
        open={viewingCatalog !== null}
        onClose={closeViewItems}
        title={viewingCatalog ? `${viewingCatalog.name} items` : 'Catalog items'}
        eyebrow="Catalog"
        headerAccessory={
          !isLoadingItems && catalogItems.length > 0 ? (
            <span className="font-mono text-[12px] text-ink-muted">{`${catalogItems.length} items`}</span>
          ) : undefined
        }
        size="xl"
      >
        <PhotoGrid
          maxCols={4}
          isLoading={isLoadingItems}
          items={catalogItems.map((item) => ({
            id: item.id,
            // Items without a stored photo keep the placeholder tile.
            src: item.photoStorageKey ? catalogItemPhotoUrl(workspaceId, item.id) : null,
            alt: item.sku ?? item.description ?? 'Item',
            // 3.6 / C-3 #11: two lines under the photo, Mono SKU then the
            // description truncated to one line.
            caption:
              item.sku || item.description ? (
                <>
                  {item.sku ? (
                    <span className="block font-mono text-[11px] text-[oklch(0.36_0.02_264)]">{item.sku}</span>
                  ) : null}
                  {item.description ? (
                    <span className="mt-0.5 block truncate text-[12px] text-[oklch(0.48_0.02_264)]">{item.description}</span>
                  ) : null}
                </>
              ) : undefined,
          }))}
        />
      </Modal>
    </AppShell>
  )
}
