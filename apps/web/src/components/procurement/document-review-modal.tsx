'use client'

import * as React from 'react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  SkeletonRows,
  StatusBanner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  useToast,
} from '@repo/ui'
import { Plus, Trash2 } from 'lucide-react'
import {
  documentPageUrl,
  listDocumentLines,
  reviewDocument,
  type DetectedProcurementKind,
  type ProcurementDocKind,
  type ProcurementReviewDocument,
  type ProcurementReviewLine,
  type ReviewLineInput,
} from '@/lib/api/procurement'

// Photo intake: the AI read a paper document, a person confirms what it read
// before the document can be compared. The page image sits beside the lines so
// every value can be checked against the paper.

const PAGE_SIZE = 100
// Below this the model said it was unsure; the row is tinted and labelled.
const LOW_CONFIDENCE = 0.6

type Draft = {
  key: string
  // Absent on a line added during review.
  id?: string
  sku: string
  description: string
  quantity: string
  unitPrice: string
  lineTotal: string
  uom: string
  quantityReceived: string
  quantityAccepted: string
  quantityRejected: string
  confidence: number | null
}

type Field = keyof Omit<Draft, 'key' | 'id' | 'confidence'>

const PRICED_FIELDS: Array<{ field: Field; label: string; numeric: boolean }> = [
  { field: 'sku', label: 'SKU', numeric: false },
  { field: 'description', label: 'Description', numeric: false },
  { field: 'quantity', label: 'Quantity', numeric: true },
  { field: 'unitPrice', label: 'Unit price', numeric: true },
  { field: 'lineTotal', label: 'Line total', numeric: true },
  { field: 'uom', label: 'UOM', numeric: false },
]

const RECEIPT_FIELDS: Array<{ field: Field; label: string; numeric: boolean }> = [
  { field: 'sku', label: 'SKU', numeric: false },
  { field: 'description', label: 'Description', numeric: false },
  { field: 'uom', label: 'UOM', numeric: false },
  { field: 'quantityReceived', label: 'Received', numeric: true },
  { field: 'quantityAccepted', label: 'Accepted', numeric: true },
  { field: 'quantityRejected', label: 'Rejected', numeric: true },
]

const KIND_OF_DETECTED: Record<Exclude<DetectedProcurementKind, 'unknown'>, ProcurementDocKind> = {
  purchase_order: 'purchase-orders',
  invoice: 'invoices',
  goods_receipt: 'goods-receipts',
}

const DETECTED_LABEL: Record<Exclude<DetectedProcurementKind, 'unknown'>, string> = {
  purchase_order: 'a purchase order',
  invoice: 'an invoice',
  goods_receipt: 'a goods receipt',
}

const KIND_LABEL: Record<ProcurementDocKind, string> = {
  'purchase-orders': 'purchase order',
  invoices: 'invoice',
  'goods-receipts': 'goods receipt',
}

function toDraft(line: ProcurementReviewLine): Draft {
  return {
    key: line.id,
    id: line.id,
    sku: line.sku ?? '',
    description: line.description ?? '',
    quantity: line.quantity ?? '',
    unitPrice: line.unitPrice ?? '',
    lineTotal: line.lineTotal ?? '',
    uom: line.uom ?? '',
    quantityReceived: line.quantityReceived ?? '',
    quantityAccepted: line.quantityAccepted ?? '',
    quantityRejected: line.quantityRejected ?? '',
    confidence: line.extractionConfidence,
  }
}

function blankDraft(): Draft {
  return {
    key: globalThis.crypto.randomUUID(),
    sku: '',
    description: '',
    quantity: '',
    unitPrice: '',
    lineTotal: '',
    uom: '',
    quantityReceived: '',
    quantityAccepted: '',
    quantityRejected: '',
    confidence: null,
  }
}

