// Verifiable facts only: uploads accept PDF/CSV/XLSX, every PO line is
// compared, and a person records one of four decision outcomes.
const METRICS = [
  { label: 'Formats read', value: 'PDF · CSV · XLSX', tint: '' },
  { label: 'Lines checked', value: 'Each PO line', tint: '' },
  { label: 'Final call', value: 'A person', tint: 'text-primary-strong' },
]

export function MetricsStrip() {
  return (
    <section className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-x-10 gap-y-5 px-[clamp(20px,3.4vw,40px)] py-7">
        {METRICS.map((metric) => (
          <div key={metric.label}>
            <p className="text-[13px] text-muted-foreground">{metric.label}</p>
            <p
              className={`mt-1 font-display text-3xl font-semibold ${metric.tint || 'text-foreground'}`}
            >
              {metric.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
