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
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  useToast,
} from '@repo/ui'
import { ClipboardList, Download, FileText, PackageCheck, Upload } from 'lucide-react'
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
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }
type DocTab = 'purchase-orders' | 'invoices' | 'goods-receipts'

const statusVariant: Record<ProcurementDocStatus, 'secondary' | 'success' | 'destructive'> = {
  pending: 'secondary',
  processing: 'secondary',
  done: 'success',
  failed: 'destructive',
}

const statusLabel: Record<ProcurementDocStatus, string> = {
  pending: 'Queued',
  processing: 'Processing',
  done: 'Ready',
  failed: 'Failed',
}

const tabItems = [
  { id: 'purchase-orders', label: 'Purchase Orders' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'goods-receipts', label: 'Goods Receipts' },
]

// Per-kind copy for the documents table, so a third kind is one row here rather
// than a third arm in every ternary.
const numberColumnLabel: Record<DocTab, string> = {
  'purchase-orders': 'PO number',
  invoices: 'Invoice number',
  'goods-receipts': 'GRN number',
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
      const [workspaceData, pos, invs, grns, memberships] = await Promise.all([
        getWorkspace(workspaceId),
        listPurchaseOrders(workspaceId),
        listInvoices(workspaceId),
        listGoodsReceipts(workspaceId),
        listWorkspaces(),
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
      const membershipItems = Array.isArray(memberships?.items) ? memberships.items : []
      setMembership(membershipItems.find((entry: WorkspaceMembership) => entry.id === workspaceId) ?? null)
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push('/login')
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

  const renderDocsTable = (docs: ProcurementDoc[], kind: ProcurementDocKind) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>{numberColumnLabel[kind]}</TableHead>
          {kind === 'purchase-orders' ? <TableHead>Vendor</TableHead> : null}
          {kind !== 'goods-receipts' ? <TableHead>Currency</TableHead> : null}
          <TableHead>Status</TableHead>
          <TableHead>Rows</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.map((doc) => (
          <TableRow key={doc.id}>
            <TableCell className="font-medium">
              <div>{doc.name}</div>
              {doc.status === 'failed' && doc.lastError ? (
                <p className="mt-1 line-clamp-2 text-xs text-destructive">{doc.lastError}</p>
              ) : null}
            </TableCell>
            {/* Em dash, not a hidden row: documents uploaded before S3b have no
                header, and they still need to be listed and downloadable. */}
            <TableCell>{documentNumber(doc, kind) ?? '—'}</TableCell>
            {kind === 'purchase-orders' ? <TableCell>{doc.vendorName ?? '—'}</TableCell> : null}
            {kind !== 'goods-receipts' ? <TableCell>{doc.currency ?? '—'}</TableCell> : null}
            <TableCell>
              <Badge variant={statusVariant[doc.status]}>{statusLabel[doc.status]}</Badge>
            </TableCell>
            <TableCell>{doc.rowCount ?? '—'}</TableCell>
            <TableCell>{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
            <TableCell className="text-right">
              {doc.hasSourceFile ? (
                <Button
                  variant="ghost"
                  size="sm"
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
    </Table>
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
      title="Purchase orders, invoices & goods receipts"
      description="Upload what was ordered, what was delivered, and what was billed, then compare a pair to surface discrepancies."
      badge={membership ? <Badge variant={membership.role === 'member' ? 'secondary' : 'success'}>{membership.role}</Badge> : null}
      onLogout={handleLogout}
    >
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
        {isLoading ? (
          <Card variant="elevated" className="space-y-4 p-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
        ) : (
          <>
            <Tabs
              items={tabItems}
              value={activeTab}
              onValueChange={(id) => setActiveTab(id as DocTab)}
              aria-label="Document type"
            />

            {/* Three tabs now, so this is a lookup rather than a nested
                ternary — a fourth kind is one entry, not another arm. */}
            {activeTab === 'purchase-orders' ? (
              <Card variant="elevated" className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-primary">Purchase orders</p>
                    <h2 className="mt-1 text-2xl font-semibold">Uploaded purchase orders</h2>
                  </div>
                  {canManage ? (
                    <>
                      <input
                        ref={poFileInputRef}
                        type="file"
                        accept=".csv,.xlsx,.pdf"
                        className="hidden"
                        onChange={(event) => void handlePurchaseOrderFileSelected(event)}
                      />
                      <Button
                        size="sm"
                        onClick={() => poFileInputRef.current?.click()}
                        isLoading={isUploadingPO}
                        loadingText="Uploading"
                      >
                        {!isUploadingPO ? <Upload className="size-4" /> : null}
                        {!isUploadingPO ? 'Upload purchase order' : null}
                      </Button>
                    </>
                  ) : null}
                </div>

                <div className="mt-6">
                  {purchaseOrders.length === 0 ? (
                    <EmptyState
                      icon={<ClipboardList className="size-5" />}
                      title="No purchase orders yet"
                      description="Upload a CSV, XLSX, or PDF purchase order to compare it against an invoice."
                      actions={
                        canManage ? (
                          <Button size="sm" onClick={() => poFileInputRef.current?.click()}>
                            <Upload className="size-4" />
                            Upload purchase order
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    renderDocsTable(purchaseOrders, 'purchase-orders')
                  )}
                </div>
              </Card>
            ) : activeTab === 'invoices' ? (
              <Card variant="elevated" className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-primary">Invoices</p>
                    <h2 className="mt-1 text-2xl font-semibold">Uploaded invoices</h2>
                  </div>
                  {canManage ? (
                    <>
                      <input
                        ref={invoiceFileInputRef}
                        type="file"
                        accept=".csv,.xlsx,.pdf"
                        className="hidden"
                        onChange={(event) => void handleInvoiceFileSelected(event)}
                      />
                      <Button
                        size="sm"
                        onClick={() => invoiceFileInputRef.current?.click()}
                        isLoading={isUploadingInvoice}
                        loadingText="Uploading"
                      >
                        {!isUploadingInvoice ? <Upload className="size-4" /> : null}
                        {!isUploadingInvoice ? 'Upload invoice' : null}
                      </Button>
                    </>
                  ) : null}
                </div>

                <div className="mt-6">
                  {invoices.length === 0 ? (
                    <EmptyState
                      icon={<FileText className="size-5" />}
                      title="No invoices yet"
                      description="Upload a CSV, XLSX, or PDF invoice to compare it against a purchase order."
                      actions={
                        canManage ? (
                          <Button size="sm" onClick={() => invoiceFileInputRef.current?.click()}>
                            <Upload className="size-4" />
                            Upload invoice
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    renderDocsTable(invoices, 'invoices')
                  )}
                </div>
              </Card>
            ) : (
              <Card variant="elevated" className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-primary">Goods receipts</p>
                    <h2 className="mt-1 text-2xl font-semibold">Uploaded goods receipts</h2>
                  </div>
                  {canManage ? (
                    <>
                      {/* No .pdf: the extraction chain cannot express received
                          vs accepted, so a PDF receipt would silently lose the
                          acceptance data. Deferred, not forgotten. */}
                      <input
                        ref={grnFileInputRef}
                        type="file"
                        accept=".csv,.xlsx"
                        className="hidden"
                        onChange={(event) => void handleGoodsReceiptFileSelected(event)}
                      />
                      <Button
                        size="sm"
                        onClick={() => grnFileInputRef.current?.click()}
                        isLoading={isUploadingGrn}
                        loadingText="Uploading"
                      >
                        {!isUploadingGrn ? <Upload className="size-4" /> : null}
                        {!isUploadingGrn ? 'Upload goods receipt' : null}
                      </Button>
                    </>
                  ) : null}
                </div>

                <div className="mt-6">
                  {goodsReceipts.length === 0 ? (
                    <EmptyState
                      icon={<PackageCheck className="size-5" />}
                      title="No goods receipts yet"
                      description="Upload a CSV or XLSX goods receipt to record what was actually delivered against a purchase order."
                      actions={
                        canManage ? (
                          <Button size="sm" onClick={() => grnFileInputRef.current?.click()}>
                            <Upload className="size-4" />
                            Upload goods receipt
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    renderDocsTable(goodsReceipts, 'goods-receipts')
                  )}
                </div>
              </Card>
            )}

            <Card variant="elevated" className="p-6">
              <p className="text-sm font-semibold text-primary">Compare</p>
              <h2 className="mt-1 text-2xl font-semibold">Run a comparison</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a parsed purchase order and invoice to check for discrepancies.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Select
                  aria-label="Purchase order"
                  className="sm:w-56"
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
                <Select
                  aria-label="Invoice"
                  className="sm:w-56"
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
                {canManage ? (
                  <Button
                    onClick={() => void handleCompare()}
                    disabled={!selectedPurchaseOrderId || !selectedInvoiceId}
                    isLoading={isComparing}
                    loadingText="Comparing"
                  >
                    {!isComparing ? 'Run comparison' : null}
                  </Button>
                ) : null}
              </div>
            </Card>
          </>
        )}
      </div>

      {/* POLICY v1 #3: the vendor is picked from this workspace's own vendors.
          With none created yet the form cannot be completed, so say so and link
          out rather than letting the user submit into a guaranteed 404. */}
      <Modal
        open={pendingPoFile !== null}
        onClose={() => setPendingPoFile(null)}
        title="Purchase order details"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingPoFile(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitPurchaseOrderUpload()}
              isLoading={isUploadingPO}
              loadingText="Uploading"
              disabled={vendors.length === 0 || !poVendorId || !poNumber.trim() || !poCurrency.trim()}
            >
              {!isUploadingPO ? 'Upload' : null}
            </Button>
          </div>
        }
      >
        {vendors.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="No vendors yet"
            description="A purchase order has to name the vendor it was raised with. Create one first, then upload again."
            actions={
              <Button size="sm" onClick={() => router.push(`/workspaces/${workspaceId}/vendors`)}>
                Go to vendors
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{pendingPoFile?.name}</p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="po-vendor">
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
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="po-number">
                PO number
              </label>
              <Input
                id="po-number"
                value={poNumber}
                maxLength={200}
                placeholder="PO-2026-1180"
                onChange={(event) => setPoNumber(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="po-currency">
                Currency
              </label>
              <Input
                id="po-currency"
                value={poCurrency}
                maxLength={3}
                placeholder="USD"
                onChange={(event) => setPoCurrency(event.target.value.toUpperCase())}
              />
            </div>
            {/* S9. Optional, and the only optional field on this form. A
                contract price has an effective window, so checking the order
                against it needs the date the order was PLACED — leaving this
                blank falls back to today, which is right for an order being
                raised now and wrong for one being backfilled. */}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="po-ordered-at">
                Order date <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="po-ordered-at"
                type="date"
                value={poOrderedAt}
                onChange={(event) => setPoOrderedAt(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                When the order was placed. Leave blank if you are uploading it the same day.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* POLICY v1 #2: the user selects the PO explicitly. Only parsed ('done')
          POs are offered — comparing against one still being parsed would fail
          later anyway, so it is not worth offering. */}
      <Modal
        open={pendingInvoiceFile !== null}
        onClose={() => setPendingInvoiceFile(null)}
        title="Invoice details"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingInvoiceFile(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitInvoiceUpload()}
              isLoading={isUploadingInvoice}
              loadingText="Uploading"
              disabled={
                purchaseOrders.length === 0 || !invoicePoId || !invoiceNumber.trim() || !invoiceCurrency.trim()
              }
            >
              {!isUploadingInvoice ? 'Upload' : null}
            </Button>
          </div>
        }
      >
        {purchaseOrders.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title="No purchase orders yet"
            description="An invoice is always matched against the purchase order it answers, so upload that first."
          />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{pendingInvoiceFile?.name}</p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="invoice-po">
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
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="invoice-number">
                Invoice number
              </label>
              <Input
                id="invoice-number"
                value={invoiceNumber}
                maxLength={200}
                placeholder="INV-44120"
                onChange={(event) => setInvoiceNumber(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="invoice-currency">
                Currency
              </label>
              <Input
                id="invoice-currency"
                value={invoiceCurrency}
                maxLength={3}
                placeholder="USD"
                onChange={(event) => setInvoiceCurrency(event.target.value.toUpperCase())}
              />
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
        title="Goods receipt details"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingGrnFile(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitGoodsReceiptUpload()}
              isLoading={isUploadingGrn}
              loadingText="Uploading"
              disabled={purchaseOrders.length === 0 || !grnPoId || !grnNumber.trim()}
            >
              {!isUploadingGrn ? 'Upload' : null}
            </Button>
          </div>
        }
      >
        {purchaseOrders.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="No purchase orders yet"
            description="A goods receipt records what arrived against an order, so upload that purchase order first."
          />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{pendingGrnFile?.name}</p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="grn-po">
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
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="grn-number">
                Goods receipt number
              </label>
              <Input
                id="grn-number"
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
