'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, EmptyState, Input, Modal, Select, StatusBanner } from '@repo/ui'
import { Camera, FileIcon, Trash2 } from 'lucide-react'
import {
  uploadGoodsReceipt,
  uploadGoodsReceiptPhotos,
  uploadInvoice,
  uploadInvoicePhotos,
  uploadPurchaseOrder,
  uploadPurchaseOrderPhotos,
  type ProcurementDoc,
} from '@/lib/api/procurement'
import type { VendorDetail } from '@/lib/api/catalog'
import { isUnauthorized } from '@/lib/api/handle-unauthorized'
import {
  addFiles,
  copyFromFirstRow,
  rowErrors,
  splitPhotoRow,
  type BatchRow,
  type BatchRowStatus,
  type BatchTab,
} from '@/components/procurement/batch-upload-rows'

// The file inputs' accept lists. Goods receipts have no .pdf: the extraction
// chain cannot express received vs accepted, so a PDF receipt would silently
// lose the acceptance data. Photos are a separate picker, on every tab.
const FILE_ACCEPT: Record<BatchTab, string> = {
  'purchase-orders': '.csv,.xlsx,.pdf',
  invoices: '.csv,.xlsx,.pdf',
  'goods-receipts': '.csv,.xlsx',
}

const TITLE: Record<BatchTab, string> = {
  'purchase-orders': 'Upload purchase orders',
  invoices: 'Upload invoices',
  'goods-receipts': 'Upload goods receipts',
}

const STATUS_BADGE: Record<BatchRowStatus, { label: string; variant: 'neutral' | 'teal' | 'red' }> = {
  ready: { label: 'Ready', variant: 'neutral' },
  uploading: { label: 'Uploading', variant: 'neutral' },
  done: { label: 'Uploaded', variant: 'teal' },
  error: { label: 'Failed', variant: 'red' },
}

function rowName(row: BatchRow): string {
  return row.kind === 'photos' && row.files.length > 1 ? `${row.files.length} photos` : row.files[0].name
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    return Array.isArray(message) ? message.join(', ') : String(message)
  }
  return 'Upload failed. Try again in a moment.'
}

