'use client'

import * as React from 'react'
import {
  Badge,
  Button,
  DefinitionRow,
  Eyebrow,
  MetricTile,
  MicroLabel,
  Modal,
  Textarea,
  cn,
  useToast,
} from '@repo/ui'
import { Download } from 'lucide-react'
import { formatDateTime } from '@/lib/format-date'
import {
  downloadProcurementDocument,
  listComparisonRuns,
  listDiscrepancyDecisions,
  recordDiscrepancyDecision,
  type ComparisonRun,
  type DiscrepancyDecision,
  type DiscrepancyDecisionOutcome,
  type DiscrepancyFlag,
  type DiscrepancyFlagType,
  type DiscrepancyLineCitation,
  type ProcurementDocKind,
} from '@/lib/api/procurement'
import { flagTypeLabel, flagTypeTone } from './flag-type'

// POLICY v1 #7's four outcomes. "Dismissed" alone lost the distinction between
// a false positive, an approved exception, a vendor's mistake and unresolved
// risk — which is exactly the distinction a financial control exists to keep.
const OUTCOME_LABEL: Record<DiscrepancyDecisionOutcome, string> = {
  false_positive: 'False positive',
  approved_exception: 'Approved exception',
  vendor_dispute: 'Vendor dispute',
  resolved: 'Resolved',
}

const OUTCOMES = Object.keys(OUTCOME_LABEL) as DiscrepancyDecisionOutcome[]

type MetricKey = 'ordered' | 'received' | 'billed'

// Which of ordered / received / billed the finding is about, so that tile is
// the one that "breaks" and takes the finding's tone (frame 2.9, C20, C-3 #7).
// Null for the neutral types: a missing line, or documents not comparable as
// they stand, has no single wrong number to tint (frame 2.10).
const BREAKING_TILE: Record<DiscrepancyFlagType, MetricKey | null> = {
  quantity_mismatch: 'billed',
  price_mismatch: 'billed',
  missing_on_invoice: null,
  missing_on_po: null,
  short_receipt: 'received',
  invoice_exceeds_received: 'billed',
  uom_mismatch: null,
  currency_mismatch: null,
  contract_price_variance: 'ordered',
  contract_price_unavailable: null,
}

export interface DiscrepancyReviewModalProps {
  open: boolean
  onClose: () => void
  /** Called once a decision lands, so the caller can refetch its page. */
  onDecided: () => void
  workspaceId: string
  canManage: boolean
  flag: DiscrepancyFlag | null
}

function extractErrorMessage(err: unknown, fallback: string) {
  return err && typeof err === 'object' && 'message' in err
    ? String((err as { message: unknown }).message)
    : fallback
}

const SOURCE_SIDES = [
  { key: 'poLine', label: 'PO', kind: 'purchase-orders' },
  { key: 'invoiceLine', label: 'Invoice', kind: 'invoices' },
  { key: 'receiptLine', label: 'Receipt', kind: 'goods-receipts' },
] as const satisfies ReadonlyArray<{
  key: 'poLine' | 'invoiceLine' | 'receiptLine'
  label: string
  kind: ProcurementDocKind
}>

/** One honest line per citation. There is no page number to quote, by design. */
function citationText(label: string, c: DiscrepancyLineCitation) {
  if (c.sourceRow !== null) {
    return c.sourceSheet
      ? `${label} sheet ${c.sourceSheet}, row ${c.sourceRow}`
      : `${label} row ${c.sourceRow}`
  }
  const line = `${label} line ${c.lineNumber ?? '—'}`
  return c.extractionConfidence !== null
    ? `${line} · read from PDF, ${Math.round(c.extractionConfidence * 100)}% confidence`
    : line
}

/** Who decided. The email is joined; the role is what was recorded at the time. */
function actorOf(decision: DiscrepancyDecision) {
  return decision.actorEmail ? `${decision.actorEmail} (${decision.actorRole})` : decision.actorRole
}

/** A missing number reads as a muted dash rather than an empty tile (frame 2.10). */
function metricValue(value: string | null): React.ReactNode {
  return value ?? <span className="text-[oklch(0.6_0.02_264)]">—</span>
}

