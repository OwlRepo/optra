'use client'

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

const MODES = [
  {
    id: 'personal',
    label: 'Personal',
    title: 'Your own purchasing memory',
    description:
      'For solo buyers and owners juggling a dozen vendors with nobody to hand the checking to. Upload, match, move on.',
    meta: 'private workspace · 1 seat · unlimited vendors',
    bullets: [
      'Upload a PO or invoice the moment it lands — no formatting first',
      'Search your own order history instead of trusting your memory',
      'Keep each vendor’s pricing history separate and citable',
    ],
  },
  {
    id: 'team',
    label: 'Team',
    title: 'One catalog, every buyer',
    description:
      'For procurement teams where a price check should not depend on who happens to remember the last invoice.',
    meta: 'shared workspace · roles · one approved catalog',
    bullets: [
      'Every buyer matches against the same approved vendor catalog',
      'New buyers search real order and pricing history from day one',
      'Senior buyers stop re-checking the same vendor every week',
    ],
  },
] as const

const VALUE_CARDS = [
  {
    eyebrow: 'Onboarding',
    title: 'Ramp new buyers in a week',
    text: 'They inherit the catalogs, the price history, and every discrepancy the team already caught.',
  },
  {
    eyebrow: 'Continuity',
    title: 'Vendor history outlasts the buyer',
    text: 'Matches, flags, and prices stay in the workspace after the person who caught them moves on.',
  },
  {
    eyebrow: 'Efficiency',
    title: 'Only read the lines that failed',
    text: 'Matching runs on upload, so attention goes to the handful of flagged lines.',
  },
]

export function WorkspaceModes() {
  const [modeId, setModeId] = useState<(typeof MODES)[number]['id']>('personal')
  const active = MODES.find((mode) => mode.id === modeId) ?? MODES[0]

  return (
    <section className="border-b border-border bg-card">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
              Workspaces
            </p>
            <h2 className="mt-4 max-w-[18ch] font-display text-[clamp(28px,3.2vw,38px)] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground">
              One buyer or twelve, same vendor history
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Workspace type"
            className="flex gap-1 rounded-xl bg-[oklch(0.965_0.008_255)] p-1"
          >
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="tab"
                id={`workspace-tab-${mode.id}`}
                aria-selected={mode.id === modeId}
                aria-controls={`workspace-panel-${mode.id}`}
                onClick={() => setModeId(mode.id)}
                className={`inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                  mode.id === modeId
                    ? 'bg-card text-primary-strong shadow-[0_1px_3px_oklch(0.238_0.03_264/0.12)]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div
          role="tabpanel"
          id={`workspace-panel-${active.id}`}
          aria-labelledby={`workspace-tab-${active.id}`}
          className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-6"
        >
          <div className="rounded-[18px] bg-[oklch(0.978_0.004_255)] p-8">
            <h3 className="font-display text-[26px] font-semibold text-foreground">
              {active.title}
            </h3>
            <p className="mt-3 text-base leading-[1.7] text-[oklch(0.46_0.02_264)]">
              {active.description}
            </p>
            <p className="mt-5 font-mono text-[11px] text-muted-foreground">{active.meta}</p>
          </div>

          <ul className="rounded-[18px] border border-border">
            {active.bullets.map((bullet, i) => (
              <li
                key={bullet}
                className={`flex items-start gap-3 px-[26px] py-[22px] ${
                  i > 0 ? 'border-t border-[oklch(0.94_0.01_255)]' : ''
                }`}
              >
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-[18px] shrink-0 text-primary-strong"
                />
                <span className="text-[15px] leading-[1.6] text-[oklch(0.46_0.02_264)]">
                  {bullet}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-6">
          {VALUE_CARDS.map((card) => (
            <div key={card.eyebrow} className="rounded-[18px] bg-[oklch(0.978_0.004_255)] p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-strong">
                {card.eyebrow}
              </p>
              <h4 className="mt-3 font-display text-lg font-semibold text-foreground">
                {card.title}
              </h4>
              <p className="mt-2 text-sm leading-[1.65] text-[oklch(0.46_0.02_264)]">{card.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
