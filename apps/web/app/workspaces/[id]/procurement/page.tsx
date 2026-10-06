'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  MicroLabel,
  PanelHeader,
  Select,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  cn,
  useToast,
} from '@repo/ui'
import { Download, Upload } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import {
  compareDocuments,
  downloadProcurementDocument,
  listGoodsReceipts,
  listInvoices,
  listPurchaseOrders,
  type ProcurementDoc,
  type ProcurementDocKind,
  type ProcurementDocStatus,
} from '@/lib/api/procurement'
import { listVendors, type VendorDetail } from '@/lib/api/catalog'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { useWorkspaceContext } from '@/components/workspace-context'
import { formatDate } from '@/lib/format-date'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { TourReplayButton } from '@/components/tour/tour-replay-button'
import { TOUR_ANCHORS, tourAttr } from '@/components/tour/tour-anchors'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'
import { BatchUploadDialog } from '@/components/procurement/batch-upload-dialog'
import { DocumentReviewModal } from '@/components/procurement/document-review-modal'

type WorkspaceRole = 'owner' | 'admin' | 'member'
type DocTab = 'purchase-orders' | 'invoices' | 'goods-receipts'

// Frame 2.1: Queued and Processing are both "waiting" (neutral); Processing
// also pulses, which the 3s poll below keeps live while it lasts.
const statusTone: Record<ProcurementDocStatus, 'neutral' | 'teal' | 'red'> = {
  pending: 'neutral',
  processing: 'neutral',
  done: 'teal',
  failed: 'red',
}

const statusLabel: Record<ProcurementDocStatus, string> = {
  pending: 'Queued',
  processing: 'Processing',
  done: 'Ready',
  failed: 'Failed',
}

const roleLabel: Record<WorkspaceRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

// The batch dialog's file-picker accept lists (kept in step with its own). The
// empty state's format label is derived from these (frame 2.3); photos are a
// second picker and are named in the description, not here.
const ACCEPT: Record<DocTab, string> = {
  'purchase-orders': '.csv,.xlsx,.pdf',
  invoices: '.csv,.xlsx,.pdf',
  // No .pdf: the extraction chain cannot express received vs accepted, so a
  // PDF receipt would silently lose the acceptance data. Deferred, not
  // forgotten.
  'goods-receipts': '.csv,.xlsx',
}

function formatLabel(accept: string): string {
  return accept
    .split(',')
    .map((extension) => extension.replace(/^\./, ''))
    .join(' / ')
}

// Per-kind copy, so a fourth kind is one row here rather than another arm in
// every ternary.
const PANEL_COPY: Record<
  DocTab,
  { eyebrow: string; title: string; uploadLabel: string; emptyTitle: string; emptyDescription: string }
> = {
  'purchase-orders': {
    eyebrow: 'Purchase orders',
    title: 'Uploaded purchase orders',
    uploadLabel: 'Upload purchase order',
    emptyTitle: 'No purchase orders yet',
    emptyDescription:
      'Upload a CSV, XLSX, or PDF purchase order, or photos of a paper one, to compare it against an invoice.',
  },
  invoices: {
    eyebrow: 'Invoices',
    title: 'Uploaded invoices',
    uploadLabel: 'Upload invoice',
    emptyTitle: 'No invoices yet',
    emptyDescription:
      'Upload a CSV, XLSX, or PDF invoice, or photos of a paper one, to compare it against a purchase order.',
  },
  'goods-receipts': {
    eyebrow: 'Goods receipts',
    title: 'Uploaded goods receipts',
    uploadLabel: 'Upload goods receipt',
    emptyTitle: 'No goods receipts yet',
    emptyDescription:
      'Upload a CSV or XLSX goods receipt, or photos of a paper one, to record what was actually delivered against a purchase order.',
  },
}

const numberColumnLabel: Record<DocTab, string> = {
  'purchase-orders': 'PO number',
  invoices: 'Invoice number',
  'goods-receipts': 'GRN number',
}

// Frames 2.1 / 2.2 fixed column widths. Currency and Created differ by kind;
// receipts have no Currency column at all.
const columnWidth: Record<DocTab, { currency: string; created: string }> = {
  'purchase-orders': { currency: 'w-[80px]', created: 'w-[108px]' },
  invoices: { currency: 'w-[90px]', created: 'w-[120px]' },
  'goods-receipts': { currency: '', created: 'w-[120px]' },
}

