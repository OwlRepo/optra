'use client'

import * as React from 'react'
import {
  Badge,
  Button,
  ConfidenceMeter,
  DefinitionRow,
  Eyebrow,
  MetricTile,
  MicroLabel,
  PhotoCompare,
  Skeleton,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@repo/ui'
import { Check } from 'lucide-react'
import { flagTypeLabel, flagTypeTone, formatDelta } from '@/components/procurement/flag-type'
import { prefersReducedMotion } from '@/hooks/use-in-view'
import {
  SAMPLE_DOCS,
  SAMPLE_DOC_LABEL,
  SAMPLE_FLAGS,
  SAMPLE_MATCHED_LINE,
  SAMPLE_PHOTO_MATCH,
  SAMPLE_VENDOR,
} from './sample-scenario'
import { TOUR_ANCHORS, tourAttr } from './tour-anchors'
import type { SampleSection } from './tour-steps'

export const SAMPLE_LABEL = 'Sample data — not your workspace'

// The scripted run mirrors the real compare: three beats, then the results.
const RUN_STEP_MS = 800
const RUN_TOTAL_MS = 2400
const VERIFY_TICKS = 12
const VERIFY_TICK_MS = 100

export interface SampleStageProps {
  section: SampleSection
  /** Defaults to prefers-reduced-motion, read in an effect. */
  reducedMotion?: boolean
  /** Results are visible. */
  onRunComplete: () => void
  /** The review detail is visible. */
  onFlagOpened: () => void
  /** The meter is full and the Match badge is showing. */
  onVerified: () => void
}

type RunPhase = 'idle' | 'running' | 'results'
type VerifyPhase = 'idle' | 'verifying' | 'done'

const TONE_INK = { red: 'text-destructive-strong-text', amber: 'text-flag-strong', neutral: 'text-ink-neutral' } as const

function RunStep({ step, label, active, done }: { step: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-[9px] font-mono text-[12px] transition-colors duration-200',
          active || done ? 'bg-primary-strong text-primary-strong-foreground' : 'bg-secondary text-ink-muted',
        )}
      >
        {done ? <Check className="size-3.5" aria-hidden="true" /> : step}
      </span>
      <span className={cn('truncate text-[13px]', active || done ? 'text-foreground' : 'text-ink-muted')}>{label}</span>
    </div>
  )
}