export function DiscrepancyReviewModal({
  open,
  onClose,
  onDecided,
  workspaceId,
  canManage,
  flag,
}: DiscrepancyReviewModalProps) {
  const { toast } = useToast()
  const radioName = React.useId()
  const [decisions, setDecisions] = React.useState<DiscrepancyDecision[]>([])
  const [runs, setRuns] = React.useState<ComparisonRun[]>([])
  const [outcome, setOutcome] = React.useState<DiscrepancyDecisionOutcome>('false_positive')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  const flagId = flag?.id ?? null
  const purchaseOrderId = flag?.purchaseOrderId ?? null
  const invoiceId = flag?.invoiceId ?? null

  const load = React.useCallback(async () => {
    if (!flagId || !purchaseOrderId || !invoiceId) return
    try {
      const [history, runHistory] = await Promise.all([
        listDiscrepancyDecisions(workspaceId, flagId),
        // Five is a glance, not a log — enough to answer "what did the last
        // comparison say?" without turning this into a history page.
        listComparisonRuns(workspaceId, { purchaseOrderId, invoiceId, pageSize: 5 }),
      ])
      setDecisions(Array.isArray(history) ? history : [])
      setRuns(Array.isArray(runHistory?.items) ? runHistory.items : [])
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load this discrepancy’s history.'))
    }
  }, [flagId, invoiceId, purchaseOrderId, workspaceId])

  React.useEffect(() => {
    if (!open) return
    setNote('')
    setError(null)
    setOutcome('false_positive')
    void load()
  }, [load, open])

  const handleSubmit = React.useCallback(async () => {
    if (!flagId || note.trim() === '') return
    try {
      setIsSaving(true)
      setError(null)
      await recordDiscrepancyDecision(workspaceId, flagId, { outcome, note })
      toast({ variant: 'success', title: 'Decision recorded', description: OUTCOME_LABEL[outcome] })
      onDecided()
      onClose()
    } catch (err) {
      // The server's own wording, not a generic failure: it is the only thing
      // that knows why a note was refused.
      setError(extractErrorMessage(err, 'Could not record the decision.'))
    } finally {
      setIsSaving(false)
    }
  }, [flagId, note, onClose, onDecided, outcome, toast, workspaceId])

  const handleDownload = React.useCallback(
    async (kind: ProcurementDocKind, documentId: string) => {
      try {
        await downloadProcurementDocument(workspaceId, kind, documentId)
      } catch (err) {
        toast({
          variant: 'error',
          title: 'Failed to download document',
          description: extractErrorMessage(err, 'Try again in a moment.'),
        })
      }
    },
    [toast, workspaceId],
  )

  if (!flag) return null

  const sources = SOURCE_SIDES.flatMap((side) => {
    const citation = flag[side.key]
    return citation ? [{ ...side, citation }] : []
  })
  const breaking = BREAKING_TILE[flag.flagType]
  const findingTone = flagTypeTone[flag.flagType]
  const breakingTone = findingTone === 'neutral' ? undefined : findingTone
  const toneFor = (key: MetricKey) => (breaking === key ? breakingTone : undefined)
  // S9. Shown for the exceptions that outrank price in the engine's ladder,
  // where the unit price would otherwise go unmentioned. Not repeated on a
  // price flag — the tiles already are the prices.
  const showUnitPrice =
    flag.flagType !== 'price_mismatch' && (flag.poUnitPrice !== null || flag.invoiceUnitPrice !== null)
  // S9. The agreed price, when the finding is about one. Shown beside what was
  // ordered, because the pair is the whole finding.
  const showAgreedPrice = flag.contractUnitPrice !== null
  const showDelta = flag.delta !== null

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      eyebrow="Review discrepancy"
      title={flag.sku ?? 'Header-level finding'}
      // A SKU is data, so Mono 22/500 (frame 2.9); "Header-level finding" is
      // prose and keeps the Outfit title (frame 2.10).
      titleClassName={flag.sku ? 'font-mono text-[22px] font-medium tracking-[-0.01em]' : undefined}
      aria-label="Review discrepancy"
      // The two columns and the decision form carry their own padding.
      bodyClassName="p-0"
      headerAccessory={
        <>
          <Badge variant={flagTypeTone[flag.flagType]}>{flagTypeLabel[flag.flagType]}</Badge>
          <Badge variant="neutral">{flag.status === 'open' ? 'Open' : 'Dismissed'}</Badge>
        </>
      }
      footer={
        canManage ? (
          <div className="flex justify-end gap-[10px]">
            <Button variant="ghost" className="px-[14px]" onClick={onClose}>
              Cancel
            </Button>
            {/* Required by POLICY v1 #7 and by the API. Disabled rather than
                letting the reviewer discover it from a 400. */}
            <Button onClick={() => void handleSubmit()} disabled={note.trim() === ''} isLoading={isSaving}>
              Record decision
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-between gap-4">
            <span className="inline-flex items-center gap-[10px] text-[14px] text-ink-body">
              <MicroLabel
                as="span"
                tone="neutral"
                className="rounded-[7px] border border-border-panel bg-card px-2 py-1"
              >
                Read-only
              </MicroLabel>
              Only an owner or admin can record a decision on this discrepancy.
            </span>
            {/* Frame 2.10: before this, a member's only exit was Esc or the
                backdrop. */}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )
      }
    >
      <div>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <section className="flex flex-col gap-5 border-b border-border-inner px-7 py-6 md:border-b-0 md:border-r">
            {/* Ordered, received, billed — the order the documents arrive in. */}
            <div className="grid grid-cols-3 gap-[10px]">
              <MetricTile label="Ordered" value={metricValue(flag.poValue)} tone={toneFor('ordered')} />
              <MetricTile label="Received" value={metricValue(flag.receivedValue)} tone={toneFor('received')} />
              <MetricTile label="Billed" value={metricValue(flag.invoiceValue)} tone={toneFor('billed')} />
            </div>
            {showUnitPrice || showAgreedPrice || showDelta ? (
              <div className="flex flex-col gap-2 border-t border-border-inner pt-[14px] font-mono text-[12px]">
                {showUnitPrice ? (
                  <span className="flex justify-between gap-4 text-[oklch(0.5_0.02_264)]">
                    unit price
                    <span className="text-[oklch(0.3_0.02_264)]">
                      PO {flag.poUnitPrice ?? '—'} · Invoice {flag.invoiceUnitPrice ?? '—'}
                    </span>
                  </span>
                ) : null}
                {showAgreedPrice ? (
                  <span className="flex justify-between gap-4 text-[oklch(0.5_0.02_264)]">
                    agreed price
                    <span className="text-[oklch(0.3_0.02_264)]">
                      {flag.contractUnitPrice} · ordered at {flag.poUnitPrice ?? '—'}
                    </span>
                  </span>
                ) : null}
                {showDelta ? (
                  <span className="flex justify-between gap-4 text-flag-text">
                    delta
                    <span>{flag.delta}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
            <p className="text-[15px] leading-[1.65] text-[oklch(0.3_0.02_264)]">{flag.reason}</p>
            {sources.length > 0 ? (
              <div>
                <MicroLabel className="mb-[10px]">Source</MicroLabel>
                <div className="overflow-hidden rounded-[14px] border border-border-panel">
                  {sources.map(({ key, label, kind, citation }) => (
                    <DefinitionRow
                      key={key}
                      label={label}
                      value={citationText(label, citation)}
                      action={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="mr-2 size-8 rounded-[9px] [&_svg]:size-[15px]"
                          aria-label={`Download ${label}`}
                          onClick={() => void handleDownload(kind, citation.documentId)}
                        >
                          <Download aria-hidden="true" />
                        </Button>
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-[22px] bg-background px-7 py-6">
            <div>
              <MicroLabel className="mb-[10px]">Comparison runs · last 5</MicroLabel>
              {runs.length === 0 ? (
                <p className="text-[14px] text-ink-muted">No runs recorded for this pair.</p>
              ) : (
                // Frame 2.9 run rows (C-3 #10: page-local, not HistoryRow):
                // 2px rule red when failed, teal for the latest, else neutral.
                <div className="flex flex-col gap-[6px]">
                  {runs.map((run, index) => {
                    const failed = run.status === 'failed'
                    return (
                      <div
                        key={run.id}
                        className={cn(
                          'flex flex-wrap items-center gap-x-[10px] gap-y-2 border-l-2 px-3 py-2',
                          failed ? 'border-destructive-tone' : index === 0 ? 'border-primary-strong' : 'border-border-dashed',
                        )}
                      >
                        <span
                          className={cn(
                            'rounded-[7px] border px-[7px] py-[3px] font-mono text-[10px] uppercase leading-[normal] tracking-[0.1em]',
                            failed
                              ? 'border-destructive-tone/35 bg-destructive-tone/8 text-destructive-strong-text'
                              : 'border-border-panel bg-card text-ink-neutral',
                          )}
                        >
                          {run.mode === 'three_way' ? 'Three-way' : 'Two-way'}
                        </span>
                        <span className="font-mono text-[11px] text-ink-body">
                          {`${formatDateTime(run.createdAt)} · ${run.flagCount ?? 0} flags · ${run.initiatedByEmail ?? 'automatic'}`}
                        </span>
                        {run.lastError ? (
                          <span className="basis-full text-[12px] text-destructive-strong-text">{run.lastError}</span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div>
              <MicroLabel className="mb-[10px]">Decision history</MicroLabel>
              {decisions.length === 0 ? (
                <p className="text-[14px] text-ink-muted">No decisions recorded yet.</p>
              ) : (
                <div className="flex flex-col gap-[6px]">
                  {decisions.map((decision, index) => {
                    // Oldest first, so the latest call is the last row and
                    // takes the teal rule + tinted fill (frame 2.9).
                    const latest = index === decisions.length - 1
                    return (
                      <div
                        key={decision.id}
                        className={cn(
                          'border-l-2 px-3 py-2',
                          latest
                            ? 'rounded-r-[10px] border-primary-strong bg-primary-strong/7'
                            : 'border-border-dashed',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border-panel bg-card px-[9px] py-[2px] text-[12px] font-semibold leading-[normal] text-ink-neutral">
                            {OUTCOME_LABEL[decision.outcome]}
                          </span>
                          <span className="font-mono text-[11px] text-ink-body">
                            {`${actorOf(decision)} · ${formatDateTime(decision.createdAt)}`}
                          </span>
                        </div>
                        <p className="mt-[6px] text-[14px] leading-[1.55]">{decision.note}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        {canManage ? (
          <section className="flex flex-col gap-4 border-t border-border-inner px-7 py-[22px]">
            <Eyebrow>Record a decision</Eyebrow>
            {/* Frame 2.9: the same four values and the same default as the
                old <select>, as cards so all four are visible at once. */}
            <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-2 gap-[10px] md:grid-cols-4">
              {OUTCOMES.map((value) => {
                const checked = outcome === value
                return (
                  <label
                    key={value}
                    className={cn(
                      'relative flex cursor-pointer items-center gap-[10px] rounded-[12px] border px-[14px] py-3 text-[14px] font-medium transition-colors duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-strong',
                      checked ? 'border-primary-strong bg-primary-strong/6' : 'border-border-panel bg-card',
                    )}
                  >
                    <input
                      type="radio"
                      name={radioName}
                      value={value}
                      checked={checked}
                      onChange={() => setOutcome(value)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-4 shrink-0 rounded-full bg-card',
                        checked ? 'border-[5px] border-primary-strong' : 'border-[1.5px] border-[oklch(0.8_0.012_255)]',
                      )}
                    />
                    {OUTCOME_LABEL[value]}
                  </label>
                )
              })}
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-[14px] font-medium">
                Decision note <span className="font-normal text-ink-muted">(required)</span>
              </span>
              <Textarea
                aria-label="Decision note"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why this call, in a sentence."
                className="min-h-[84px] text-[15px] leading-[1.6]"
              />
            </label>
            {error ? <p className="text-[13px] text-destructive-strong-text">{error}</p> : null}
          </section>
        ) : null}
      </div>
    </Modal>
  )
}
