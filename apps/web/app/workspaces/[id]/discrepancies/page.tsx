'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  EmptyState,
  Pagination,
  SegmentedControl,
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
import { logout } from '@/lib/api/auth'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { useWorkspaceContext } from '@/components/workspace-context'
import {
  dismissDiscrepancy,
  listDiscrepancies,
  listInvoices,
  listPurchaseOrders,
  type DiscrepancyFlag,
  type DiscrepancyFlagCounts,
  type DiscrepancyFlagStatus,
  type DiscrepancyFlagType,
} from '@/lib/api/procurement'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { TourReplayButton } from '@/components/tour/tour-replay-button'
import { TOUR_ANCHORS, tourAttr } from '@/components/tour/tour-anchors'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'
import { DiscrepancyReviewModal } from '@/components/procurement/discrepancy-review-modal'
import { ScopeChip } from '@/components/procurement/scope-chip'
import { flagTypeLabel, flagTypeTone, type FlagTone, formatDelta } from '@/components/procurement/flag-type'

type WorkspaceRole = 'owner' | 'admin' | 'member'
type StatusFilterValue = '' | DiscrepancyFlagStatus

const roleLabel: Record<WorkspaceRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

// `all` stands in for the empty filter: a segmented option needs a value.
const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'dismissed', label: 'Dismissed' },
]

const deltaInk: Record<FlagTone, string> = {
  red: 'text-destructive-strong-text',
  amber: 'text-flag-text',
  neutral: 'text-[oklch(0.6_0.02_264)]',
}

const RECEIVING_TYPES: DiscrepancyFlagType[] = ['short_receipt', 'invoice_exceeds_received']
// The two types POLICY v1 #4 and #6 send to review rather than dispute.
const NEEDS_REVIEW_TYPES: DiscrepancyFlagType[] = [
  'uom_mismatch',
  'currency_mismatch',
  // Same family: the documents cannot be compared as they stand, so a human
  // decides rather than the engine asserting.
  'contract_price_unavailable',
]

// What the stat strip reads before the first response lands.
const EMPTY_COUNTS: DiscrepancyFlagCounts = {
  quantity_mismatch: 0,
  price_mismatch: 0,
  missing_on_invoice: 0,
  missing_on_po: 0,
  short_receipt: 0,
  invoice_exceeds_received: 0,
  uom_mismatch: 0,
  currency_mismatch: 0,
  contract_price_variance: 0,
  contract_price_unavailable: 0,
}

const sumOf = (counts: DiscrepancyFlagCounts, types: DiscrepancyFlagType[]) =>
  types.reduce((total, type) => total + (counts[type] ?? 0), 0)

function catalogMatchesHref(workspaceId: string, flag: DiscrepancyFlag) {
  const params = new URLSearchParams()
  if (flag.poLineItemId) params.set('poLineItemId', flag.poLineItemId)
  if (flag.invoiceLineItemId) params.set('invoiceLineItemId', flag.invoiceLineItemId)
  const query = params.toString()

  return `/workspaces/${workspaceId}/catalog-matches${query ? `?${query}` : ''}`
}

