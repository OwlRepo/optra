'use client'

import { useEffect, useState } from 'react'
import {
  DEMO_CATALOG_PHOTO,
  DEMO_DOCS,
  DEMO_DWELL_MS,
  DEMO_SCANNING,
  DEMO_SCAN_MS,
  type DemoLineKind,
} from '@/lib/landing-demo-docs'
import { prefersReducedMotion, useInView } from '@/hooks/use-in-view'

type Phase = 'scanning' | 'verdict'

// Tone -> token mapping. Kept as whole class strings rather than interpolated
// fragments so Tailwind's scanner can see every class it needs to generate.
const TONE = {
  ok: {
    bg: 'bg-primary-strong',
    border: 'border-primary-strong',
    ring: 'shadow-[inset_3px_0_0_var(--primary-strong)]',
    pill: 'border-primary-strong/30 text-primary-strong',
  },
  warn: {
    bg: 'bg-flag',
    border: 'border-flag',
    ring: 'shadow-[inset_3px_0_0_var(--flag)]',
    pill: 'border-flag/40 text-flag-text',
  },
  bad: {
    bg: 'bg-destructive',
    border: 'border-destructive',
    ring: 'shadow-[inset_3px_0_0_var(--destructive)]',
    pill: 'border-destructive/30 text-destructive',
  },
} satisfies Record<DemoLineKind, Record<string, string>>

export function HeroMatchDemo() {
  // Opens mid-document on the flagged line, already resolved -- the first thing
  // a visitor sees is a verdict, not an empty scan.
  const [doc, setDoc] = useState(0)
  const [line, setLine] = useState(1)
  const [phase, setPhase] = useState<Phase>('verdict')
  const [reduced, setReduced] = useState(false)
  const { ref, inView } = useInView<HTMLDivElement>()

  useEffect(() => {
    setReduced(prefersReducedMotion())
  }, [])

  const activeDoc = DEMO_DOCS[doc]
  // Switching from the 4-line document to the 3-line one can leave `line` past
  // the end for one render -- clamp rather than crash.
  const lineIndex = Math.min(line, activeDoc.lines.length - 1)
  const active = activeDoc.lines[lineIndex]
  const scanning = phase === 'scanning'
  const autoplay = inView && !reduced

  // One timer, re-armed by the (doc, line, phase) it belongs to. A scanning
  // phase always resolves itself -- even with autoplay off, so a click still
  // produces a verdict -- while only the verdict -> next-line step is gated on
  // autoplay. Re-running on every dep change is what makes this safe under
  // StrictMode's double-invoked effects.
  useEffect(() => {
    if (scanning) {
      const timer = setTimeout(() => setPhase('verdict'), reduced ? 0 : DEMO_SCAN_MS)
      return () => clearTimeout(timer)
    }
    if (!autoplay) return

    const timer = setTimeout(() => {
      const isLast = lineIndex >= activeDoc.lines.length - 1
      if (isLast) {
        setDoc((d) => (d + 1) % DEMO_DOCS.length)
        setLine(0)
      } else {
        setLine(lineIndex + 1)
      }
      setPhase('scanning')
    }, DEMO_DWELL_MS)
    return () => clearTimeout(timer)
  }, [doc, lineIndex, scanning, autoplay, reduced, activeDoc.lines.length])

  function pick(nextLine: number, nextDoc?: number) {
    if (nextDoc !== undefined) setDoc(nextDoc)
    setLine(nextLine)
    setPhase('scanning')
  }

  const tone = TONE[active.kind]
  const statusLabel = scanning ? 'matching…' : `${active.no} · ${active.tag.toLowerCase()}`

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_24px_60px_oklch(0.238_0.03_264/0.07)]"
    >
      {/* Document tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-[oklch(0.975_0.005_255)] px-4 py-3">
        {DEMO_DOCS.map((d, i) => (
          <button
            key={d.label}
            type="button"
            onClick={() => pick(0, i)}
            aria-pressed={i === doc}
            className={`inline-flex min-h-11 items-center rounded-lg border px-3 py-2 font-mono text-[12.5px] transition-colors duration-200 ${
              i === doc
                ? 'border-primary-strong bg-primary-strong text-primary-strong-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary-strong/50'
            }`}
          >
            {d.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {statusLabel}
        </span>
      </div>

      {/* Line rows */}
      <div>
        {activeDoc.lines.map((l, i) => {
          const on = i === lineIndex
          const rowTone = TONE[l.kind]
          return (
            <button
              key={l.no}
              type="button"
              onClick={() => pick(i)}
              aria-current={on || undefined}
              className={`flex w-full items-center gap-3 border-b border-[oklch(0.94_0.01_255)] px-4 py-3.5 text-left transition-colors duration-200 ${
                on ? `bg-[oklch(0.975_0.005_255)] ${rowTone.ring}` : 'bg-card'
              }`}
            >
              <span className="w-[34px] shrink-0 font-mono text-[11px] text-muted-foreground">
                {l.no}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{l.item}</span>
              <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
                {l.price}
              </span>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${
                  on && !scanning
                    ? `${rowTone.bg} border-transparent text-white`
                    : `bg-card ${rowTone.pill}`
                }`}
              >
                {l.tag}
              </span>
            </button>
          )
        })}
      </div>

      {/* Evidence pane */}
      <div className="relative min-h-[250px] bg-[oklch(0.978_0.004_255)] px-4 py-4">
        {scanning && !reduced && (
          <span
            aria-hidden="true"
            className="animate-rf-sweep pointer-events-none absolute inset-y-0 left-0 w-[34%] bg-gradient-to-r from-transparent via-primary-strong/[0.18] to-transparent"
          />
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Catalog evidence
          </span>
          {!scanning && (
            <span
              className={`animate-rf-pop rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-white ${tone.bg}`}
            >
              {active.tag}
            </span>
          )}
        </div>

        <div className="mt-3 flex gap-3">
          <div
            className={`h-[92px] w-[92px] shrink-0 overflow-hidden rounded-xl border transition-colors duration-[250ms] ${
              scanning ? 'border-[oklch(0.92_0.012_255)] opacity-50' : tone.border
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={DEMO_CATALOG_PHOTO}
              alt="Vendor catalog photo"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm leading-relaxed text-[oklch(0.46_0.02_264)]">
              {scanning ? DEMO_SCANNING.text : active.text}
            </p>
            <p className="mt-2 break-words font-mono text-[11px] text-muted-foreground">
              {scanning ? DEMO_SCANNING.source : `src: ${active.source}`}
            </p>
          </div>
        </div>

        {/* Metric tiles. PO price is read off the document itself, so it is
            known immediately -- only the catalog lookup and confidence wait. */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: 'PO price', value: active.poPrice, tint: '' },
            {
              label: 'Catalog',
              value: scanning ? DEMO_SCANNING.placeholder : active.catPrice,
              tint: !scanning && active.kind === 'warn' ? 'text-flag-text' : '',
            },
            {
              label: 'Confidence',
              value: scanning ? DEMO_SCANNING.placeholder : active.confidence,
              tint: '',
            },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl bg-card px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {tile.label}
              </p>
              <p className={`mt-1 font-mono text-[17px] text-foreground ${tile.tint}`}>
                {tile.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
