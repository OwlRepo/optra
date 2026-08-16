import { CheckCircle2, X } from 'lucide-react'
import { Reveal } from '@/components/motion/reveal'

export type ComparisonRow = {
  before: string
  after: string
}

export function ComparisonTable({ rows, beforeLabel, afterLabel }: { rows: ComparisonRow[]; beforeLabel: string; afterLabel: string }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-card">
      <div className="grid grid-cols-1 divide-y divide-border border-b border-border bg-[oklch(0.968_0.007_255)] text-sm font-semibold sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-4 text-muted-foreground">{beforeLabel}</div>
        <div className="px-5 py-4 text-primary-strong">{afterLabel}</div>
      </div>

      <div className="divide-y divide-border">
        {rows.map((row, index) => (
          <Reveal key={row.before} delay={index * 90}>
            <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="flex items-start gap-3 bg-[oklch(0.982_0.004_255)] px-5 py-5 text-[15px] leading-[1.6] text-[oklch(0.46_0.02_264)]">
                <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{row.before}</span>
              </div>
              <div className="flex items-start gap-3 bg-card px-5 py-5 text-[15px] leading-[1.6] text-[oklch(0.46_0.02_264)]">
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-primary-strong"
                />
                <span>{row.after}</span>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  )
}
