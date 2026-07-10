'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PhotoGrid,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui'
import { PackageSearch, Upload } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import {
  listCatalogItems,
  listCatalogs,
  listVendors,
  scrapeCatalog,
  uploadCatalog,
  type Catalog,
  type CatalogItem,
  type CatalogSourceKind,
  type CatalogStatus,
  type VendorDetail,
} from '@/lib/api/catalog'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }

// Mirrors the status color convention actually used in datasets/page.tsx
// (pending/processing both read as "secondary" there — there is no
// separate "in progress" color in this design system yet).
const statusVariant: Record<CatalogStatus, 'secondary' | 'success' | 'destructive'> = {
  pending: 'secondary',
  processing: 'secondary',
  done: 'success',
  failed: 'destructive',
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

const seedUrlPattern = /^https?:\/\/.+/i

export default function VendorDetailPage({ params }: { params: { id: string; vendorId: string } }) {
  const workspaceId = params.id
  const vendorId = params.vendorId
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [vendor, setVendor] = React.useState<VendorDetail | null>(null)
  const [catalogs, setCatalogs] = React.useState<Catalog[]>([])
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
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

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback

  const loadPage = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [workspaceData, vendors, catalogData, memberships] = await Promise.all([
        getWorkspace(workspaceId),
        listVendors(workspaceId),
        listCatalogs(workspaceId, vendorId),
        listWorkspaces(),
      ])
      setWorkspace(workspaceData)
      const vendorList = Array.isArray(vendors) ? vendors : []
      setVendor(vendorList.find((entry: VendorDetail) => entry.id === vendorId) ?? null)
      setCatalogs(Array.isArray(catalogData) ? catalogData : [])
      const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
      setMembership(membershipItems.find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
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
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      title={vendor?.name ?? 'Vendor'}
      description={vendor?.contactInfo ?? 'Vendor catalogs'}
      badge={membership ? <Badge variant={membership.role === 'member' ? 'secondary' : 'success'}>{membership.role}</Badge> : null}
      actions={
        canManage ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.csv,.xlsx"
              className="hidden"
              onChange={(event) => void handleFileSelected(event)}
            />
            <Button size="sm" onClick={handleUploadClick} isLoading={isUploading} loadingText="Uploading">
              {!isUploading ? <Upload className="size-4" /> : null}
              {!isUploading ? 'Upload catalog' : null}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsScrapeModalOpen(true)}>
              Scrape website
            </Button>
          </>
        ) : null
      }
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
        {isLoading ? (
          <Card variant="elevated" className="space-y-4 p-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
        ) : catalogs.length === 0 ? (
          <EmptyState
            icon={<PackageSearch className="size-5" />}
            title="No catalogs yet"
            description="Upload a catalog file or scrape the vendor's website to build one."
            actions={
              canManage ? (
                <>
                  <Button onClick={handleUploadClick}>
                    <Upload className="size-4" />
                    Upload catalog
                  </Button>
                  <Button variant="outline" onClick={() => setIsScrapeModalOpen(true)}>
                    Scrape website
                  </Button>
                </>
              ) : undefined
            }
          />
        ) : (
          <Card variant="elevated">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogs.map((catalog) => (
                  <TableRow key={catalog.id}>
                    <TableCell className="font-medium">
                      <div>{catalog.name}</div>
                      {catalog.status === 'failed' && catalog.lastError ? (
                        <p className="mt-1 text-xs text-destructive">{catalog.lastError}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{sourceKindLabel[catalog.sourceKind]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[catalog.status]}>{statusLabel[catalog.status]}</Badge>
                    </TableCell>
                    <TableCell>{catalog.rowCount ?? '—'}</TableCell>
                    <TableCell>{catalog.createdAt ? new Date(catalog.createdAt).toLocaleDateString() : 'Recently created'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => void handleViewItems(catalog)}>
                        View items
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <Modal open={isScrapeModalOpen} onClose={closeScrapeModal} title="Scrape website">
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Website URL</span>
            <Input
              aria-label="Website URL"
              type="url"
              value={scrapeSeedUrl}
              onChange={(event) => setScrapeSeedUrl(event.target.value)}
              placeholder="https://example.com/catalog"
            />
            {scrapeSeedUrl.trim() && !isValidSeedUrl ? (
              <p className="text-sm text-destructive">Enter a valid URL starting with http:// or https://</p>
            ) : null}
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Max depth (optional, 0-5)</span>
            <Input
              aria-label="Max depth"
              type="number"
              min={0}
              max={5}
              value={scrapeMaxDepth}
              onChange={(event) => setScrapeMaxDepth(event.target.value)}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Max pages (optional, 1-2000)</span>
            <Input
              aria-label="Max pages"
              type="number"
              min={1}
              max={2000}
              value={scrapeMaxPages}
              onChange={(event) => setScrapeMaxPages(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-3">
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
        </div>
      </Modal>

      <Modal
        open={viewingCatalog !== null}
        onClose={closeViewItems}
        title={viewingCatalog ? `${viewingCatalog.name} items` : 'Catalog items'}
        size="xl"
      >
        <PhotoGrid
          maxCols={4}
          isLoading={isLoadingItems}
          items={catalogItems.map((item) => ({
            id: item.id,
            src: null,
            alt: item.sku ?? item.description ?? 'Item',
            caption: item.description ?? undefined,
          }))}
        />
      </Modal>
    </AppShell>
  )
}
