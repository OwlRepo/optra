'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  PhotoCompare,
  Select,
  Skeleton,
  useToast,
} from '@repo/ui'
import { PackageSearch } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import {
  dismissCatalogMatch,
  listCatalogMatches,
  listVendors,
  searchCatalogMatches,
  verifyCatalogMatches,
  type CatalogMatch,
  type CatalogMatchQuery,
  type CatalogMatchStatus,
  type VendorDetail,
} from '@/lib/api/catalog'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }

export default function CatalogMatchesPage({ params }: { params: { id: string } }) {
  const workspaceId = params.id
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  // Query params only ever arrive from the Discrepancies page's "Find catalog
  // matches" row action. There is no line-item picker here on purpose — no
  // backend endpoint exists yet to browse arbitrary PO/invoice line items.
  const poLineItemId = searchParams.get('poLineItemId')
  const invoiceLineItemId = searchParams.get('invoiceLineItemId')
  const vendorIdParam = searchParams.get('vendorId')

  const matchQuery: CatalogMatchQuery | null = poLineItemId
    ? { purchaseOrderLineItemId: poLineItemId }
    : invoiceLineItemId
      ? { invoiceLineItemId }
      : null

  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [vendors, setVendors] = React.useState<VendorDetail[]>([])
  const [matches, setMatches] = React.useState<CatalogMatch[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [vendorFilter, setVendorFilter] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<CatalogMatchStatus | ''>('')
  const [isSearching, setIsSearching] = React.useState(false)
  const [isVerifying, setIsVerifying] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [dismissingId, setDismissingId] = React.useState<string | null>(null)

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback

  const refetchMatches = React.useCallback(
    async (nextVendorId: string, nextStatus: CatalogMatchStatus | '') => {
      try {
        setIsLoading(true)
        const data = await listCatalogMatches(workspaceId, {
          vendorId: nextVendorId || undefined,
          status: nextStatus || undefined,
        })
        setMatches(Array.isArray(data) ? data : [])
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push('/login')
          return
        }
        toastRef.current({
          variant: 'error',
          title: 'Failed to filter catalog matches',
          description: extractErrorMessage(err, 'Try again in a moment.'),
        })
      } finally {
        setIsLoading(false)
      }
    },
    [router, workspaceId],
  )

  const loadPage = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [workspaceData, memberships, vendorList, matchList] = await Promise.all([
        getWorkspace(workspaceId),
        listWorkspaces(),
        listVendors(workspaceId),
        listCatalogMatches(workspaceId, {}),
      ])
      setWorkspace(workspaceData)
      const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
      setMembership(membershipItems.find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null)
      setVendors(Array.isArray(vendorList) ? vendorList : [])
      setMatches(Array.isArray(matchList) ? matchList : [])
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Failed to load catalog matches',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsLoading(false)
    }
  }, [router, workspaceId])

  React.useEffect(() => {
    void loadPage()
  }, [loadPage])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  const handleVendorFilterChange = (value: string) => {
    setVendorFilter(value)
    void refetchMatches(value, statusFilter)
  }

  const handleStatusFilterChange = (value: CatalogMatchStatus | '') => {
    setStatusFilter(value)
    void refetchMatches(vendorFilter, value)
  }

  const handleSearch = React.useCallback(async () => {
    if (!matchQuery) return
    try {
      setIsSearching(true)
      const result = await searchCatalogMatches(workspaceId, matchQuery)
      const count = result.matches.length
      toast({
        variant: 'success',
        title: 'Search complete',
        description: `${count} match${count === 1 ? '' : 'es'} found.`,
      })
      setHasSearched(true)
      await refetchMatches(vendorFilter, statusFilter)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Search failed',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsSearching(false)
    }
  }, [matchQuery, refetchMatches, router, statusFilter, toast, vendorFilter, workspaceId])

  const handleVerify = React.useCallback(async () => {
    if (!matchQuery || !vendorIdParam) return
    try {
      setIsVerifying(true)
      const result = await verifyCatalogMatches(workspaceId, vendorIdParam, matchQuery)
      const count = result.matches.length
      toast({
        variant: 'success',
        title: 'Verification complete',
        description: `${count} match${count === 1 ? '' : 'es'} found.`,
      })
      setHasSearched(true)
      await refetchMatches(vendorFilter, statusFilter)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toast({
        variant: 'error',
        title: 'Verification failed',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsVerifying(false)
    }
  }, [matchQuery, refetchMatches, router, statusFilter, toast, vendorFilter, vendorIdParam, workspaceId])

  const handleDismiss = React.useCallback(
    async (matchId: string) => {
      try {
        setDismissingId(matchId)
        await dismissCatalogMatch(workspaceId, matchId)
        toast({
          variant: 'success',
          title: 'Match dismissed',
          description: 'The catalog match was dismissed.',
        })
        await refetchMatches(vendorFilter, statusFilter)
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push('/login')
          return
        }
        toast({
          variant: 'error',
          title: 'Failed to dismiss match',
          description: extractErrorMessage(err, 'Try again in a moment.'),
        })
      } finally {
        setDismissingId(null)
      }
    },
    [refetchMatches, statusFilter, router, toast, vendorFilter, workspaceId],
  )

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      title="Catalog matches"
      description="Compare purchase order and invoice line items against vendor catalog items."
      badge={membership ? <Badge variant={membership.role === 'member' ? 'secondary' : 'success'}>{membership.role}</Badge> : null}
      actions={
        canManage && matchQuery ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void handleSearch()} isLoading={isSearching} loadingText="Searching">
              {!isSearching ? 'Search all vendors' : null}
            </Button>
            {vendorIdParam ? (
              <Button size="sm" variant="outline" onClick={() => void handleVerify()} isLoading={isVerifying} loadingText="Verifying">
                {!isVerifying ? 'Verify against this vendor' : null}
              </Button>
            ) : null}
          </div>
        ) : null
      }
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
        <Card variant="elevated" className="space-y-4 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              aria-label="Filter by vendor"
              className="sm:w-56"
              value={vendorFilter}
              onChange={(event) => handleVendorFilterChange(event.target.value)}
            >
              <option value="">All vendors</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by status"
              className="sm:w-48"
              value={statusFilter}
              onChange={(event) => handleStatusFilterChange(event.target.value as CatalogMatchStatus | '')}
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="dismissed">Dismissed</option>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : matches.length === 0 ? (
            <EmptyState
              icon={<PackageSearch className="size-5" />}
              title={hasSearched ? 'No matches found' : 'No catalog matches yet'}
              description={
                hasSearched
                  ? 'Try a different vendor or line item.'
                  : 'Search for matches from the Discrepancies page, or adjust the filters above.'
              }
            />
          ) : (
            <div className="space-y-4">
              {matches.map((match) => (
                <Card key={match.id} variant="subtle" className="space-y-4 p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{match.matchType === 'sourcing' ? 'Sourcing' : 'Compliance'}</Badge>
                      <Badge variant={match.status === 'open' ? 'secondary' : 'outline'}>
                        {match.status === 'open' ? 'Open' : 'Dismissed'}
                      </Badge>
                    </div>
                    {canManage && match.status === 'open' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Dismiss match ${match.id}`}
                        onClick={() => void handleDismiss(match.id)}
                        isLoading={dismissingId === match.id}
                        loadingText="Dismissing"
                      >
                        {dismissingId === match.id ? null : 'Dismiss'}
                      </Button>
                    ) : null}
                  </div>
                  <PhotoCompare
                    query={{
                      sku: null,
                      // No endpoint resolves queryPoLineItemId/queryInvoiceLineItemId to a
                      // sku/description yet - show the truncated id as an honest placeholder.
                      description: `Query item ${(match.queryPoLineItemId ?? match.queryInvoiceLineItemId ?? '').slice(0, 8)}...`,
                    }}
                    candidate={{
                      sku: null,
                      // Same limitation as the Catalogs page: no endpoint resolves
                      // catalogItemId to a sku/description/photo yet.
                      description: `Catalog item ${match.catalogItemId.slice(0, 8)}...`,
                      photoSrc: null,
                      vendorName: undefined,
                    }}
                    verdict={{
                      score: match.score !== null ? Number(match.score) : null,
                      isMatch: match.isMatch,
                      reason: match.reason,
                    }}
                  />
                </Card>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
