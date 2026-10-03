'use client'

import * as React from 'react'
import type { ArrowRenderProps, LoaderRenderProps, TooltipRenderProps } from 'react-joyride'
import { Button, Eyebrow, MicroLabel, Skeleton } from '@repo/ui'
import type { TourChapter, TourStepData } from './tour-steps'

const CHAPTER_LABEL: Record<TourChapter, string> = {
  welcome: 'Welcome',
  core: 'Core workflow',
  sample: 'Try it',
  workspace: 'Your workspace',
  finish: 'All set',
}

// The tour's tooltip is the Modal's look at tooltip scale: the same r20 panel,
// hairline, shadow and subtle footer. Joyride supplies the handlers, we supply
// every pixel.
export function TourTooltip({ index, size, isLastStep, step, backProps, primaryProps, skipProps, tooltipProps }: TooltipRenderProps) {
  const titleId = React.useId()
  const bodyId = React.useId()
  const data = step.data as TourStepData | undefined
  const interactive = data?.interactive === true
  const chapter = CHAPTER_LABEL[data?.chapter ?? 'core']
  const progress = size > 0 ? Math.min(100, Math.round(((index + 1) / size) * 100)) : 0

  // Joyride puts the localised label in `children`; spreading it would render it twice.
  const { children: backLabel, ...back } = backProps as typeof backProps & { children?: React.ReactNode }
  const { children: primaryLabel, ...primary } = primaryProps as typeof primaryProps & { children?: React.ReactNode }
  const { children: skipLabel, ...skip } = skipProps as typeof skipProps & { children?: React.ReactNode }

  return (
    <div
      {...tooltipProps}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="fade-slide-in w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-[20px] border border-border-panel bg-card text-left text-foreground shadow-modal"
    >
      <div className="px-[22px] pt-[18px]">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>{chapter}</Eyebrow>
          <span className="font-mono text-[11px] text-ink-muted">
            Step {index + 1} of {size}
          </span>
        </div>
        <div aria-hidden="true" className="mt-3 h-1 overflow-hidden rounded-full bg-surface-subtle">
          <div
            className="h-full rounded-full bg-primary-strong transition-[width] duration-300 ease-[var(--ease-out)]"
            style={{ width: `${progress}%` }}
          />
        </div>
        {step.title ? (
          <h2 id={titleId} className="mt-4 font-display text-[17px] font-semibold leading-snug">
            {step.title}
          </h2>
        ) : null}
        <div id={bodyId} className="mb-[18px] mt-2 text-sm leading-relaxed text-ink-ghost">
          {step.content}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-b-[20px] border-t border-border-inner bg-surface-subtle px-[22px] py-3">
        <Button type="button" variant="ghost" size="sm" {...skip}>
          {skipLabel ?? 'Skip tour'}
        </Button>
        {interactive ? (
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary-strong animate-op-pulse" />
            <MicroLabel as="span" tone="teal">
              Tap the highlighted control
            </MicroLabel>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button type="button" variant="outline" size="sm" {...back}>
                {backLabel ?? 'Back'}
              </Button>
            ) : null}
            <Button type="button" size="sm" {...primary}>
              {primaryLabel ?? (isLastStep ? 'Finish' : 'Next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// Joyride positions this span against the tooltip edge; the polygon fills with the
// panel colour and a stroke draws only the two outer edges, so the base of the
// arrow melts into the panel instead of showing a seam.
export function TourArrow({ base, size, placement }: ArrowRenderProps) {
  const side = placement.split('-')[0]
  const horizontal = side === 'top' || side === 'bottom'
  const width = horizontal ? base : size
  const height = horizontal ? size : base
  const half = base / 2
  const shapes: Record<string, { fill: string; edges: string }> = {
    top: { fill: `0,0 ${half},${size} ${base},0`, edges: `0,0 ${half},${size} ${base},0` },
    bottom: { fill: `${base},${size} ${half},0 0,${size}`, edges: `${base},${size} ${half},0 0,${size}` },
    left: { fill: `0,0 ${size},${half} 0,${base}`, edges: `0,0 ${size},${half} 0,${base}` },
    right: { fill: `${size},${base} ${size},0 0,${half}`, edges: `${size},${base} ${size},0 0,${half}` },
  }
  const shape = shapes[side]
  if (!shape) return null
  return (
    <svg width={width} height={height} aria-hidden="true" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', overflow: 'visible' }}>
      <polygon points={shape.fill} style={{ fill: 'var(--card)' }} />
      <polyline points={shape.edges} fill="none" strokeLinejoin="round" style={{ stroke: 'var(--border-panel)' }} />
    </svg>
  )
}

export function TourLoader(_props: LoaderRenderProps) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-[12px] bg-card px-4 py-3 shadow-modal"
    >
      <Skeleton className="h-3.5 w-10" />
      <MicroLabel as="span">Loading page…</MicroLabel>
    </div>
  )
}