function documentNumber(doc: ProcurementDoc, kind: ProcurementDocKind): string | null | undefined {
  switch (kind) {
    case 'purchase-orders':
      return doc.poNumber
    case 'invoices':
      return doc.invoiceNumber
    case 'goods-receipts':
      return doc.grnNumber
  }
}

/** C21: a 28px numbered tile and its hairline. Step 3 is amber — it ends in exceptions. */
function CompareStep({ step, tone }: { step: number; tone: 'teal' | 'amber' }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-[9px] font-mono text-[12px]',
          tone === 'teal' ? 'bg-primary-strong text-primary-strong-foreground' : 'bg-flag text-flag-foreground',
        )}
      >
        {step}
      </span>
      <span className={cn('h-px flex-1', tone === 'teal' ? 'bg-border-panel' : 'bg-flag/35')} />
    </div>
  )
}

export default function ProcurementPage({ params }: { params: { id: string } }) {
  const workspaceId = params.id
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)

  const { workspace, membership, status: workspaceStatus } = useWorkspaceContext()
  const [activeTab, setActiveTab] = React.useState<DocTab>('purchase-orders')
  const [purchaseOrders, setPurchaseOrders] = React.useState<ProcurementDoc[]>([])
  const [invoices, setInvoices] = React.useState<ProcurementDoc[]>([])
  const [goodsReceipts, setGoodsReceipts] = React.useState<ProcurementDoc[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = React.useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState('')
  const [isComparing, setIsComparing] = React.useState(false)

  // POLICY v1 #3: the vendor is picked from the workspace's own vendors, so the
  // batch dialog needs the list.
  const [vendors, setVendors] = React.useState<VendorDetail[]>([])
  // The batch dialog follows the active tab. It stays mounted and only `open`
  // toggles, so an upload in flight is not torn down by closing the dialog.
  const [batchOpen, setBatchOpen] = React.useState(false)
  // Photo intake: the document whose AI-read lines are being reviewed.
  const [reviewTarget, setReviewTarget] = React.useState<{ kind: DocTab; docId: string } | null>(null)

  // B14. Set when the first load answers 403; the page then shows only the
  // no-access state instead of empty lists.
  const [pageAccessDenied, setAccessDenied] = React.useState(false)
  const accessDenied = pageAccessDenied || workspaceStatus === 'denied'

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : fallback

  // Only refetches the two document lists -- used after uploads/mutations and by the
  // poll below, so it never flips isLoading back to true and re-flashes the skeleton.
  const refreshDocs = React.useCallback(async () => {
    try {
      const [pos, invs, grns] = await Promise.all([
        listPurchaseOrders(workspaceId),
        listInvoices(workspaceId),
        listGoodsReceipts(workspaceId),
      ])
      setPurchaseOrders(Array.isArray(pos) ? pos : [])
      setInvoices(Array.isArray(invs) ? invs : [])
      setGoodsReceipts(Array.isArray(grns) ? grns : [])
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Failed to refresh documents',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    }
  }, [router, workspaceId])

  const loadPage = React.useCallback(async () => {
    try {
      const [pos, invs, grns] = await Promise.all([
        listPurchaseOrders(workspaceId),
        listInvoices(workspaceId),
        listGoodsReceipts(workspaceId),
      ])
      // Failure here must not blank the page: without vendors the PO modal
      // shows its empty state, which is a better outcome than no page at all.
      void listVendors(workspaceId)
        .then((items) => setVendors(Array.isArray(items) ? items : []))
        .catch(() => setVendors([]))
      setPurchaseOrders(Array.isArray(pos) ? pos : [])
      setInvoices(Array.isArray(invs) ? invs : [])
      setGoodsReceipts(Array.isArray(grns) ? grns : [])
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
        title: 'Failed to load procurement documents',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsLoading(false)
    }
  }, [router, workspaceId])

  React.useEffect(() => {
    void loadPage()
  }, [loadPage])

  // Purchase orders and invoices are parsed asynchronously -- poll while any row across
  // either list is still pending/processing so status/rowCount update without a reload.
  React.useEffect(() => {
    const hasInFlight = [...purchaseOrders, ...invoices, ...goodsReceipts].some(
      (doc) => doc.status === 'pending' || doc.status === 'processing',
    )
    if (!hasInFlight) return

    const interval = window.setInterval(() => void refreshDocs(), 3000)
    return () => window.clearInterval(interval)
  }, [purchaseOrders, invoices, goodsReceipts, refreshDocs])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  // Photo documents wait for a human confirm: until then they are not offered
  // for comparison (the API refuses them too).
  const isPendingReview = (doc: ProcurementDoc) => doc.reviewRequired === true && !doc.reviewedAt
  const donePurchaseOrders = purchaseOrders.filter((doc) => doc.status === 'done' && !isPendingReview(doc))
  const doneInvoices = invoices.filter((doc) => doc.status === 'done' && !isPendingReview(doc))

  const handleCompare = React.useCallback(async () => {
    if (!selectedPurchaseOrderId || !selectedInvoiceId) return

    setIsComparing(true)
    try {
      await compareDocuments(workspaceId, {
        purchaseOrderId: selectedPurchaseOrderId,
        invoiceId: selectedInvoiceId,
      })
      router.push(
        `/workspaces/${workspaceId}/discrepancies?purchaseOrderId=${selectedPurchaseOrderId}&invoiceId=${selectedInvoiceId}`,
      )
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
        return
      }
      toastRef.current({
        variant: 'error',
        title: 'Comparison failed',
        description: extractErrorMessage(err, 'Try again in a moment.'),
      })
    } finally {
      setIsComparing(false)
    }
  }, [router, selectedInvoiceId, selectedPurchaseOrderId, workspaceId])

  // Not role-gated: the list itself is member-readable, and so is the file
  // behind it. `fetchDownload` triggers the browser save; there is nothing to
  // render, so failures surface as a toast.
  const handleDownload = React.useCallback(
    async (kind: ProcurementDocKind, doc: ProcurementDoc) => {
      try {
        await downloadProcurementDocument(workspaceId, kind, doc.id)
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push('/login')
          return
        }
        toastRef.current({
          variant: 'error',
          title: 'Failed to download document',
          description: extractErrorMessage(err, 'Try again in a moment.'),
        })
      }
    },
    [router, workspaceId],
  )

  // Frame 2.1: counts come from the lists already loaded — no extra request.
  const tabItems = [
    { id: 'purchase-orders', label: 'Purchase Orders', shortLabel: 'POs', count: purchaseOrders.length },
    { id: 'invoices', label: 'Invoices', shortLabel: 'Invoices', count: invoices.length },
    { id: 'goods-receipts', label: 'Goods Receipts', shortLabel: 'Receipts', count: goodsReceipts.length },
  ]

  const kindDocs: Record<DocTab, ProcurementDoc[]> = {
    'purchase-orders': purchaseOrders,
    invoices,
    'goods-receipts': goodsReceipts,
  }

  const renderDocsTableBody = (docs: ProcurementDoc[], kind: DocTab) => (
    <>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Name</TableHead>
          <TableHead>{numberColumnLabel[kind]}</TableHead>
          {kind === 'purchase-orders' ? <TableHead>Vendor</TableHead> : null}
          {kind !== 'goods-receipts' ? <TableHead className={columnWidth[kind].currency}>Currency</TableHead> : null}
          <TableHead className="w-[128px]">Status</TableHead>
          <TableHead className="w-[60px] text-right">Rows</TableHead>
          <TableHead className={columnWidth[kind].created}>Created</TableHead>
          <TableHead className="w-[64px] pr-5 text-right">Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.map((doc) => (
          <TableRow key={doc.id}>
            <TableCell className="pl-6">
              <div className="font-medium">{doc.name}</div>
              {doc.status === 'failed' && doc.lastError ? (
                <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-destructive-strong-text">
                  {doc.lastError}
                </p>
              ) : null}
            </TableCell>
            {/* Em dash, not a hidden row: documents uploaded before S3b have no
                header, and they still need to be listed and downloadable. */}
            <TableCell className="font-mono text-[13px]">{documentNumber(doc, kind) ?? '—'}</TableCell>
            {kind === 'purchase-orders' ? <TableCell>{doc.vendorName ?? '—'}</TableCell> : null}
            {kind !== 'goods-receipts' ? (
              <TableCell className="font-mono text-[13px]">{doc.currency ?? '—'}</TableCell>
            ) : null}
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusTone[doc.status]} pulse={doc.status === 'processing'}>
                  {statusLabel[doc.status]}
                </Badge>
                {doc.status === 'done' && isPendingReview(doc) ? (
                  <>
                    <Badge variant="amber">Needs review</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Review ${doc.name}`}
                      onClick={() => setReviewTarget({ kind, docId: doc.id })}
                    >
                      Review
                    </Button>
                  </>
                ) : null}
              </div>
            </TableCell>
            <TableCell numeric>{doc.rowCount ?? '—'}</TableCell>
            <TableCell className="font-mono text-[13px] text-ink-body">{formatDate(doc.createdAt)}</TableCell>
            <TableCell className="py-[6px] pl-0 pr-[14px] text-right">
              {doc.hasSourceFile ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-[34px] hover:text-primary-strong"
                  aria-label={`Download ${doc.name}`}
                  onClick={() => void handleDownload(kind, doc)}
                >
                  <Download className="size-4" />
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </>
  )

  // Three tabs, one recipe: the table is the panel body (no Card inside a
  // Card), and an empty list nests C11 inside the same panel.
  const renderDocsPanel = (kind: DocTab) => {
    const copy = PANEL_COPY[kind]
    const docs = kindDocs[kind]
    const openPicker = () => setBatchOpen(true)
    const header = (
      <PanelHeader
        className="max-lg:hidden"
        eyebrow={copy.eyebrow}
        title={copy.title}
        action={
          canManage ? (
            <>
              {/* Below lg the full-width button under the tabs takes over
                  (frame 4.2), so this one only shows from lg up. */}
              <Button
                size="sm"
                className="hidden lg:inline-flex"
                {...tourAttr(TOUR_ANCHORS.procurementUpload)}
                onClick={openPicker}
              >
                <Upload className="size-4" />
                {copy.uploadLabel}
              </Button>
            </>
          ) : undefined
        }
      />
    )

    if (docs.length === 0) {
      return (
        <Card variant="panel" className="overflow-hidden p-0">
          {header}
          <div className="p-6">
            <EmptyState
              nested
              label={formatLabel(ACCEPT[kind])}
              title={copy.emptyTitle}
              description={copy.emptyDescription}
              descriptionClassName="max-w-[52ch]"
              actions={
                canManage ? (
                  <Button size="sm" onClick={openPicker}>
                    <Upload className="size-4" />
                    {copy.uploadLabel}
                  </Button>
                ) : undefined
              }
            />
          </div>
        </Card>
      )
    }

    return (
      <Table header={header} className="min-w-[760px] table-fixed">
        {renderDocsTableBody(docs, kind)}
      </Table>
    )
  }

  // Steps 1 and 2 of C21. Owner/admin only (C-3 #3: members see the rule chip
  // instead, per frame 2.2).
  const pairPickers = (
    <>
      <div>
        <CompareStep step={1} tone="teal" />
        <label className="mt-[14px] flex flex-col gap-2">
          <span className="text-[14px] font-medium">Purchase order</span>
          <Select
            aria-label="Purchase order"
            value={selectedPurchaseOrderId}
            onChange={(event) => setSelectedPurchaseOrderId(event.target.value)}
          >
            <option value="">Select purchase order</option>
            {donePurchaseOrders.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div>
        <CompareStep step={2} tone="teal" />
        <label className="mt-[14px] flex flex-col gap-2">
          <span className="text-[14px] font-medium">Invoice</span>
          <Select
            aria-label="Invoice"
            value={selectedInvoiceId}
            onChange={(event) => setSelectedInvoiceId(event.target.value)}
          >
            <option value="">Select invoice</option>
            {doneInvoices.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </>
  )

  // Frame 2.3 (C-3 #14): until one PO and one invoice are Ready there is
  // nothing to pick, so the panel fades and says so instead of offering empty
  // selects and a dead button.
  const nothingReady = donePurchaseOrders.length === 0 || doneInvoices.length === 0

  const comparePanel = !canManage ? (
    <Card variant="panel" className="p-6">
      <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <Eyebrow>Compare</Eyebrow>
          <h2 className="mt-[10px] text-[22px]">Run a comparison</h2>
          <p className="mt-2 text-[14px] text-ink-body">
            Running a comparison needs an owner or admin.
          </p>
        </div>
        {/* Frame 2.2: state the rule instead of letting the button vanish. */}
        <MicroLabel
          as="span"
          tone="neutral"
          className="justify-self-start rounded-[8px] border border-border-panel bg-surface-subtle px-[10px] py-[6px]"
        >
          Owners &amp; admins run comparisons
        </MicroLabel>
      </div>
    </Card>
  ) : nothingReady ? (
    <Card variant="panel" className="p-6 opacity-60">
      <Eyebrow>Compare</Eyebrow>
      <h2 className="mt-[10px] text-[22px]">Run a comparison</h2>
      <p className="mt-2 text-[14px] text-ink-body">
        Selects list no documents and the button stays disabled until one PO and one invoice are Ready.
      </p>
    </Card>
  ) : (
    <Card variant="panel" className="p-6">
      <Eyebrow>Compare</Eyebrow>
      <h2 className="mt-[10px] text-[22px]">Run a comparison</h2>
      <p className="mt-2 text-[14px] text-ink-body">
        Pick a parsed purchase order and invoice to check for discrepancies.
      </p>
      <div className="mt-[22px] grid grid-cols-1 items-end gap-6 md:grid-cols-3">
        {pairPickers}
        <div>
          <CompareStep step={3} tone="amber" />
          <div className="mt-[14px] flex flex-col gap-2">
            <span className="text-[14px] font-medium">Review the exceptions</span>
            <Button
              className="w-full justify-between"
              onClick={() => void handleCompare()}
              disabled={!selectedPurchaseOrderId || !selectedInvoiceId}
              isLoading={isComparing}
              loadingText="Comparing"
            >
              {!isComparing ? (
                <>
                  Run comparison <span aria-hidden="true">→</span>
                </>
              ) : null}
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-[14px] font-mono text-[11px] text-ink-muted">
        only parsed (Ready) documents are listed · opens Discrepancies filtered to this pair
      </p>
    </Card>
  )

  // Frame 4.2 (C-3 #13): below lg the active tab's upload is one full-width
  // h46 r12 primary button directly under the tabs; it opens the same dialog.
  const mobileUpload = canManage ? (
    <Button
      className="h-[46px] w-full justify-between rounded-[12px] px-4 text-[15px] lg:hidden"
      {...tourAttr(TOUR_ANCHORS.procurementUploadMobile)}
      onClick={() => setBatchOpen(true)}
    >
      {PANEL_COPY[activeTab].uploadLabel} <span aria-hidden="true">↑</span>
    </Button>
  ) : null

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      userFooter={({ collapsed }) => <TourReplayButton collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      breadcrumb={workspace ? `${workspace.name} / Matching` : 'Matching'}
      mobileBreadcrumb={workspace ? workspace.name : undefined}
      // This page renders its own mobile upload under the tabs (C-3 #13).
      hideMobileActions
      title="Purchase orders, invoices & goods receipts"
      mobileTitle="Purchase orders"
      description="Upload what was ordered, what was delivered, and what was billed, then compare a pair to surface discrepancies."
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
            <div {...tourAttr(TOUR_ANCHORS.procurementTabs)}>
              <Tabs
                items={tabItems}
                value={activeTab}
                onValueChange={(id) => setActiveTab(id as DocTab)}
                aria-label="Document type"
                fullWidth
              />
            </div>
            {mobileUpload}
            {renderDocsPanel(activeTab)}
            <div {...tourAttr(TOUR_ANCHORS.procurementCompare)}>{comparePanel}</div>
          </>
        )}
      </div>

      {canManage ? (
        <BatchUploadDialog
          open={batchOpen}
          onClose={() => setBatchOpen(false)}
          workspaceId={workspaceId}
          tab={activeTab}
          vendors={vendors}
          // Unpaginated on purpose: this list feeds a picker, and paginating it
          // would silently truncate the choices (risk register "Paginating A
          // List That Also Feeds A Picker").
          purchaseOrders={purchaseOrders}
          onUploaded={() => void refreshDocs()}
        />
      ) : null}

      {reviewTarget ? (
        <DocumentReviewModal
          open
          onClose={() => setReviewTarget(null)}
          workspaceId={workspaceId}
          kind={reviewTarget.kind}
          docId={reviewTarget.docId}
          canEdit={canManage}
          onReviewed={() => {
            setReviewTarget(null)
            void refreshDocs()
          }}
        />
      ) : null}
    </AppShell>
  )
}
