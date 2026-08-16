// PLACEHOLDER METRIC -- illustrative figures from internal test runs, not
// measured customer averages. The footnote below must stay as long as that
// is true.
const METRICS = [
  { label: 'Avg. match time', value: '<10s', tint: '' },
  { label: 'Catalog coverage', value: '94%', tint: '' },
  { label: 'Manual review time', value: '−42%', tint: 'text-primary-strong' },
]

// TODO(pre-launch): drop real logo files into `apps/web/public/vendors/` and
// set `src` on each slot -- the wordmark below is the fallback, not the goal.
// Also confirm with the product owner that naming these vendors here is
// accurate; "Catalogs from" asserts a relationship with each of them.
type VendorSlot = { name: string; src?: string; placeholder?: boolean }

const VENDORS: VendorSlot[] = [
  { name: 'ABENSONS' },
  { name: 'Robinsons Appliances' },
  { name: 'CellBoy' },
  { name: 'Your company', placeholder: true },
]

export function MetricsStrip() {
  return (
    <section className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-10 gap-y-6 px-[clamp(20px,3.4vw,40px)] py-7">
        <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
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

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Catalogs from
          </span>
          <ul className="flex flex-wrap items-center gap-2">
            {VENDORS.map((vendor) => (
              <li
                key={vendor.name}
                className={`flex h-[34px] w-24 items-center justify-center rounded-lg px-2 ${
                  vendor.placeholder
                    ? 'border border-dashed border-[oklch(0.88_0.012_255)]'
                    : 'border border-border bg-background'
                }`}
              >
                {vendor.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={vendor.src}
                    alt={vendor.name}
                    className="max-h-[22px] w-auto object-contain"
                  />
                ) : (
                  <span className="truncate text-center font-mono text-[9px] uppercase leading-tight tracking-[0.1em] text-muted-foreground">
                    {vendor.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <p className="w-full text-xs text-[oklch(0.62_0.02_264)]">
          Illustrative figures from internal test runs on repeat vendor invoices — not a customer
          average.
        </p>
      </div>
    </section>
  )
}
