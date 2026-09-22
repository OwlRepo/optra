'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  Skeleton,
  Pagination,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui'
import { CheckCircle2, DollarSign, FileX, Hash, HelpCircle, PackageX, Truck } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import {
  dismissDiscrepancy,
  listDiscrepancies,
  type DiscrepancyFlag,
  type DiscrepancyFlagCounts,
  type DiscrepancyFlagStatus,
  type DiscrepancyFlagType,
} from '@/lib/api/procurement'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'
import { DiscrepancyReviewModal } from '@/components/procurement/discrepancy-review-modal'

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }
type StatusFilterValue = '' | DiscrepancyFlagStatus

// Both maps are exhaustive `Record`s on purpose: under the web app's strict
// TypeScript they are the only place in the repo that fails to compile when the
// API learns a new flag type. An unlisted type would otherwise render a blank
// badge — no crash, no warning, just a discrepancy nobody can read.
const flagTypeVariant: Record<DiscrepancyFlagType, 'warning' | 'destructive' | 'secondary'> = {
  quantity_mismatch: 'warning',
  price_mismatch: 'destructive',
  missing_on_invoice: 'secondary',
  missing_on_po: 'secondary',
  // Being billed for goods nobody kept is the one to act on first.
  invoice_exceeds_received: 'destructive',
  short_receipt: 'warning',
  // Neither of these is an accusation — they say the documents are not
  // comparable yet, which is a question for a human, not a dispute.
  uom_mismatch: 'secondary',
  currency_mismatch: 'secondary',
  // Ordering off contract is a finding about us, not about the vendor, so it
  // never renders as `destructive` however large the gap.
  contract_price_variance: 'warning',
  contract_price_unavailable: 'secondary',
}

const flagTypeLabel: Record<DiscrepancyFlagType, string> = {
  quantity_mismatch: 'Quantity mismatch',
  price_mismatch: 'Price mismatch',
  missing_on_invoice: 'Missing on invoice',
  missing_on_po: 'Missing on PO',
  short_receipt: 'Short receipt',
  invoice_exceeds_received: 'Billed above received',
  uom_mismatch: 'Unit mismatch',
  currency_mismatch: 'Currency mismatch',
  contract_price_variance: 'Off contract price',
  contract_price_unavailable: 'Contract price unclear',
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

// What the cards read before the first response lands.
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
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [flags, setFlags] = React.useState<DiscrepancyFlag[]>([])
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
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

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback

  const loadPage = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [workspaceData, flagsData, memberships] = await Promise.all([
        getWorkspace(workspaceId),
        listDiscrepancies(workspaceId, {
          purchaseOrderId: purchaseOrderIdFilter,
          invoiceId: invoiceIdFilter,
          status: statusFilter || undefined,
          page,
          pageSize,
        }),
        listWorkspaces(),
      ])
      setWorkspace(workspaceData)
      setFlags(Array.isArray(flagsData?.items) ? flagsData.items : [])
      setCounts(flagsData?.counts ?? EMPTY_COUNTS)
      setMeta({
        page: flagsData?.page ?? 1,
        pageSize: flagsData?.pageSize ?? pageSize,
        total: flagsData?.total ?? 0,
        totalPages: flagsData?.totalPages ?? 0,
      })
      const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
      setMembership(membershipItems.find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
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

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      title="Discrepancies"
      description="Line items where a purchase order and invoice don't match."
      badge={membership ? <Badge variant={membership.role === 'member' ? 'secondary' : 'success'}>{membership.role}</Badge> : null}
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
        {isLoading ? (
          <Card variant="elevated" className="space-y-4 p-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="Quantity mismatches" value={counts.quantity_mismatch} icon={<Hash className="size-5" />} />
              <StatCard label="Price mismatches" value={counts.price_mismatch} icon={<DollarSign className="size-5" />} />
              <StatCard
                label="Receiving exceptions"
                value={sumOf(counts, RECEIVING_TYPES)}
                icon={<Truck className="size-5" />}
              />
              <StatCard label="Missing on invoice" value={counts.missing_on_invoice} icon={<FileX className="size-5" />} />
              <StatCard label="Missing on PO" value={counts.missing_on_po} icon={<PackageX className="size-5" />} />
              <StatCard
                label="Needs review"
                value={sumOf(counts, NEEDS_REVIEW_TYPES)}
                icon={<HelpCircle className="size-5" />}
              />
            </div>

            <Card variant="elevated" className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  aria-label="Filter by status"
                  className="sm:w-40"
                  value={statusFilter}
                  onChange={(event) => applyStatusFilter(event.target.value as StatusFilterValue)}
                >
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="dismissed">Dismissed</option>
                </Select>
              </div>
            </Card>

            {flags.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="size-5" />}
                title="No discrepancies"
                description="Every checked line item matches."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>PO value</TableHead>
                    {/* Ordered, received, billed — read left to right, which is
                        the order the documents arrive in. Empty on every
                        two-way flag, which is honest: nothing was received
                        because no receipt was compared. */}
                    <TableHead>Received</TableHead>
                    <TableHead>Invoice value</TableHead>
                    <TableHead>Delta</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flags.map((flag) => (
                    <TableRow key={flag.id}>
                      <TableCell className="font-medium">{flag.sku ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={flagTypeVariant[flag.flagType]}>{flagTypeLabel[flag.flagType]}</Badge>
                      </TableCell>
                      <TableCell>{flag.poValue ?? '—'}</TableCell>
                      <TableCell>{flag.receivedValue ?? '—'}</TableCell>
                      <TableCell>{flag.invoiceValue ?? '—'}</TableCell>
                      <TableCell>{flag.delta ?? '—'}</TableCell>
                      <TableCell className="max-w-xs truncate" title={flag.reason}>
                        {flag.reason}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Review discrepancy ${flag.sku ?? flag.id}`}
                            onClick={() => setReviewing(flag)}
                          >
                            Review
                          </Button>
                          <Button asChild variant="ghost" size="sm">
                            <Link href={catalogMatchesHref(workspaceId, flag)}>Find catalog matches</Link>
                          </Button>
                          {canManage && flag.status === 'open' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Dismiss discrepancy ${flag.sku ?? flag.id}`}
                              onClick={() => void handleDismiss(flag)}
                            >
                              Dismiss
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {meta.total > 0 ? (
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
            ) : null}
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
