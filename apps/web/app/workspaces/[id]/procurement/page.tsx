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
  Input,
  MicroLabel,
  Modal,
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
import { Download, FileIcon, Upload } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import {
  compareDocuments,
  downloadProcurementDocument,
  listGoodsReceipts,
  listInvoices,
  listPurchaseOrders,
  uploadGoodsReceipt,
  uploadInvoice,
  uploadPurchaseOrder,
  type ProcurementDoc,
  type ProcurementDocKind,
  type ProcurementDocStatus,
} from '@/lib/api/procurement'
import { listVendors, type VendorDetail } from '@/lib/api/catalog'
import { isForbidden, isUnauthorized } from '@/lib/api/handle-unauthorized'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { getWorkspace } from '@/lib/api/workspaces'
import { membershipFrom } from '@/lib/workspace-role'
import { formatDate } from '@/lib/format-date'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { TOUR_ANCHORS, tourAttr } from '@/components/tour/tour-anchors'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

type Workspace = { id: string; name: string }
type WorkspaceRole = 'owner' | 'admin' | 'member'
type WorkspaceMembership = { id: string; role: WorkspaceRole }
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

// The hidden file inputs' accept lists. The empty state's format label is
// derived from these (frame 2.3), so it can never drift from what uploads take.
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
    emptyDescription: 'Upload a CSV, XLSX, or PDF purchase order to compare it against an invoice.',
  },
  invoices: {
    eyebrow: 'Invoices',
    title: 'Uploaded invoices',
    uploadLabel: 'Upload invoice',
    emptyTitle: 'No invoices yet',
    emptyDescription: 'Upload a CSV, XLSX, or PDF invoice to compare it against a purchase order.',
  },
  'goods-receipts': {
    eyebrow: 'Goods receipts',
    title: 'Uploaded goods receipts',
    uploadLabel: 'Upload goods receipt',
    emptyTitle: 'No goods receipts yet',
    emptyDescription:
      'Upload a CSV or XLSX goods receipt to record what was actually delivered against a purchase order.',
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

/** Frame 2.4: the picked file as a row, so it no longer reads like a caption. */
function HeldFileRow({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-border-segmented bg-surface-subtle px-[14px] py-3">
      <FileIcon className="size-[18px] shrink-0 text-primary-strong" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{name}</span>
      <span className="shrink-0 font-mono text-[11px] text-ink-muted">held · not uploaded yet</span>
    </div>
  )
}

export default function ProcurementPage({ params }: { params: { id: string } }) {
  const workspaceId = params.id
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const poFileInputRef = React.useRef<HTMLInputElement>(null)
  const invoiceFileInputRef = React.useRef<HTMLInputElement>(null)
  const grnFileInputRef = React.useRef<HTMLInputElement>(null)

  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [activeTab, setActiveTab] = React.useState<DocTab>('purchase-orders')
  const [purchaseOrders, setPurchaseOrders] = React.useState<ProcurementDoc[]>([])
  const [invoices, setInvoices] = React.useState<ProcurementDoc[]>([])
  const [goodsReceipts, setGoodsReceipts] = React.useState<ProcurementDoc[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isUploadingPO, setIsUploadingPO] = React.useState(false)
  const [isUploadingInvoice, setIsUploadingInvoice] = React.useState(false)
  const [isUploadingGrn, setIsUploadingGrn] = React.useState(false)
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = React.useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState('')
  const [isComparing, setIsComparing] = React.useState(false)

  // S3b. Picking a file no longer uploads it: the header POLICY v1 #2/#3
  // require cannot be read out of the document, so the file is held here while
  // the user fills it in, and the upload fires on submit.
  const [vendors, setVendors] = React.useState<VendorDetail[]>([])
  const [pendingPoFile, setPendingPoFile] = React.useState<File | null>(null)
  const [pendingInvoiceFile, setPendingInvoiceFile] = React.useState<File | null>(null)
  const [poVendorId, setPoVendorId] = React.useState('')
  const [poNumber, setPoNumber] = React.useState('')
  const [poOrderedAt, setPoOrderedAt] = React.useState('')
  const [poCurrency, setPoCurrency] = React.useState('USD')
  const [invoicePoId, setInvoicePoId] = React.useState('')
  const [invoiceNumber, setInvoiceNumber] = React.useState('')
  const [invoiceCurrency, setInvoiceCurrency] = React.useState('USD')
  // Goods receipts carry no currency (S5) — a receipt records what arrived, not
  // what it cost.
  const [pendingGrnFile, setPendingGrnFile] = React.useState<File | null>(null)
  const [grnPoId, setGrnPoId] = React.useState('')
  const [grnNumber, setGrnNumber] = React.useState('')

  // B14. Set when the first load answers 403; the page then shows only the
  // no-access state instead of empty lists.
  const [accessDenied, setAccessDenied] = React.useState(false)

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
      const [workspaceData, pos, invs, grns] = await Promise.all([
        getWorkspace(workspaceId),
        listPurchaseOrders(workspaceId),
        listInvoices(workspaceId),
        listGoodsReceipts(workspaceId),
      ])
      setWorkspace(workspaceData)
      // Failure here must not blank the page: without vendors the PO modal
      // shows its empty state, which is a better outcome than no page at all.
      void listVendors(workspaceId)
        .then((items) => setVendors(Array.isArray(items) ? items : []))
        .catch(() => setVendors([]))
      setPurchaseOrders(Array.isArray(pos) ? pos : [])
      setInvoices(Array.isArray(invs) ? invs : [])
      setGoodsReceipts(Array.isArray(grns) ? grns : [])
      setMembership(membershipFrom(workspaceData))
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

  const handlePurchaseOrderFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPoNumber('')
    setPoVendorId('')
    setPoCurrency('USD')
    setPendingPoFile(file)
  }

  const submitPurchaseOrderUpload = async () => {
    const file = pendingPoFile
    if (!file || !poVendorId || !poNumber.trim()) return

    setIsUploadingPO(true)
    try {
      await uploadPurchaseOrder(workspaceId, file, {
        vendorId: poVendorId,
        poNumber: poNumber.trim(),
        // Uppercased here too, not only on the server: the field accepts free
        // typing and the user should see the value that will actually be stored.
        currency: poCurrency.trim().toUpperCase(),
        // A date input gives YYYY-MM-DD; the API wants ISO 8601. Sent only when
        // the user filled it, because absent must stay distinguishable from a
        // guess.
        ...(poOrderedAt ? { orderedAt: new Date(`${poOrderedAt}T00:00:00.000Z`).toISOString() } : {}),
      })
      setPendingPoFile(null)
      setPoOrderedAt('')
      toastRef.current({
        variant: 'success',
        title: 'Purchase order uploaded',
        description: `${file.name} is being parsed.`,
      })
      await refreshDocs()
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
      setIsUploadingPO(false)
    }
  }

  const handleInvoiceFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setInvoiceNumber('')
    setInvoicePoId('')
    setInvoiceCurrency('USD')
    setPendingInvoiceFile(file)
  }

  const submitInvoiceUpload = async () => {
    const file = pendingInvoiceFile
    if (!file || !invoicePoId || !invoiceNumber.trim()) return

    setIsUploadingInvoice(true)
    try {
      await uploadInvoice(workspaceId, file, {
        purchaseOrderId: invoicePoId,
        invoiceNumber: invoiceNumber.trim(),
        currency: invoiceCurrency.trim().toUpperCase(),
      })
      setPendingInvoiceFile(null)
      toastRef.current({
        variant: 'success',
        title: 'Invoice uploaded',
        description: `${file.name} is being parsed.`,
      })
      await refreshDocs()
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
      setIsUploadingInvoice(false)
    }
  }

  const handleGoodsReceiptFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setGrnNumber('')
    setGrnPoId('')
    setPendingGrnFile(file)
  }

  const submitGoodsReceiptUpload = async () => {
    const file = pendingGrnFile
    if (!file || !grnPoId || !grnNumber.trim()) return

    setIsUploadingGrn(true)
    try {
      await uploadGoodsReceipt(workspaceId, file, { purchaseOrderId: grnPoId, grnNumber: grnNumber.trim() })
      setPendingGrnFile(null)
      toastRef.current({
        variant: 'success',
        title: 'Goods receipt uploaded',
        description: `${file.name} is being parsed.`,
      })
      await refreshDocs()
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
      setIsUploadingGrn(false)
    }
  }

  const donePurchaseOrders = purchaseOrders.filter((doc) => doc.status === 'done')
  const doneInvoices = invoices.filter((doc) => doc.status === 'done')

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

  const kindState: Record<
    DocTab,
    {
      docs: ProcurementDoc[]
      inputRef: React.RefObject<HTMLInputElement>
      onFileSelected: (event: React.ChangeEvent<HTMLInputElement>) => void
      isUploading: boolean
    }
  > = {
    'purchase-orders': {
      docs: purchaseOrders,
      inputRef: poFileInputRef,
      onFileSelected: handlePurchaseOrderFileSelected,
      isUploading: isUploadingPO,
    },
    invoices: {
      docs: invoices,
      inputRef: invoiceFileInputRef,
      onFileSelected: handleInvoiceFileSelected,
      isUploading: isUploadingInvoice,
    },
    'goods-receipts': {
      docs: goodsReceipts,
      inputRef: grnFileInputRef,
      onFileSelected: handleGoodsReceiptFileSelected,
      isUploading: isUploadingGrn,
    },
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
              <Badge variant={statusTone[doc.status]} pulse={doc.status === 'processing'}>
                {statusLabel[doc.status]}
              </Badge>
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
    const { docs, inputRef, onFileSelected, isUploading } = kindState[kind]
    const openPicker = () => inputRef.current?.click()
    const header = (
      <PanelHeader
        className="max-lg:hidden"
        eyebrow={copy.eyebrow}
        title={copy.title}
        action={
          canManage ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT[kind]}
                className="hidden"
                onChange={(event) => onFileSelected(event)}
              />
              {/* Below lg the full-width button under the tabs takes over
                  (frame 4.2), so this one only shows from lg up. */}
              <Button
                size="sm"
                className="hidden lg:inline-flex"
                {...tourAttr(TOUR_ANCHORS.procurementUpload)}
                onClick={openPicker}
                isLoading={isUploading}
                loadingText="Uploading"
              >
                {!isUploading ? <Upload className="size-4" /> : null}
                {!isUploading ? copy.uploadLabel : null}
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
  // h46 r12 primary button directly under the tabs; it opens the same input.
  const mobileUpload = canManage ? (
    <Button
      className="h-[46px] w-full justify-between rounded-[12px] px-4 text-[15px] lg:hidden"
      {...tourAttr(TOUR_ANCHORS.procurementUploadMobile)}
      onClick={() => kindState[activeTab].inputRef.current?.click()}
      isLoading={kindState[activeTab].isUploading}
      loadingText="Uploading"
    >
      {!kindState[activeTab].isUploading ? (
        <>
          {PANEL_COPY[activeTab].uploadLabel} <span aria-hidden="true">↑</span>
        </>
      ) : null}
    </Button>
  ) : null

  const modalFooter = (onCancel: () => void, submit: React.ReactNode) => (
    <div className="flex justify-end gap-[10px]">
      <Button variant="ghost" className="px-[14px]" onClick={onCancel}>
        Cancel
      </Button>
      {submit}
    </div>
  )

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
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

      {/* POLICY v1 #3: the vendor is picked from this workspace's own vendors.
          With none created yet the form cannot be completed, so say so and link
          out rather than letting the user submit into a guaranteed 404. */}
      <Modal
        open={pendingPoFile !== null}
        onClose={() => setPendingPoFile(null)}
        eyebrow="Upload · step 2 of 2"
        title="Purchase order details"
        footer={modalFooter(
          () => setPendingPoFile(null),
          <Button
            onClick={() => void submitPurchaseOrderUpload()}
            isLoading={isUploadingPO}
            loadingText="Uploading"
            disabled={vendors.length === 0 || !poVendorId || !poNumber.trim() || !poCurrency.trim()}
          >
            {!isUploadingPO ? 'Upload' : null}
          </Button>,
        )}
      >
        {vendors.length === 0 ? (
          <EmptyState
            nested
            label="Needs a vendor first"
            labelTone="amber"
            title="No vendors yet"
            description="A purchase order has to name the vendor it was raised with. Create one first, then upload again."
            actions={
              <Button variant="outline" size="sm" onClick={() => router.push(`/workspaces/${workspaceId}/vendors`)}>
                Go to vendors <span aria-hidden="true">→</span>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-[18px]">
            <HeldFileRow name={pendingPoFile?.name ?? ''} />
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor="po-vendor">
                Vendor
              </label>
              <Select id="po-vendor" value={poVendorId} onChange={(event) => setPoVendorId(event.target.value)}>
                <option value="">Select a vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-[14px]">
              <div className="flex flex-col gap-2">
                <label className="text-[14px] font-medium" htmlFor="po-number">
                  PO number
                </label>
                <Input
                  id="po-number"
                  className="font-mono text-[14px]"
                  value={poNumber}
                  maxLength={200}
                  placeholder="PO-2026-1180"
                  onChange={(event) => setPoNumber(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[14px] font-medium" htmlFor="po-currency">
                  Currency
                </label>
                <Input
                  id="po-currency"
                  className="font-mono text-[14px] tracking-[0.08em]"
                  value={poCurrency}
                  maxLength={3}
                  placeholder="USD"
                  onChange={(event) => setPoCurrency(event.target.value.toUpperCase())}
                />
              </div>
            </div>
            {/* S9. Optional, and the only optional field on this form. A
                contract price has an effective window, so checking the order
                against it needs the date the order was PLACED — leaving this
                blank falls back to today, which is right for an order being
                raised now and wrong for one being backfilled. */}
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor="po-ordered-at">
                Order date <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <Input
                id="po-ordered-at"
                type="date"
                className="font-mono text-[14px]"
                value={poOrderedAt}
                onChange={(event) => setPoOrderedAt(event.target.value)}
              />
              <p className="text-[13px] leading-[1.5] text-ink-muted">
                When the order was placed. Leave blank if you are uploading it the same day.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* POLICY v1 #2: the user selects the PO explicitly. The picker lists
          every purchase order unpaginated — paginating this list would
          silently truncate the picker (risk register "Paginating A List That
          Also Feeds A Picker"). */}
      <Modal
        open={pendingInvoiceFile !== null}
        onClose={() => setPendingInvoiceFile(null)}
        eyebrow="Upload · step 2 of 2"
        title="Invoice details"
        footer={modalFooter(
          () => setPendingInvoiceFile(null),
          <Button
            onClick={() => void submitInvoiceUpload()}
            isLoading={isUploadingInvoice}
            loadingText="Uploading"
            disabled={
              purchaseOrders.length === 0 || !invoicePoId || !invoiceNumber.trim() || !invoiceCurrency.trim()
            }
          >
            {!isUploadingInvoice ? 'Upload' : null}
          </Button>,
        )}
      >
        {purchaseOrders.length === 0 ? (
          <EmptyState
            nested
            label="Needs a purchase order first"
            labelTone="amber"
            title="No purchase orders yet"
            description="An invoice is always matched against the purchase order it answers, so upload that first."
          />
        ) : (
          <div className="flex flex-col gap-[18px]">
            <HeldFileRow name={pendingInvoiceFile?.name ?? ''} />
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor="invoice-po">
                Purchase order
              </label>
              <Select id="invoice-po" value={invoicePoId} onChange={(event) => setInvoicePoId(event.target.value)}>
                <option value="">Select a purchase order</option>
                {purchaseOrders.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.poNumber ? `${doc.poNumber} — ${doc.name}` : doc.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-[14px]">
              <div className="flex flex-col gap-2">
                <label className="text-[14px] font-medium" htmlFor="invoice-number">
                  Invoice number
                </label>
                <Input
                  id="invoice-number"
                  className="font-mono text-[14px]"
                  value={invoiceNumber}
                  maxLength={200}
                  placeholder="INV-44120"
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[14px] font-medium" htmlFor="invoice-currency">
                  Currency
                </label>
                <Input
                  id="invoice-currency"
                  className="font-mono text-[14px]"
                  value={invoiceCurrency}
                  maxLength={3}
                  placeholder="USD"
                  onChange={(event) => setInvoiceCurrency(event.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* POLICY v1 #2 again: a receipt answers exactly one purchase order, and
          the column behind this is NOT NULL — a receipt with no order is not
          evidence of anything. No currency field: a receipt records what
          arrived, not what it cost. */}
      <Modal
        open={pendingGrnFile !== null}
        onClose={() => setPendingGrnFile(null)}
        eyebrow="Upload · step 2 of 2"
        title="Goods receipt details"
        footer={modalFooter(
          () => setPendingGrnFile(null),
          <Button
            onClick={() => void submitGoodsReceiptUpload()}
            isLoading={isUploadingGrn}
            loadingText="Uploading"
            disabled={purchaseOrders.length === 0 || !grnPoId || !grnNumber.trim()}
          >
            {!isUploadingGrn ? 'Upload' : null}
          </Button>,
        )}
      >
        {purchaseOrders.length === 0 ? (
          <EmptyState
            nested
            label="Needs a purchase order first"
            labelTone="amber"
            title="No purchase orders yet"
            description="A goods receipt records what arrived against an order, so upload that purchase order first."
          />
        ) : (
          <div className="flex flex-col gap-[18px]">
            <HeldFileRow name={pendingGrnFile?.name ?? ''} />
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor="grn-po">
                Purchase order
              </label>
              <Select id="grn-po" value={grnPoId} onChange={(event) => setGrnPoId(event.target.value)}>
                <option value="">Select a purchase order</option>
                {purchaseOrders.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.poNumber ? `${doc.poNumber} — ${doc.name}` : doc.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor="grn-number">
                Goods receipt number
              </label>
              <Input
                id="grn-number"
                className="font-mono text-[14px]"
                value={grnNumber}
                maxLength={200}
                placeholder="GRN-9001"
                onChange={(event) => setGrnNumber(event.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}
