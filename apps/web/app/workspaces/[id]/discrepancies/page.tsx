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
  type DiscrepancyFlagStatus,
  type DiscrepancyFlagType,
} from '@/lib/api/procurement'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

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
}

const RECEIVING_TYPES: DiscrepancyFlagType[] = ['short_receipt', 'invoice_exceeds_received']
// The two types POLICY v1 #4 and #6 send to review rather than dispute.
const NEEDS_REVIEW_TYPES: DiscrepancyFlagType[] = ['uom_mismatch', 'currency_mismatch']

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
        }),
        listWorkspaces(),
      ])
      setWorkspace(workspaceData)
      setFlags(Array.isArray(flagsData) ? flagsData : [])
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
  }, [invoiceIdFilter, purchaseOrderIdFilter, router, statusFilter, workspaceId])

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
        setFlags((current) => current.filter((row) => row.id !== flag.id))
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
    [router, toast, workspaceId],
  )

  // Six cards, not eight: the two receiving types and the two needs-review
  // types each answer one question, and the exact type stays readable on every
  // row's badge. The summary is for deciding where to start.
  const counts = React.useMemo(
    () => ({
      quantity_mismatch: flags.filter((flag) => flag.flagType === 'quantity_mismatch').length,
      price_mismatch: flags.filter((flag) => flag.flagType === 'price_mismatch').length,
      missing_on_invoice: flags.filter((flag) => flag.flagType === 'missing_on_invoice').length,
      missing_on_po: flags.filter((flag) => flag.flagType === 'missing_on_po').length,
      receiving: flags.filter((flag) => RECEIVING_TYPES.includes(flag.flagType)).length,
      needs_review: flags.filter((flag) => NEEDS_REVIEW_TYPES.includes(flag.flagType)).length,
    }),
    [flags],
  )

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
              <StatCard label="Receiving exceptions" value={counts.receiving} icon={<Truck className="size-5" />} />
              <StatCard label="Missing on invoice" value={counts.missing_on_invoice} icon={<FileX className="size-5" />} />
              <StatCard label="Missing on PO" value={counts.missing_on_po} icon={<PackageX className="size-5" />} />
              <StatCard label="Needs review" value={counts.needs_review} icon={<HelpCircle className="size-5" />} />
            </div>

            <Card variant="elevated" className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  aria-label="Filter by status"
                  className="sm:w-40"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilterValue)}
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
          </>
        )}
      </div>
    </AppShell>
  )
}
