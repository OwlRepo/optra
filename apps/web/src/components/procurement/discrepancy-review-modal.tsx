'use client'

import * as React from 'react'
import { Badge, Button, Modal, Select, Textarea, useToast } from '@repo/ui'
import {
  listComparisonRuns,
  listDiscrepancyDecisions,
  recordDiscrepancyDecision,
  type ComparisonRun,
  type DiscrepancyDecision,
  type DiscrepancyDecisionOutcome,
  type DiscrepancyFlag,
} from '@/lib/api/procurement'

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

/** Who decided. The email is joined; the role is what was recorded at the time. */
function actorOf(decision: DiscrepancyDecision) {
  return decision.actorEmail ? `${decision.actorEmail} (${decision.actorRole})` : decision.actorRole
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

  if (!flag) return null

  return (
    <Modal open={open} onClose={onClose} title="Review discrepancy" size="xl">
      <div className="space-y-6">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{flag.sku ?? 'Header-level finding'}</span>
            <Badge variant="secondary">{flag.status}</Badge>
          </div>
          {/* Ordered, received, billed — the order the documents arrive in. */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Ordered</div>
              <div className="tabular-nums">{flag.poValue ?? '—'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Received</div>
              <div className="tabular-nums">{flag.receivedValue ?? '—'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Billed</div>
              <div className="tabular-nums">{flag.invoiceValue ?? '—'}</div>
            </div>
          </div>
          {/* S9. Shown for the exceptions that outrank price in the engine's
              ladder, where the unit price would otherwise go unmentioned. Not
              repeated on a price flag — the grid above already is the prices. */}
          {flag.flagType !== 'price_mismatch' && (flag.poUnitPrice !== null || flag.invoiceUnitPrice !== null) ? (
            <div className="text-sm">
              <span className="text-muted-foreground">Unit price</span>{' '}
              <span className="tabular-nums">
                PO {flag.poUnitPrice ?? '—'} · Invoice {flag.invoiceUnitPrice ?? '—'}
              </span>
            </div>
          ) : null}
          <p className="text-sm">{flag.reason}</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Comparison runs</h3>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs recorded for this pair.</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={run.status === 'failed' ? 'destructive' : 'secondary'}>
                    {run.mode === 'three_way' ? 'Three-way' : 'Two-way'}
                  </Badge>
                  <span className="text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()} · {run.flagCount ?? 0} flags ·{' '}
                    {run.initiatedByEmail ?? 'automatic'}
                  </span>
                  {run.lastError ? <span className="text-destructive">{run.lastError}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Decision history</h3>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {decisions.map((decision) => (
                <li key={decision.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary">{OUTCOME_LABEL[decision.outcome]}</Badge>
                    <span className="text-muted-foreground">
                      {actorOf(decision)} · {new Date(decision.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm">{decision.note}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canManage ? (
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Record a decision</h3>
            <label className="block space-y-1">
              <span className="text-sm">Outcome</span>
              <Select
                aria-label="Outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as DiscrepancyDecisionOutcome)}
              >
                {OUTCOMES.map((value) => (
                  <option key={value} value={value}>
                    {OUTCOME_LABEL[value]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm">Decision note</span>
              <Textarea
                aria-label="Decision note"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why this call, in a sentence."
              />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {/* Required by POLICY v1 #7 and by the API. Disabled rather than
                  letting the reviewer discover it from a 400. */}
              <Button onClick={() => void handleSubmit()} disabled={note.trim() === ''} isLoading={isSaving}>
                Record decision
              </Button>
            </div>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only an owner or admin can record a decision on this discrepancy.
          </p>
        )}
      </div>
    </Modal>
  )
}
