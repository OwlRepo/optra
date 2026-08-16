'use client'

import { useEffect, useState } from 'react'
import { Check, Pause, Play } from 'lucide-react'
import {
  DEMO_CATALOG_PHOTO,
  DEMO_DOCS,
  TOUR_CHAT_EXCHANGE,
  TOUR_VIGNETTES,
} from '@/lib/landing-demo-docs'
import { prefersReducedMotion, useInView } from '@/hooks/use-in-view'

const TOUR_DWELL_MS = 5200

export function ProductTour() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(false)
  const { ref, inView } = useInView<HTMLDivElement>()

  useEffect(() => {
    setReduced(prefersReducedMotion())
  }, [])

  // WCAG 2.2.2: content that moves for more than five seconds needs a way to
  // stop it. Autoplay is off under reduced motion, off-screen, and whenever the
  // visitor has pressed pause -- and the control is always visible, not a
  // hover-only affordance.
  const autoplay = inView && !paused && !reduced

  useEffect(() => {
    if (!autoplay) return
    const timer = setTimeout(
      () => setIndex((i) => (i + 1) % TOUR_VIGNETTES.length),
      TOUR_DWELL_MS,
    )
    return () => clearTimeout(timer)
  }, [index, autoplay])

  const active = TOUR_VIGNETTES[index]

  return (
    <section id="tour" className="border-b border-border bg-card">
      <div
        ref={ref}
        className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]"
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
              A look inside
            </p>
            <h2 className="mt-4 max-w-[20ch] font-display text-[clamp(28px,3.2vw,38px)] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground">
              What it looks like when Optra catches something
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary-strong/50"
          >
            {paused ? (
              <Play aria-hidden="true" className="size-4" />
            ) : (
              <Pause aria-hidden="true" className="size-4" />
            )}
            {paused ? 'Play tour' : 'Pause tour'}
          </button>
        </div>

        {/* Vignette selector */}
        <div role="tablist" aria-label="Product tour" className="mt-7 flex flex-wrap gap-2">
          {TOUR_VIGNETTES.map((vignette, i) => (
            <button
              key={vignette.id}
              type="button"
              role="tab"
              id={`tour-tab-${vignette.id}`}
              aria-selected={i === index}
              aria-controls={`tour-panel-${vignette.id}`}
              onClick={() => {
                setIndex(i)
                setPaused(true)
              }}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm transition-colors duration-200 ${
                i === index
                  ? 'border-primary-strong bg-primary-strong text-primary-strong-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-primary-strong/50'
              }`}
            >
              {vignette.chip}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`tour-panel-${active.id}`}
          aria-labelledby={`tour-tab-${active.id}`}
          className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-6"
        >
          <div className="self-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {active.screen}
            </p>
            <h3 className="mt-3 font-display text-2xl font-semibold text-foreground">
              {active.title}
            </h3>
            <p className="mt-3 max-w-[46ch] text-[17px] leading-[1.7] text-[oklch(0.46_0.02_264)]">
              {active.description}
            </p>
            <p className="mt-5 font-mono text-[11px] text-muted-foreground">
              illustrative example · not customer data
            </p>
          </div>

          {/* The mock app frame. `key` forces a remount per vignette so the
              entry animation replays; under reduced motion it simply swaps. */}
          <div
            key={active.id}
            className={`overflow-hidden rounded-[18px] border border-border bg-background shadow-[0_24px_60px_oklch(0.238_0.03_264/0.07)] ${
              reduced ? '' : 'animate-rf-pop'
            }`}
          >
            <div className="flex items-center gap-2 border-b border-border bg-[oklch(0.975_0.005_255)] px-4 py-2.5">
              <span aria-hidden="true" className="size-2 rounded-full bg-[oklch(0.88_0.012_255)]" />
              <span aria-hidden="true" className="size-2 rounded-full bg-[oklch(0.88_0.012_255)]" />
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Optra · {active.screen}
              </span>
            </div>
            <div className="p-4">
              {active.line ? <TourLineFrame line={active.line} /> : <TourChatFrame />}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function TourLineFrame({ line }: { line: readonly [number, number] }) {
  const [docIndex, lineIndex] = line
  const doc = DEMO_DOCS[docIndex]
  const entry = doc.lines[lineIndex]
  const tone =
    entry.kind === 'warn'
      ? { bg: 'bg-flag', border: 'border-flag' }
      : entry.kind === 'bad'
        ? { bg: 'bg-destructive', border: 'border-destructive' }
        : { bg: 'bg-primary-strong', border: 'border-primary-strong' }

  return (
    <div>
      <p className="font-mono text-[11px] text-muted-foreground">{doc.label}</p>

      <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3">
        <span className="font-mono text-[11px] text-muted-foreground">{entry.no}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{entry.item}</span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-white ${tone.bg}`}
        >
          {entry.tag}
        </span>
      </div>

      <div className="mt-3 flex gap-3">
        <div className={`size-[72px] shrink-0 overflow-hidden rounded-lg border ${tone.border}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={DEMO_CATALOG_PHOTO}
            alt="Vendor catalog photo"
            className="h-full w-full object-cover"
          />
        </div>
        <p className="text-sm leading-relaxed text-[oklch(0.46_0.02_264)]">{entry.text}</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: 'PO price', value: entry.poPrice },
          { label: 'Catalog', value: entry.catPrice },
          { label: 'Confidence', value: entry.confidence },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg bg-card px-2.5 py-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {tile.label}
            </p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{tile.value}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 break-words font-mono text-[10px] text-muted-foreground">
        src: {entry.source}
      </p>
    </div>
  )
}

function TourChatFrame() {
  return (
    <div>
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary-strong px-3.5 py-2.5 text-sm text-primary-strong-foreground">
        {TOUR_CHAT_EXCHANGE.question}
      </p>
      <div className="mt-3 max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-3">
        <p className="text-sm leading-relaxed text-[oklch(0.46_0.02_264)]">
          {TOUR_CHAT_EXCHANGE.answer}
        </p>
        <ul className="mt-3 space-y-1 border-t border-[oklch(0.94_0.01_255)] pt-2.5">
          {TOUR_CHAT_EXCHANGE.citations.map((citation) => (
            <li
              key={citation}
              className="flex items-start gap-1.5 break-words font-mono text-[10px] text-muted-foreground"
            >
              <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-primary-strong" />
              {citation}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