export function SampleStage({ section, reducedMotion, onRunComplete, onFlagOpened, onVerified }: SampleStageProps) {
  const [reduced, setReduced] = React.useState(reducedMotion ?? false)
  const [runPhase, setRunPhase] = React.useState<RunPhase>('idle')
  const [runStep, setRunStep] = React.useState(1)
  const [flagOpen, setFlagOpen] = React.useState(false)
  const [verifyPhase, setVerifyPhase] = React.useState<VerifyPhase>('idle')
  const [meter, setMeter] = React.useState(0)

  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([])
  const callbacks = React.useRef({ onRunComplete, onFlagOpened, onVerified })
  callbacks.current = { onRunComplete, onFlagOpened, onVerified }

  React.useEffect(() => {
    if (reducedMotion === undefined) setReduced(prefersReducedMotion())
    else setReduced(reducedMotion)
  }, [reducedMotion])

  React.useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    },
    [],
  )

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms))
  }

  const handleRun = () => {
    if (runPhase !== 'idle') return
    if (reduced) {
      setRunPhase('results')
      callbacks.current.onRunComplete()
      return
    }
    setRunPhase('running')
    setRunStep(1)
    later(() => setRunStep(2), RUN_STEP_MS)
    later(() => setRunStep(3), RUN_STEP_MS * 2)
    later(() => {
      setRunPhase('results')
      callbacks.current.onRunComplete()
    }, RUN_TOTAL_MS)
  }

  const handleOpenFlag = () => {
    setFlagOpen(true)
    callbacks.current.onFlagOpened()
  }

  const handleVerify = () => {
    if (verifyPhase !== 'idle') return
    const target = Math.round((SAMPLE_PHOTO_MATCH.verdict.score ?? 0) * 100)
    if (reduced) {
      setMeter(target)
      setVerifyPhase('done')
      callbacks.current.onVerified()
      return
    }
    setVerifyPhase('verifying')
    for (let tick = 1; tick <= VERIFY_TICKS; tick += 1) {
      later(() => setMeter(Math.round((target * tick) / VERIFY_TICKS)), tick * VERIFY_TICK_MS)
    }
    later(() => {
      setVerifyPhase('done')
      callbacks.current.onVerified()
    }, VERIFY_TICKS * VERIFY_TICK_MS)
  }

  const priceFlag = SAMPLE_FLAGS[0]
  const citations = [
    { label: 'PO line', value: `Purchase order ${SAMPLE_DOCS[0].number}, row ${priceFlag.poLine?.sourceRow}` },
    {
      label: 'Invoice',
      value: `${SAMPLE_DOCS[1].number} p.1, line ${priceFlag.invoiceLine?.lineNumber} · read from PDF, ${Math.round((priceFlag.invoiceLine?.extractionConfidence ?? 0) * 100)}% confidence`,
    },
    { label: 'Receipt', value: `${SAMPLE_DOCS[2].number} line ${priceFlag.receiptLine?.lineNumber}` },
  ]

  return (
    <div
      role="region"
      aria-label="Sample comparison"
      className="fixed inset-0 z-[55] overflow-y-auto bg-background text-foreground"
    >
      <div className="mx-auto w-full max-w-[960px] space-y-6 px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <Eyebrow rule>{section === 'compare' ? 'Compare' : 'Catalog match'}</Eyebrow>
            <h2 className="mt-3 text-[28px] leading-[1.08]">
              {section === 'compare' ? `${SAMPLE_DOCS[0].number} against its invoice and receipt` : 'Check the catalog photo'}
            </h2>
          </div>
          <Badge variant="amber">{SAMPLE_LABEL}</Badge>
        </header>

        {section === 'compare' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {SAMPLE_DOCS.map((doc) => (
                <div key={doc.number} className="rounded-[18px] border border-border-panel bg-card p-4">
                  <MicroLabel>{SAMPLE_DOC_LABEL[doc.kind]}</MicroLabel>
                  <p className="mt-2 font-mono text-[15px] font-medium">{doc.number}</p>
                  <p className="mt-1 text-[13px] text-ink-ghost">
                    {doc.vendor} · <span className="font-mono">{doc.lines}</span> lines
                  </p>
                  <Badge variant="teal" className="mt-3">
                    Ready
                  </Badge>
                </div>
              ))}
            </div>

            {runPhase !== 'results' ? (
              <div className="flex items-center justify-between gap-4 rounded-[18px] border border-border-panel bg-card p-4">
                <p className="text-[14px] text-ink-body">All three documents are read. Compare them line by line.</p>
                <Button
                  {...tourAttr(TOUR_ANCHORS.sampleRun)}
                  onClick={handleRun}
                  isLoading={runPhase === 'running'}
                  loadingText="Comparing…"
                >
                  Run comparison
                </Button>
              </div>
            ) : null}

            {runPhase === 'running' ? (
              <div className="overflow-hidden rounded-[18px] border border-border-panel bg-card">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-[18px] py-4">
                  <Badge variant="teal" pulse>
                    Comparing
                  </Badge>
                  <RunStep step={1} label="Read lines" active={runStep === 1} done={runStep > 1} />
                  <RunStep step={2} label="Match to catalog" active={runStep === 2} done={runStep > 2} />
                  <RunStep step={3} label="Check price and quantity" active={runStep === 3} done={false} />
                </div>
                <SkeletonRows rows={3} columns={4} />
              </div>
            ) : null}

            {runPhase === 'results' ? (
              <>
                <Table aria-label="Sample comparison results">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Finding</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead numeric>Ordered</TableHead>
                      <TableHead numeric>Billed</TableHead>
                      <TableHead numeric>Delta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SAMPLE_FLAGS.map((flag, index) => {
                      const tone = flagTypeTone[flag.flagType]
                      const isPrice = index === 0
                      return (
                        <TableRow key={flag.id} tone={tone}>
                          <TableCell>
                            <Badge variant={tone}>{flagTypeLabel[flag.flagType]}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-[13px]">
                            {isPrice ? (
                              <button
                                type="button"
                                aria-label="Review sample price flag"
                                {...tourAttr(TOUR_ANCHORS.sampleFlag)}
                                onClick={handleOpenFlag}
                                className="rounded-[6px] text-primary-strong underline decoration-primary-strong/40 underline-offset-4 hover:text-primary-strong-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
                              >
                                {flag.sku}
                              </button>
                            ) : (
                              flag.sku
                            )}
                          </TableCell>
                          <TableCell numeric>{flag.poValue}</TableCell>
                          <TableCell numeric>{flag.invoiceValue}</TableCell>
                          <TableCell numeric className={TONE_INK[tone]}>
                            {flag.delta ? formatDelta(flag.delta) : '—'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow tone="teal">
                      <TableCell>
                        <Badge variant="teal">Matched</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[13px]">{SAMPLE_MATCHED_LINE.sku}</TableCell>
                      <TableCell numeric>1000</TableCell>
                      <TableCell numeric>1000</TableCell>
                      <TableCell numeric className="text-primary-strong">
                        0
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                {flagOpen ? (
                  <div
                    {...tourAttr(TOUR_ANCHORS.sampleCitations)}
                    className="overflow-hidden rounded-[18px] border border-border-panel bg-card"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-inner px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Badge variant={flagTypeTone[priceFlag.flagType]}>{flagTypeLabel[priceFlag.flagType]}</Badge>
                        <span className="font-mono text-[14px] font-medium">{priceFlag.sku}</span>
                      </div>
                      <span className="text-[13px] text-ink-ghost">{SAMPLE_VENDOR}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 p-5">
                      <MetricTile label="Ordered" value={priceFlag.poValue} />
                      <MetricTile label="Received" value={priceFlag.receivedValue ?? '—'} />
                      <MetricTile label="Billed" value={priceFlag.invoiceValue} tone="red" />
                    </div>
                    <p className="px-5 pb-4 text-[14px] text-ink-body">
                      Billed <span className="font-mono text-destructive-strong-text">{formatDelta(priceFlag.delta ?? '0')}</span>{' '}
                      per unit above the agreed price. Every verdict has a citation:
                    </p>
                    <div className="mx-5 mb-5 overflow-hidden rounded-[12px] border border-border-definition">
                      {citations.map((row) => (
                        <DefinitionRow key={row.label} density="compact" label={row.label} value={row.value} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            {verifyPhase === 'done' ? (
              <div {...tourAttr(TOUR_ANCHORS.sampleMatch)}>
                <PhotoCompare
                  query={SAMPLE_PHOTO_MATCH.query}
                  candidate={SAMPLE_PHOTO_MATCH.candidate}
                  verdict={SAMPLE_PHOTO_MATCH.verdict}
                />
              </div>
            ) : (
              <div className="overflow-hidden rounded-[18px] border border-border-panel bg-card">
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  <div className="border-b border-border-inner px-6 py-[22px] sm:border-b-0 sm:border-r">
                    <MicroLabel>Requested</MicroLabel>
                    <p className="mt-[14px] font-mono text-[14px] font-medium">{SAMPLE_PHOTO_MATCH.query.sku}</p>
                    <p className="mt-[6px] text-[15px] leading-[1.6] text-ink-body">{SAMPLE_PHOTO_MATCH.query.description}</p>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-4 px-6 py-[22px]">
                    <Skeleton className="aspect-[4/3] w-full rounded-[12px]" />
                    <div className="min-w-0">
                      <MicroLabel>{SAMPLE_VENDOR}</MicroLabel>
                      <p className="mt-[10px] font-mono text-[14px] font-medium">{SAMPLE_PHOTO_MATCH.candidate.sku}</p>
                      <p className="mt-[6px] text-[15px] leading-[1.6] text-ink-body">
                        {SAMPLE_PHOTO_MATCH.candidate.description}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border-inner bg-surface-subtle px-6 py-4">
                  <p className="text-[14px] text-ink-body">Compare the catalog photo with the request.</p>
                  <Button
                    {...tourAttr(TOUR_ANCHORS.sampleVerify)}
                    onClick={handleVerify}
                    isLoading={verifyPhase === 'verifying'}
                    loadingText="Verifying…"
                  >
                    Verify match
                  </Button>
                </div>
                {verifyPhase === 'verifying' ? (
                  <div className="flex items-center gap-4 border-t border-border-inner px-6 py-4">
                    <Badge variant="teal" pulse>
                      Verifying
                    </Badge>
                    <ConfidenceMeter value={meter / 100} size="sm" className="min-w-0 flex-1" />
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
