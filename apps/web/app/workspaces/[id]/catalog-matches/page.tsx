'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  EmptyState,
  PhotoCompare,
  SegmentedControl,
  Select,
  SkeletonRows,
  cn,
  useToast,
} from '@repo/ui'
import { logout } from '@/lib/api/auth'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import {
  dismissCatalogMatch,
  catalogItemPhotoUrl,
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
import { TOUR_ANCHORS, tourAttr } from '@/components/tour/tour-anchors'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'
import { ScopeChip } from '@/components/procurement/scope-chip'

type Workspace = { id: string; name: string }
type WorkspaceRole = 'owner' | 'admin' | 'member'
type WorkspaceMembership = { id: string; role: WorkspaceRole }

const roleLabel: Record<WorkspaceRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

// `all` stands in for the empty filter: a segmented option needs a value.
const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'dismissed', label: 'Dismissed' },
]

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

  // Scope every list request to the line the user arrived for. Without this the
  // page listed every match in the workspace, which is not what "Find catalog
  // matches" on a single discrepancy row means. Empty when opened from the
  // sidebar, which keeps the workspace-wide listing for that entry point.
  //
  // It is the same line matchQuery searches by. A flag's link carries both its
  // PO and its invoice line ids, a search stores matches under the PO line
  // only, and the API ANDs the two filters, so scoping to both listed nothing
  // right after "1 match found".
  const lineScope = React.useMemo(
    () => (poLineItemId ? { poLineItemId } : invoiceLineItemId ? { invoiceLineItemId } : {}),
    [poLineItemId, invoiceLineItemId],
  )

  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [vendors, setVendors] = React.useState<VendorDetail[]>([])
  const [matches, setMatches] = React.useState<CatalogMatch[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  // B18. Set when the first load answers 403; the page then shows only the
  // no-access state instead of empty content.
  const [accessDenied, setAccessDenied] = React.useState(false)
  const [vendorFilter, setVendorFilter] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<CatalogMatchStatus | ''>('')
  const [isSearching, setIsSearching] = React.useState(false)
  const [isVerifying, setIsVerifying] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [dismissingId, setDismissingId] = React.useState<string | null>(null)

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'

  // Which vendor a verify runs against. The URL param is honoured first, but
  // no in-app link sets it today: purchase_orders carries no vendor column, so
  // the Discrepancies page has no vendor to pass (adding it is slice S3). The
  // vendor dropdown already on this page therefore doubles as the selector, so
  // the control is reachable instead of dead.
  const verifyVendorId = vendorIdParam ?? (vendorFilter || null)

  // Frame 2.11 (amber): name the line the list is scoped to. Every match in a
  // line-scoped list shares that line, so any loaded query item's SKU names
  // it; with none loaded yet, the truncated id stands in — the same fallback
  // the match panels use below.
  const lineItemId = poLineItemId ?? invoiceLineItemId
  const lineSku = matches.find((match) => match.queryItem?.sku)?.queryItem?.sku ?? null
  const lineScopeLabel = lineItemId
    ? `${poLineItemId ? 'PO line' : 'Invoice line'} · ${lineSku ?? `${lineItemId.slice(0, 8)}...`}`
    : null

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback

  const refetchMatches = React.useCallback(
    async (nextVendorId: string, nextStatus: CatalogMatchStatus | '') => {
      try {
        setIsLoading(true)
        const data = await listCatalogMatches(workspaceId, {
          vendorId: nextVendorId || undefined,
          status: nextStatus || undefined,
          ...lineScope,
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
    [lineScope, router, workspaceId],
  )

  const loadPage = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [workspaceData, memberships, vendorList, matchList] = await Promise.all([
        getWorkspace(workspaceId),
        listWorkspaces(),
        listVendors(workspaceId),
        listCatalogMatches(workspaceId, lineScope),
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
      if (isForbidden(err)) {
        setAccessDenied(true)
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
  }, [lineScope, router, workspaceId])

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

  // × on the line-scope chip: back to the workspace-wide list. Only the line
  // params go; anything else in the URL stays. `replace`, not `push`.
  const clearLineScope = React.useCallback(() => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('poLineItemId')
    next.delete('invoiceLineItemId')
    const query = next.toString()
    router.replace(`/workspaces/${workspaceId}/catalog-matches${query ? `?${query}` : ''}`)
  }, [router, searchParams, workspaceId])

  // A search saves the verdicts it got; candidates the model could not compare
  // are skipped and counted (B6). Said in its own toast so the success summary
  // keeps its wording and the skip cannot be missed.
  const notifyUnjudged = React.useCallback(
    (unjudged: number) => {
      if (unjudged > 0) {
        toast({
          title: 'Some catalog items were not compared',
          description: `${unjudged} catalog item${unjudged === 1 ? '' : 's'} could not be compared. Search again to retry.`,
        })
      }
    },
    [toast],
  )

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
      notifyUnjudged(result.unjudged)
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
  }, [matchQuery, notifyUnjudged, refetchMatches, router, statusFilter, toast, vendorFilter, workspaceId])

  const handleVerify = React.useCallback(async () => {
    if (!matchQuery || !verifyVendorId) return
    try {
      setIsVerifying(true)
      const result = await verifyCatalogMatches(workspaceId, verifyVendorId, matchQuery)
      const count = result.matches.length
      toast({
        variant: 'success',
        title: 'Verification complete',
        description: `${count} match${count === 1 ? '' : 'es'} found.`,
      })
      notifyUnjudged(result.unjudged)
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
  }, [matchQuery, notifyUnjudged, refetchMatches, router, statusFilter, toast, vendorFilter, verifyVendorId, workspaceId])

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
      breadcrumb={workspace ? `${workspace.name} / Matching` : 'Matching'}
      title="Catalog matches"
      description="Compare purchase order and invoice line items against vendor catalog items."
      badge={
        membership ? (
          <Badge variant={membership.role === 'member' ? 'neutral' : 'teal'}>{roleLabel[membership.role]}</Badge>
        ) : null
      }
      actions={
        canManage && matchQuery ? (
          // Frame 2.11: one teal action per view — Search all vendors is the
          // primary and sits right-most; Verify is secondary.
          <div className="flex gap-[10px]">
            {verifyVendorId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleVerify()}
                isLoading={isVerifying}
                loadingText="Verifying"
              >
                {!isVerifying ? 'Verify against this vendor' : null}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void handleSearch()} isLoading={isSearching} loadingText="Searching">
              {!isSearching ? 'Search all vendors' : null}
            </Button>
          </div>
        ) : null
      }
      onLogout={handleLogout}
    >
      {/* AppShell <main> owns the frame padding (Part 2 addendum); this is
          only the content column. Frame 2.11 main gap is 20, not 24. */}
      <div className="flex flex-col gap-[14px] lg:gap-5">
        {accessDenied ? (
          <WorkspaceAccessDenied />
        ) : (
          <>
            <div {...tourAttr(TOUR_ANCHORS.catalogActions)} className="flex flex-wrap items-center gap-3">
              {lineScopeLabel ? (
                <ScopeChip label={lineScopeLabel} clearLabel="Clear line scope" onClear={clearLineScope} />
              ) : null}
              <Select
                aria-label="Filter by vendor"
                className="h-[38px] w-[220px] rounded-[10px] pl-3 pr-9 text-[14px]"
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
              <SegmentedControl
                aria-label="Filter by status"
                size="sm"
                options={STATUS_OPTIONS}
                value={statusFilter || 'all'}
                onValueChange={(value) => handleStatusFilterChange(value === 'open' || value === 'dismissed' ? value : '')}
              />
            </div>

            {isLoading ? (
              <div aria-busy="true" className="overflow-hidden rounded-[18px] border border-border-panel bg-card">
                <SkeletonRows rows={3} columns={4} />
              </div>
            ) : matches.length === 0 ? (
              <EmptyState
                title={hasSearched ? 'No matches found' : 'No catalog matches yet'}
                description={
                  hasSearched
                    ? 'Try a different vendor or line item.'
                    : 'Search for matches from the Discrepancies page, or adjust the filters above.'
                }
                actions={
                  // Frame 2.12 (amber): opened from the sidebar, Discrepancies is
                  // the only place a search can start, so link there.
                  !hasSearched && !matchQuery ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/workspaces/${workspaceId}/discrepancies`}>
                        Open discrepancies <span aria-hidden="true">→</span>
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              matches.map((match) => (
                // C18 is the panel; its `header` slot (C-3 #8) is the top row with
                // the type chip, status and Dismiss. Dismissed panels fade (2.11).
                <PhotoCompare
                  key={match.id}
                  className={cn(match.status !== 'open' && 'opacity-70')}
                  header={
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="chip">{match.matchType === 'sourcing' ? 'Sourcing' : 'Compliance'}</Badge>
                        <Badge variant="neutral">{match.status === 'open' ? 'Open' : 'Dismissed'}</Badge>
                      </div>
                      {canManage && match.status === 'open' ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="px-[10px]"
                          aria-label={`Dismiss match ${match.id}`}
                          onClick={() => void handleDismiss(match.id)}
                          isLoading={dismissingId === match.id}
                          loadingText="Dismissing"
                        >
                          {dismissingId === match.id ? null : 'Dismiss'}
                        </Button>
                      ) : null}
                    </div>
                  }
                  query={{
                    sku: match.queryItem?.sku ?? null,
                    // Falls back to the truncated id only when the referenced
                    // line item no longer exists.
                    description:
                      match.queryItem?.description ??
                      `Query item ${(match.queryPoLineItemId ?? match.queryInvoiceLineItemId ?? '').slice(0, 8)}...`,
                  }}
                  candidate={{
                    sku: match.catalogItem?.sku ?? null,
                    description: match.catalogItem?.description ?? `Catalog item ${match.catalogItemId.slice(0, 8)}...`,
                    photoSrc: match.catalogItem?.photoStorageKey
                      ? catalogItemPhotoUrl(workspaceId, match.catalogItemId)
                      : null,
                    vendorName: vendors.find((vendor) => vendor.id === match.vendorId)?.name,
                  }}
                  verdict={{
                    score: match.score !== null ? Number(match.score) : null,
                    isMatch: match.isMatch,
                    reason: match.reason,
                  }}
                />
              ))
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