export function BatchUploadDialog({
  open,
  onClose,
  workspaceId,
  tab,
  vendors,
  purchaseOrders,
  onUploaded,
}: {
  open: boolean
  onClose: () => void
  workspaceId: string
  tab: BatchTab
  vendors: VendorDetail[]
  purchaseOrders: ProcurementDoc[]
  onUploaded: () => void
}) {
  const router = useRouter()
  const filesInputRef = React.useRef<HTMLInputElement>(null)
  const photosInputRef = React.useRef<HTMLInputElement>(null)
  const [rows, setRows] = React.useState<BatchRow[]>([])
  const rowsRef = React.useRef<BatchRow[]>([])
  const [pickError, setPickError] = React.useState<string | null>(null)
  const [isRunning, setIsRunning] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')
  const [photoUploaded, setPhotoUploaded] = React.useState(false)

  const commit = React.useCallback((next: BatchRow[]) => {
    rowsRef.current = next
    setRows(next)
  }, [])

  const patchRow = React.useCallback((id: string, patch: Partial<BatchRow>) => {
    const next = rowsRef.current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    rowsRef.current = next
    setRows(next)
  }, [])

  // A fresh dialog each time it opens: rows from a previous batch are history.
  React.useEffect(() => {
    if (!open) return
    commit([])
    setPickError(null)
    setAnnouncement('')
    setPhotoUploaded(false)
  }, [open, tab, commit])

  // The loop below reads rowsRef: closing mid-run would orphan the rows it has
  // not reached. Close, Escape and the backdrop all go through here.
  const handleClose = () => {
    if (isRunning) return
    onClose()
  }

  const missingVendors = tab === 'purchase-orders' && vendors.length === 0
  const missingPurchaseOrders = tab !== 'purchase-orders' && purchaseOrders.length === 0

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    const result = addFiles(rowsRef.current, picked, tab)
    setPickError(result.error ?? null)
    if (!result.error) commit(result.rows)
  }

  const setField = (id: string, field: string, value: string) => {
    const row = rowsRef.current.find((candidate) => candidate.id === id)
    if (row) patchRow(id, { header: { ...row.header, [field]: value } })
  }

  const send = async (row: BatchRow) => {
    const h = row.header
    const photos = row.kind === 'photos'
    if (tab === 'purchase-orders') {
      const header = {
        vendorId: h.vendorId,
        poNumber: h.poNumber.trim(),
        // Uppercased here too, not only on the server: the field accepts free
        // typing and the user should see the value that will actually be stored.
        currency: h.currency.trim().toUpperCase(),
        // A date input gives YYYY-MM-DD; the API wants ISO 8601. Sent only when
        // filled, because absent must stay distinguishable from a guess.
        ...(h.orderedAt ? { orderedAt: new Date(`${h.orderedAt}T00:00:00.000Z`).toISOString() } : {}),
      }
      return photos
        ? uploadPurchaseOrderPhotos(workspaceId, row.files, header)
        : uploadPurchaseOrder(workspaceId, row.files[0], header)
    }
    if (tab === 'invoices') {
      const header = {
        purchaseOrderId: h.purchaseOrderId,
        invoiceNumber: h.invoiceNumber.trim(),
        currency: h.currency.trim().toUpperCase(),
      }
      return photos
        ? uploadInvoicePhotos(workspaceId, row.files, header)
        : uploadInvoice(workspaceId, row.files[0], header)
    }
    const header = { purchaseOrderId: h.purchaseOrderId, grnNumber: h.grnNumber.trim() }
    return photos
      ? uploadGoodsReceiptPhotos(workspaceId, row.files, header)
      : uploadGoodsReceipt(workspaceId, row.files[0], header)
  }

  // One row at a time, in row order: a failure on one row never stops the next,
  // and the server sees one upload at a time per user.
  const run = async (ids: string[]) => {
    setIsRunning(true)
    let uploaded = false
    let succeeded = 0
    let failed = 0
    try {
      for (const [index, id] of ids.entries()) {
        const row = rowsRef.current.find((candidate) => candidate.id === id)
        if (!row) continue
        patchRow(id, { status: 'uploading', error: undefined })
        setAnnouncement(`Uploading ${index + 1} of ${ids.length}`)
        try {
          await send(row)
          patchRow(id, { status: 'done' })
          uploaded = true
          succeeded += 1
          if (row.kind === 'photos') setPhotoUploaded(true)
          setAnnouncement(`Uploaded ${rowName(row)}`)
        } catch (err) {
          if (isUnauthorized(err)) {
            router.push('/login')
            return
          }
          patchRow(id, { status: 'error', error: messageOf(err) })
          failed += 1
          setAnnouncement(`Failed: ${rowName(row)}`)
        }
      }
      setAnnouncement(`${succeeded} of ${ids.length} uploaded, ${failed} failed`)
    } finally {
      setIsRunning(false)
      if (uploaded) onUploaded()
    }
  }

  const readyRows = rows.filter((row) => row.status === 'ready')
  const rowsValid = readyRows.every((row) => Object.keys(rowErrors(row, tab)).length === 0)
  const canUpload = !isRunning && readyRows.length > 0 && rowsValid
  const needsFields = !isRunning && readyRows.length > 0 && !rowsValid

  const filesInput = (
    <input
      ref={filesInputRef}
      data-testid="batch-files-input"
      type="file"
      multiple
      accept={FILE_ACCEPT[tab]}
      className="hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={handlePick}
    />
  )

  // No `capture`: on a phone the picker then offers the camera AND the library.
  const photosInput = (
    <input
      ref={photosInputRef}
      data-testid="batch-photos-input"
      type="file"
      multiple
      accept="image/*"
      className="hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={handlePick}
    />
  )

  const renderRow = (row: BatchRow) => {
    const name = rowName(row)
    const errors = rowErrors(row, tab)
    const editable = row.status === 'ready' || row.status === 'error'
    const badge = STATUS_BADGE[row.status]
    const id = (field: string) => `${row.id}-${field}`
    const numberField = tab === 'purchase-orders' ? 'poNumber' : tab === 'invoices' ? 'invoiceNumber' : 'grnNumber'
    const text = (field: string) => row.header[field] ?? ''
    // A missing field is flagged beside its own input and tied to it for
    // assistive tech; readers must not have to hunt a summary line.
    const showErrors = row.status === 'ready' || row.status === 'error'
    const fieldError = (field: string) => (showErrors ? errors[field] : undefined)
    const aria = (field: string) =>
      fieldError(field)
        ? ({ 'aria-invalid': true, 'aria-describedby': id(`${field}-error`) } as const)
        : {}
    const errorText = (field: string) =>
      fieldError(field) ? (
        <p id={id(`${field}-error`)} className="text-[12px] leading-[1.4] text-ink-body">
          {fieldError(field)}
        </p>
      ) : null

    return (
      <div
        key={row.id}
        role="group"
        aria-label={name}
        data-status={row.status}
        className="flex flex-col gap-[14px] rounded-[12px] border border-border-segmented bg-surface-subtle p-[14px]"
      >
        <div className="flex items-center gap-3">
          {row.kind === 'photos' ? (
            <Camera className="size-[18px] shrink-0 text-primary-strong" aria-hidden="true" />
          ) : (
            <FileIcon className="size-[18px] shrink-0 text-primary-strong" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
            {row.kind === 'photos' && row.files.length > 1 ? `${row.files.length} photos · one document` : row.files[0].name}
          </span>
          <Badge variant={badge.variant} pulse={row.status === 'uploading'}>
            {badge.label}
          </Badge>
          {row.status !== 'uploading' ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${name}`}
              onClick={() => commit(rowsRef.current.filter((candidate) => candidate.id !== row.id))}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        {row.kind === 'photos' && row.files.length > 1 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 break-words font-mono text-[12px] text-ink-muted">
              {row.files.map((file) => file.name).join(' → ')}
            </p>
            {row.status === 'ready' ? (
              <Button variant="outline" size="sm" onClick={() => commit(splitPhotoRow(rowsRef.current, row.id))}>
                Split into separate documents
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
          {tab === 'purchase-orders' ? (
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor={id('vendor')}>
                Vendor
              </label>
              <Select
                id={id('vendor')}
                disabled={!editable}
                value={text('vendorId')}
                {...aria('vendorId')}
                onChange={(event) => setField(row.id, 'vendorId', event.target.value)}
              >
                <option value="">Select a vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </Select>
              {errorText('vendorId')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor={id('po')}>
                Purchase order
              </label>
              <Select
                id={id('po')}
                disabled={!editable}
                value={text('purchaseOrderId')}
                {...aria('purchaseOrderId')}
                onChange={(event) => setField(row.id, 'purchaseOrderId', event.target.value)}
              >
                <option value="">Select a purchase order</option>
                {purchaseOrders.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.poNumber ? `${doc.poNumber} — ${doc.name}` : doc.name}
                  </option>
                ))}
              </Select>
              {errorText('purchaseOrderId')}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-[14px] font-medium" htmlFor={id('number')}>
              {tab === 'purchase-orders' ? 'PO number' : tab === 'invoices' ? 'Invoice number' : 'Goods receipt number'}
            </label>
            <Input
              id={id('number')}
              className="font-mono text-[14px]"
              disabled={!editable}
              maxLength={200}
              value={text(tab === 'purchase-orders' ? 'poNumber' : tab === 'invoices' ? 'invoiceNumber' : 'grnNumber')}
              placeholder={tab === 'purchase-orders' ? 'PO-2026-1180' : tab === 'invoices' ? 'INV-44120' : 'GRN-9001'}
              {...aria(numberField)}
              onChange={(event) =>
                setField(
                  row.id,
                  tab === 'purchase-orders' ? 'poNumber' : tab === 'invoices' ? 'invoiceNumber' : 'grnNumber',
                  event.target.value,
                )
              }
            />
            {errorText(numberField)}
          </div>

          {/* Goods receipts carry no currency: a receipt records what arrived, not what it cost. */}
          {tab !== 'goods-receipts' ? (
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor={id('currency')}>
                Currency
              </label>
              <Input
                id={id('currency')}
                className="font-mono text-[14px] tracking-[0.08em]"
                disabled={!editable}
                maxLength={3}
                value={text('currency')}
                placeholder="USD"
                {...aria('currency')}
                onChange={(event) => setField(row.id, 'currency', event.target.value.toUpperCase())}
              />
              {errorText('currency')}
            </div>
          ) : null}

          {/* S9. Optional. A contract price has an effective window, so checking
              the order against it needs the date the order was PLACED. */}
          {tab === 'purchase-orders' ? (
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium" htmlFor={id('ordered')}>
                Order date <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <Input
                id={id('ordered')}
                type="date"
                className="font-mono text-[14px]"
                disabled={!editable}
                value={text('orderedAt')}
                onChange={(event) => setField(row.id, 'orderedAt', event.target.value)}
              />
            </div>
          ) : null}
        </div>

        {row.status === 'error' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="min-w-0 flex-1 text-[13px] leading-[1.5] text-destructive-strong-text">
              {row.error}
            </p>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Retry ${name}`}
              disabled={isRunning || Object.keys(errors).length > 0}
              onClick={() => void run([row.id])}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  const deadEnd = missingVendors ? (
    // POLICY v1 #3: the vendor is mandatory, so with none the form cannot be
    // completed. Say so instead of letting the user submit into a 404.
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
  ) : missingPurchaseOrders ? (
    <EmptyState
      nested
      label="Needs a purchase order first"
      labelTone="amber"
      title="No purchase orders yet"
      description={
        tab === 'invoices'
          ? 'An invoice is always matched against the purchase order it answers, so upload that first.'
          : 'A goods receipt records what arrived against an order, so upload that purchase order first.'
      }
    />
  ) : null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      eyebrow="Upload · one batch"
      title={TITLE[tab]}
      footer={
        deadEnd ? undefined : (
          <>
            {needsFields ? (
              <p className="mr-auto text-[13px] text-ink-body">Fill in the highlighted fields to upload.</p>
            ) : null}
            <Button
              onClick={() => void run(readyRows.map((row) => row.id))}
              isLoading={isRunning}
              loadingText="Uploading"
              disabled={!canUpload}
            >
              Upload
            </Button>
          </>
        )
      }
    >
      {deadEnd ?? (
        <div className="flex flex-col gap-[18px]">
          {filesInput}
          {photosInput}
          <div data-testid="batch-live-status" role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
          {isRunning ? (
            <p className="sr-only">Uploading. Wait for the upload to finish before closing this dialog.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-[10px]">
            <Button variant="outline" size="sm" onClick={() => filesInputRef.current?.click()}>
              Add files
            </Button>
            <Button variant="outline" size="sm" onClick={() => photosInputRef.current?.click()}>
              Add photos
            </Button>
            {rows.length >= 2 ? (
              <Button variant="ghost" size="sm" onClick={() => commit(copyFromFirstRow(rowsRef.current))}>
                Copy from first row
              </Button>
            ) : null}
          </div>
          <p className="text-[13px] leading-[1.5] text-ink-muted">
            Each row is one document. Photos picked together become one document, one page per photo.
          </p>
          {pickError ? <StatusBanner variant="error" title={pickError} /> : null}
          {photoUploaded ? (
            <StatusBanner
              variant="success"
              title="Uploaded. Photo documents show Needs review once they are read — open Review to check the lines before comparing."
            />
          ) : null}
          {rows.length > 0 ? <div className="flex flex-col gap-[14px]">{rows.map(renderRow)}</div> : null}
        </div>
      )}
    </Modal>
  )
}
