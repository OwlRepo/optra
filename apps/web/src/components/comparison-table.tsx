import { CheckCircle2, X } from 'lucide-react'
import { Reveal } from '@/components/motion/reveal'

export type ComparisonRow = {
  before: string
  after: string
}

export function ComparisonTable({ rows, beforeLabel, afterLabel }: { rows: ComparisonRow[]; beforeLabel: string; afterLabel: string }) {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-border/70 bg-card">
      <div className="grid grid-cols-1 divide-y divide-border/70 border-b border-border/70 bg-secondary text-sm font-semibold sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="p-4 text-foreground">{beforeLabel}</div>
        <div className="p-4 text-primary">{afterLabel}</div>
      </div>

      <div className="divide-y divide-border/70">
        {rows.map((row, index) => (
          <Reveal key={row.before} delay={index * 90}>
            <div className="grid grid-cols-1 divide-y divide-border/70 bg-card sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="flex items-start gap-3 p-5 text-sm leading-6 text-foreground/75">
                <X className="mt-0.5 size-4 shrink-0 text-destructive/70" />
                <span>{row.before}</span>
              </div>
              <div className="flex items-start gap-3 p-5 text-sm leading-6">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{row.after}</span>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  )
}
