'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
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
import { ClipboardList, FileText, Upload } from 'lucide-react'
import { logout } from '@/lib/api/auth'
import {
  compareDocuments,
  listInvoices,
  listPurchaseOrders,
  uploadInvoice,
  uploadPurchaseOrder,
  type ProcurementDoc,
  type ProcurementDocStatus,
} from '@/lib/api/procurement'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import { getWorkspace, listWorkspaces } from '@/lib/api/workspaces'
import { WorkspaceNav, workspacePrimaryTabItems } from '@/components/workspace-nav'
import { MobileTabBar } from '@/components/mobile-tab-bar'
import { WorkspaceBrandLink } from '@/components/workspace-brand-link'

type Workspace = { id: string; name: string }
type WorkspaceMembership = { id: string; role: 'owner' | 'admin' | 'member' }
type DocTab = 'purchase-orders' | 'invoices'

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
]

export default function ProcurementPage({ params }: { params: { id: string } }) {
  const workspaceId = params.id
  const router = useRouter()
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const poFileInputRef = React.useRef<HTMLInputElement>(null)
  const invoiceFileInputRef = React.useRef<HTMLInputElement>(null)

  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [membership, setMembership] = React.useState<WorkspaceMembership | null>(null)
  const [activeTab, setActiveTab] = React.useState<DocTab>('purchase-orders')
  const [purchaseOrders, setPurchaseOrders] = React.useState<ProcurementDoc[]>([])
  const [invoices, setInvoices] = React.useState<ProcurementDoc[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isUploadingPO, setIsUploadingPO] = React.useState(false)
  const [isUploadingInvoice, setIsUploadingInvoice] = React.useState(false)
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = React.useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState('')
  const [isComparing, setIsComparing] = React.useState(false)

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
      const [pos, invs] = await Promise.all([listPurchaseOrders(workspaceId), listInvoices(workspaceId)])
      setPurchaseOrders(Array.isArray(pos) ? pos : [])
      setInvoices(Array.isArray(invs) ? invs : [])
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
      const [workspaceData, pos, invs, memberships] = await Promise.all([
        getWorkspace(workspaceId),
        listPurchaseOrders(workspaceId),
        listInvoices(workspaceId),
        listWorkspaces(),
      ])
      setWorkspace(workspaceData)
      setPurchaseOrders(Array.isArray(pos) ? pos : [])
      setInvoices(Array.isArray(invs) ? invs : [])
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
    const hasInFlight = [...purchaseOrders, ...invoices].some(
      (doc) => doc.status === 'pending' || doc.status === 'processing',
    )
    if (!hasInFlight) return

    const interval = window.setInterval(() => void refreshDocs(), 3000)
    return () => window.clearInterval(interval)
  }, [purchaseOrders, invoices, refreshDocs])

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } finally {
      router.push('/login')
    }
  }, [router])

  const handlePurchaseOrderFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setIsUploadingPO(true)
    try {
      await uploadPurchaseOrder(workspaceId, file)
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

  const handleInvoiceFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setIsUploadingInvoice(true)
    try {
      await uploadInvoice(workspaceId, file)
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

  const renderDocsTable = (docs: ProcurementDoc[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Rows</TableHead>
          <TableHead>Created</TableHead>
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
            <TableCell>
              <Badge variant={statusVariant[doc.status]}>{statusLabel[doc.status]}</Badge>
            </TableCell>
            <TableCell>{doc.rowCount ?? '—'}</TableCell>
            <TableCell>{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
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
      title="Purchase orders & invoices"
      description="Upload purchase orders and invoices, then compare a pair to surface discrepancies."
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
                    renderDocsTable(purchaseOrders)
                  )}
                </div>
              </Card>
            ) : (
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
                    renderDocsTable(invoices)
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
    </AppShell>
  )
}
