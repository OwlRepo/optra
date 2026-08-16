import { Reveal } from '@/components/motion/reveal'

// PLACEHOLDER METRIC -- illustrative extraction/match rates for the step-2 visual.
const BARS = [
  { label: 'extract', percent: 100 },
  { label: 'catalog', percent: 92 },
  { label: 'photo', percent: 78 },
]

export function WorkflowSteps() {
  return (
    <section id="workflow" className="border-b border-border">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
            Workflow
          </p>
          <h2 className="mt-4 max-w-[20ch] font-display text-[clamp(30px,3.6vw,42px)] font-semibold leading-[1.06] tracking-[-0.03em] text-foreground">
            From a folder of PDFs to a checked invoice
          </h2>
          <p className="mt-4 max-w-[56ch] text-lg leading-[1.65] text-[oklch(0.46_0.02_264)]">
            No migration and no format to enforce. Start with what your vendors already send.
          </p>
        </Reveal>

        <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-8">
          <Reveal>
            <Step
              n="1"
              title="Drop the files in"
              body="Catalogs, POs, invoices — PDF, scan, or spreadsheet. Nothing needs reformatting first."
            >
              <div className="flex h-[88px] items-center justify-center rounded-xl border border-dashed border-[oklch(0.88_0.012_255)]">
                <span className="font-mono text-[11px] text-muted-foreground">
                  pdf / xlsx / csv / jpg
                </span>
              </div>
            </Step>
          </Reveal>

          <Reveal delay={80}>
            <Step
              n="2"
              title="Optra reads and matches"
              body="Line items are extracted, then matched to a catalog entry — price, quantity, and photo checked together."
            >
              <div className="flex h-[88px] flex-col justify-center gap-3">
                {BARS.map((bar) => (
                  <div key={bar.label} className="flex items-center gap-3">
                    <span className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">
                      {bar.label}
                    </span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-[oklch(0.94_0.01_255)]">
                      <span
                        className="block h-full rounded-full bg-primary-strong"
                        style={{ width: `${bar.percent}%` }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </Step>
          </Reveal>

          <Reveal delay={160}>
            <Step
              n="3"
              title="You review the exceptions"
              body="Confirmed lines pass silently. Flagged lines arrive with the catalog source and the exact difference."
              amber
            >
              <div className="flex h-[88px] flex-col justify-center rounded-xl bg-flag/10 px-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-flag-strong">
                  2 of 14 lines flagged
                </p>
                <p className="mt-1.5 text-sm text-[oklch(0.46_0.02_264)]">
                  Line 3 · +18% price · Line 7 · item mismatch
                </p>
              </div>
            </Step>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Step({
  n,
  title,
  body,
  amber = false,
  children,
}: {
  n: string
  title: string
  body: string
  amber?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-[9px] font-mono text-[11px] text-white ${
            amber ? 'bg-flag' : 'bg-primary-strong'
          }`}
        >
          {n}
        </span>
        <span
          aria-hidden="true"
          className={`h-px flex-1 ${amber ? 'bg-flag/35' : 'bg-[oklch(0.9_0.012_255)]'}`}
        />
      </div>
      <h3 className="mt-4 font-display text-[22px] font-semibold text-foreground">{title}</h3>
      <p className="mt-2.5 text-[15px] leading-[1.65] text-[oklch(0.46_0.02_264)]">{body}</p>
      <div className="mt-5">{children}</div>
    </div>
  )
}