export default function DiscrepanciesPage({ params }: { params: { id: string } }) {
  const workspaceId = params.id
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const { workspace, membership, status: workspaceStatus } = useWorkspaceContext()
  const [flags, setFlags] = React.useState<DiscrepancyFlag[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  // B18. Set when the first load answers 403; the page then shows only the
  // no-access state instead of empty content.
  const [pageAccessDenied, setAccessDenied] = React.useState(false)
  const accessDenied = pageAccessDenied || workspaceStatus === 'denied'
  const [statusFilter, setStatusFilter] = React.useState<StatusFilterValue>('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  // Server-owned: `counts` describes the whole filtered set and `meta` the
  // paging. Neither can be derived from `flags`, which is one page.
  const [counts, setCounts] = React.useState<DiscrepancyFlagCounts>(EMPTY_COUNTS)
  // The row under review. Null closes the panel; the flag itself is what it
  // renders, so no second fetch is needed to open it.
  const [reviewing, setReviewing] = React.useState<DiscrepancyFlag | null>(null)
  const [meta, setMeta] = React.useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 })

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'
  const purchaseOrderIdFilter = searchParams.get('purchaseOrderId') ?? undefined
  const invoiceIdFilter = searchParams.get('invoiceId') ?? undefined
  // Frame 2.7 (amber, C-3 #1): the pair scope Run comparison applies was
  // silent. The chip names it by document number (file name when a legacy
  // document has none), and by the raw id while the lookup is in flight, when
  // a document is not found, or when the lookup fails.
  const [pairNames, setPairNames] = React.useState<{ po: string | null; invoice: string | null } | null>(null)
  const pairLabel =
    purchaseOrderIdFilter && invoiceIdFilter
      ? `${pairNames?.po ?? purchaseOrderIdFilter} ↔ ${pairNames?.invoice ?? invoiceIdFilter}`
      : null

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  // Only runs when both params are set. Two existing GETs, no API change; a
  // failure here is silent for the chip and never touches the list.
  React.useEffect(() => {
    setPairNames(null)
    if (!purchaseOrderIdFilter || !invoiceIdFilter) return
    let cancelled = false
    Promise.all([listPurchaseOrders(workspaceId), listInvoices(workspaceId)])
      .then(([pos, invs]) => {
        if (cancelled) return
        const po = (Array.isArray(pos) ? pos : []).find((doc) => doc.id === purchaseOrderIdFilter)
        const invoice = (Array.isArray(invs) ? invs : []).find((doc) => doc.id === invoiceIdFilter)
        setPairNames({
          po: po ? (po.poNumber ?? po.name) : null,
          invoice: invoice ? (invoice.invoiceNumber ?? invoice.name) : null,
        })
      })
      .catch(() => {
        // Ids stay on the chip.
      })
    return () => {
      cancelled = true
    }
  }, [invoiceIdFilter, purchaseOrderIdFilter, workspaceId])

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback

  const loadPage = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [flagsData] = await Promise.all([
        listDiscrepancies(workspaceId, {
          purchaseOrderId: purchaseOrderIdFilter,
          invoiceId: invoiceIdFilter,
          status: statusFilter || undefined,
          page,
          pageSize,
        }),
      ])
      setFlags(Array.isArray(flagsData?.items) ? flagsData.items : [])
      setCounts(flagsData?.counts ?? EMPTY_COUNTS)
      setMeta({
        page: flagsData?.page ?? 1,
        pageSize: flagsData?.pageSize ?? pageSize,
        total: flagsData?.total ?? 0,
        totalPages: flagsData?.totalPages ?? 0,
      })
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
        title: 'Failed to load discrepancies',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsLoading(false)
    }
  }, [invoiceIdFilter, page, pageSize, purchaseOrderIdFilter, router, statusFilter, workspaceId])

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

  const handleDismiss = React.useCallback(
    async (flag: DiscrepancyFlag) => {
      try {
        await dismissDiscrepancy(workspaceId, flag.id)
        // Refetch rather than splice: on a server-paginated list, dropping the
        // row locally leaves a short page and counts that no longer match.
        await loadPage()
        toast({
          variant: 'success',
          title: 'Discrepancy dismissed',
          description: flag.sku ? `${flag.sku} marked as reviewed.` : 'Flag marked as reviewed.',
        })
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push('/login')
          return
        }
        toast({
          variant: 'error',
          title: 'Failed to dismiss discrepancy',
          description: extractErrorMessage(err, 'Try again in a moment.'),
        })
      }
    },
    [loadPage, router, toast, workspaceId],
  )

  // Any filter change restarts the queue: page 3 of the old filter is not a
  // meaningful place to land in the new one.
  const applyStatusFilter = React.useCallback((value: StatusFilterValue) => {
    setStatusFilter(value)
    setPage(1)
  }, [])

  // × on the pair chip: back to the workspace-wide list. `replace`, not
  // `push` — the scoped view is not a step worth returning to with Back.
  const clearPairFilter = React.useCallback(() => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('purchaseOrderId')
    next.delete('invoiceId')
    const query = next.toString()
    setPage(1)
    router.replace(`/workspaces/${workspaceId}/discrepancies${query ? `?${query}` : ''}`)
  }, [router, searchParams, workspaceId])

  // C10: a value takes its tone only when it is above zero (the primitive
  // applies that rule), so an all-clear strip reads in ink.
  const statItems = [
    { label: 'Quantity mismatches', value: counts.quantity_mismatch, tone: 'amber' as const },
    { label: 'Price mismatches', value: counts.price_mismatch, tone: 'red' as const },
    { label: 'Receiving exceptions', value: sumOf(counts, RECEIVING_TYPES), tone: 'amber' as const },
    { label: 'Missing on invoice', value: counts.missing_on_invoice },
    { label: 'Missing on PO', value: counts.missing_on_po },
    { label: 'Needs review', value: sumOf(counts, NEEDS_REVIEW_TYPES) },
  ]

  const pagination =
    meta.total > 0 ? (
      <Pagination
        page={meta.page}
        pageSize={meta.pageSize}
        total={meta.total}
        totalPages={meta.totalPages}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
        isLoading={isLoading}
      />
    ) : null

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      userFooter={({ collapsed }) => <TourReplayButton collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      breadcrumb={workspace ? `${workspace.name} / Matching` : 'Matching'}
      mobileBreadcrumb={workspace ? workspace.name : undefined}
      title="Discrepancies"
      description="Line items where a purchase order and invoice don't match."
      badge={
        membership ? (
          <Badge variant={membership.role === 'member' ? 'neutral' : 'teal'}>{roleLabel[membership.role]}</Badge>
        ) : null
      }
      onLogout={handleLogout}
    >
      {/* AppShell <main> owns the frame padding (Part 2 addendum); this is
          only the content column. */}
      <div className="flex flex-col gap-[14px] lg:gap-6">
        {isLoading ? (
          <div aria-busy="true" className="overflow-hidden rounded-[18px] border border-border-panel bg-card">
            <SkeletonRows rows={5} columns={4} />
          </div>
        ) : accessDenied ? (
          <WorkspaceAccessDenied />
        ) : (
          <>
            <div {...tourAttr(TOUR_ANCHORS.discrepanciesStats)}>
              <StatStrip items={statItems} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                {...tourAttr(TOUR_ANCHORS.discrepanciesFilter)}
                className="flex w-full min-w-0 flex-wrap items-center gap-3 lg:w-auto"
              >
                <SegmentedControl
                  aria-label="Filter by status"
                  size="md"
                  fullWidth
                  options={STATUS_OPTIONS}
                  value={statusFilter || 'all'}
                  onValueChange={(value) =>
                    applyStatusFilter(value === 'open' || value === 'dismissed' ? value : '')
                  }
                />
                {pairLabel ? (
                  <ScopeChip label={pairLabel} clearLabel="Clear pair filter" onClear={clearPairFilter} />
                ) : null}
              </div>
              {meta.total > 0 ? (
                <span className="hidden font-mono text-[12px] text-ink-muted lg:inline">
                  {`${meta.total} flag${meta.total === 1 ? '' : 's'} · ${flags.length} shown`}
                </span>
              ) : null}
            </div>

            {flags.length === 0 ? (
              <>
                <EmptyState
                  label="All clear"
                  labelTone="teal"
                  title="No discrepancies"
                  description="Every checked line item matches."
                />
                {pagination}
              </>
            ) : (
              <Table className="min-w-[950px] table-fixed" footer={pagination ?? undefined}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px] pl-5">SKU</TableHead>
                    <TableHead className="w-[172px]">Type</TableHead>
                    <TableHead className="w-[64px] text-right">PO</TableHead>
                    {/* Ordered, received, billed — read left to right, which is
                        the order the documents arrive in. Empty on every
                        two-way flag, which is honest: nothing was received
                        because no receipt was compared. */}
                    <TableHead className="w-[72px] text-right">Received</TableHead>
                    <TableHead className="w-[72px] text-right">Invoice</TableHead>
                    <TableHead className="w-[62px] text-right">Delta</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-[222px] pr-5 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flags.map((flag) => {
                    const tone = flagTypeTone[flag.flagType]
                    return (
                      <TableRow key={flag.id} tone={tone} muted={flag.status === 'dismissed'}>
                        <TableCell className="truncate pl-5 font-mono text-[13px]">{flag.sku ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={tone}>{flagTypeLabel[flag.flagType]}</Badge>
                        </TableCell>
                        <TableCell numeric>{flag.poValue ?? '—'}</TableCell>
                        <TableCell numeric className="text-ink-body">
                          {flag.receivedValue ?? '—'}
                        </TableCell>
                        <TableCell numeric>{flag.invoiceValue ?? '—'}</TableCell>
                        <TableCell numeric className={deltaInk[tone]}>
                          {flag.delta === null ? '—' : formatDelta(flag.delta)}
                        </TableCell>
                        <TableCell className="truncate text-[13px] text-ink-body" title={flag.reason}>
                          {flag.reason}
                        </TableCell>
                        <TableCell className="py-[6px] pl-0 pr-4">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="xs"
                              aria-label={`Review discrepancy ${flag.sku ?? flag.id}`}
                              onClick={() => setReviewing(flag)}
                            >
                              Review
                            </Button>
                            {/* "Find catalog matches" shortens to "Matches" on
                                screen (frame 2.7); the accessible name keeps
                                the full phrase. */}
                            <Button asChild variant="ghost" size="xs" className="px-[10px]">
                              <Link href={catalogMatchesHref(workspaceId, flag)} aria-label="Find catalog matches">
                                Matches
                              </Link>
                            </Button>
                            {canManage && flag.status === 'open' ? (
                              <Button
                                variant="ghost"
                                size="xs"
                                className="px-[10px]"
                                aria-label={`Dismiss discrepancy ${flag.sku ?? flag.id}`}
                                onClick={() => void handleDismiss(flag)}
                              >
                                Dismiss
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>

      <DiscrepancyReviewModal
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        onDecided={() => void loadPage()}
        workspaceId={workspaceId}
        canManage={canManage}
        flag={reviewing}
      />
    </AppShell>
  )
}