function text(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function toInput(draft: Draft, kind: ProcurementDocKind): ReviewLineInput {
  const shared = {
    // A new line carries no `id` key at all: the API reads its presence as "existing".
    ...(draft.id ? { id: draft.id } : {}),
    sku: text(draft.sku),
    description: text(draft.description),
    uom: text(draft.uom),
  }
  if (kind === 'goods-receipts') {
    return {
      ...shared,
      quantityReceived: text(draft.quantityReceived),
      quantityAccepted: text(draft.quantityAccepted),
      quantityRejected: text(draft.quantityRejected),
    }
  }
  return {
    ...shared,
    quantity: text(draft.quantity),
    unitPrice: text(draft.unitPrice),
    lineTotal: text(draft.lineTotal),
  }
}

function messageOf(err: unknown, fallback: string): string {
  return err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback
}

export function DocumentReviewModal({
  open,
  onClose,
  workspaceId,
  kind,
  docId,
  canEdit,
  onReviewed,
  returnFocusRef,
}: {
  open: boolean
  onClose: () => void
  workspaceId: string
  kind: ProcurementDocKind
  docId: string
  canEdit: boolean
  onReviewed: () => void
  /** Where focus goes when the modal closes; defaults to whatever opened it. */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}) {
  const { toast } = useToast()
  const toastRef = React.useRef(toast)
  const [document_, setDocument] = React.useState<ProcurementReviewDocument | null>(null)
  const [lines, setLines] = React.useState<Draft[] | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [pageNumber, setPageNumber] = React.useState(1)
  const [imageFailed, setImageFailed] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  // Bumped by "Try again" to re-run the load effect.
  const [loadAttempt, setLoadAttempt] = React.useState(0)

  React.useEffect(() => {
    toastRef.current = toast
  }, [toast])

  // The document is at most 200 lines, so at most two calls at 100 a page.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setDocument(null)
    setLines(null)
    setPageNumber(1)
    setImageFailed(false)
    setLoadError(null)
    setSaveError(null)

    void (async () => {
      try {
        const first = await listDocumentLines(workspaceId, kind, docId, { page: 1, pageSize: PAGE_SIZE })
        const items = [...first.items]
        for (let page = 2; page <= first.totalPages; page += 1) {
          const next = await listDocumentLines(workspaceId, kind, docId, { page, pageSize: PAGE_SIZE })
          items.push(...next.items)
        }
        if (cancelled) return
        setDocument(first.document)
        setLines(items.map(toDraft))
      } catch (err) {
        if (cancelled) return
        // An in-modal banner, not a toast: the toast fades and left a skeleton forever.
        setLoadError(messageOf(err, 'Try again in a moment.'))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, workspaceId, kind, docId, loadAttempt])

  const isPhoto = document_?.sourceKind === 'image'
  const isReceipt = kind === 'goods-receipts'
  const columns = isReceipt ? RECEIPT_FIELDS : PRICED_FIELDS
  const readOnly = !canEdit || document_?.reviewedAt != null
  const pageCount = Math.max(1, document_?.pageCount ?? 1)

  const detected = document_?.detectedKind
  const mismatch =
    detected && detected !== 'unknown' && KIND_OF_DETECTED[detected] !== kind ? detected : null

  const update = (key: string, field: Field, value: string) =>
    setLines((current) => current?.map((line) => (line.key === key ? { ...line, [field]: value } : line)) ?? null)

  const remove = (key: string) => setLines((current) => current?.filter((line) => line.key !== key) ?? null)

  const add = () => setLines((current) => [...(current ?? []), blankDraft()])

  const confirm = async () => {
    if (!lines || lines.length === 0) return
    setIsSaving(true)
    setSaveError(null)
    try {
      await reviewDocument(workspaceId, kind, docId, { lines: lines.map((line) => toInput(line, kind)) })
      toastRef.current({
        variant: 'success',
        title: `${document_?.name ?? 'Document'} reviewed`,
        description: 'It can now be compared.',
      })
      onReviewed()
    } catch (err) {
      // Edits stay in state: a failed save must never cost the reviewer's work.
      setSaveError(messageOf(err, 'Try again in a moment.'))
      toastRef.current({
        variant: 'error',
        title: 'Could not save the review',
        description: messageOf(err, 'Try again in a moment.'),
      })
    } finally {
      setIsSaving(false)
    }
  }

  const footer =
    lines && !readOnly ? (
      <Button onClick={() => void confirm()} isLoading={isSaving} loadingText="Saving" disabled={lines.length === 0}>
        Confirm
      </Button>
    ) : undefined

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      eyebrow="Review · check what was read"
      title={document_?.name ?? 'Review document'}
      aria-label="Review document"
      bodyClassName="p-0"
      footer={footer}
      returnFocusRef={returnFocusRef}
    >
      {loadError !== null ? (
        <div className="p-[26px]">
          <StatusBanner
            variant="error"
            title="Could not load the document"
            description={loadError}
            action={
              <Button variant="outline" size="sm" onClick={() => setLoadAttempt((n) => n + 1)}>
                Try again
              </Button>
            }
          />
        </div>
      ) : lines === null ? (
        <div aria-busy="true" className="flex flex-col gap-4 p-[26px]">
          <p className="text-[14px] text-ink-body">Loading the page and lines…</p>
          <SkeletonRows rows={5} columns={4} />
        </div>
      ) : (
        <div
          className={
            isPhoto
              ? 'grid grid-cols-1 gap-6 p-[26px] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'
              : 'grid grid-cols-1 gap-6 p-[26px]'
          }
        >
          {isPhoto ? (
            <section aria-label="Page image" className="flex flex-col gap-3">
              {pageCount > 1 ? (
                <Tabs
                  aria-label="Pages"
                  idPrefix="review-page"
                  items={Array.from({ length: pageCount }, (_, i) => ({ id: String(i + 1), label: `Page ${i + 1}` }))}
                  value={String(pageNumber)}
                  onValueChange={(id) => {
                    setPageNumber(Number(id))
                    setImageFailed(false)
                  }}
                />
              ) : null}
              {/* A tabpanel only when there are page tabs for it to belong to. */}
              <div
                {...(pageCount > 1
                  ? {
                      role: 'tabpanel',
                      id: `review-page-panel-${pageNumber}`,
                      'aria-labelledby': `review-page-tab-${pageNumber}`,
                    }
                  : {})}
              >
              {imageFailed ? (
                <p className="rounded-[12px] border border-border-panel bg-surface-subtle p-4 text-[14px] text-ink-body">
                  This page image could not be loaded.
                </p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- served by the BFF with the bearer; next/image cannot proxy that
                <img
                  src={documentPageUrl(workspaceId, kind, docId, pageNumber)}
                  alt={`Page ${pageNumber} of ${pageCount}, photo of ${document_?.name ?? 'the document'}`}
                  className="w-full rounded-[12px] border border-border-panel bg-card"
                  onError={() => setImageFailed(true)}
                />
              )}
              </div>
            </section>
          ) : null}

          <section aria-label="Lines read" className="flex min-w-0 flex-col gap-4">
            {saveError ? (
              <StatusBanner variant="error" title="Could not save the review" description={saveError} />
            ) : null}
            {mismatch ? (
              <StatusBanner
                variant="warning"
                title={`This looks like ${DETECTED_LABEL[mismatch]}, not a ${KIND_LABEL[kind]}`}
                description="Check the page before confirming. If it is the wrong kind, close this and upload it under the right tab."
              />
            ) : null}
            {document_?.reviewedAt ? (
              <StatusBanner variant="success" title="Already reviewed" description="These lines are confirmed and can no longer be edited." />
            ) : null}

            {lines.length === 0 ? (
              <EmptyState
                nested
                label="Nothing read"
                labelTone="amber"
                title="No lines were read — add them or re-upload"
                description="Type the lines in from the page image, or close this and upload a clearer photo."
              />
            ) : (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[64px]">#</TableHead>
                    {columns.map(({ field, label, numeric }) => (
                      <TableHead key={field} numeric={numeric}>
                        {label}
                      </TableHead>
                    ))}
                    {!readOnly ? (
                      <TableHead className="w-[56px]">
                        <span className="sr-only">Remove</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => {
                    const n = index + 1
                    const low = line.confidence !== null && line.confidence < LOW_CONFIDENCE
                    return (
                      <TableRow
                        key={line.key}
                        tone={low ? 'amber' : undefined}
                        className={low ? 'bg-flag/6' : undefined}
                        data-low-confidence={low ? 'true' : undefined}
                      >
                        <TableCell className="font-mono text-[13px]">
                          {n}
                          {low ? (
                            <>
                              <Badge variant="amber" className="mt-1">
                                Check
                              </Badge>
                              <span id={`${line.key}-low-confidence`} className="sr-only">
                                Low confidence — check against the page
                              </span>
                            </>
                          ) : null}
                        </TableCell>
                        {columns.map(({ field, label, numeric }) => (
                          <TableCell key={field}>
                            <Input
                              aria-label={`${label} line ${n}`}
                              aria-describedby={low ? `${line.key}-low-confidence` : undefined}
                              value={line[field]}
                              readOnly={readOnly}
                              inputMode={numeric ? 'decimal' : undefined}
                              className={numeric ? 'h-9 px-2 text-right font-mono text-[13px]' : 'h-9 px-2 text-[13px]'}
                              onChange={(event) => update(line.key, field, event.target.value)}
                            />
                          </TableCell>
                        ))}
                        {!readOnly ? (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove line ${n}`}
                              onClick={() => remove(line.key)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}

            {!readOnly ? (
              <div>
                <Button variant="outline" size="sm" onClick={add}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add line
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </Modal>
  )
}
