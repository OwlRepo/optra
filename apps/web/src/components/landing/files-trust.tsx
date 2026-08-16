import { Reveal } from '@/components/motion/reveal'

const FILE_TYPES = [
  'PDF',
  'Scanned PDF',
  'XLSX',
  'CSV',
  'JPG / PNG',
  'Email attachment',
  'Price list',
]

// These four claims must stay accurate to the actual deployment (per-workspace
// isolation, per-workspace storage, real deletion). Do not add certifications
// -- SOC 2 and friends -- that this product does not hold.
const TRUST_ROWS = [
  {
    label: 'Isolation',
    text: 'Every workspace is separate. Your catalogs and invoices are never pooled with another buyer’s.',
  },
  {
    label: 'Citations',
    text: 'Each verdict records the file, page, and price behind it — openable, not paraphrased.',
  },
  {
    label: 'Human sign-off',
    text: 'Optra flags and explains. Approval stays with the buyer, always.',
  },
  {
    label: 'Deletion',
    text: 'Remove a workspace and its files, matches, and history are removed with it.',
  },
]

export function FilesTrust() {
  return (
    <section className="border-b border-border bg-card">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-10 px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
            Files &amp; trust
          </p>
          <h2 className="mt-4 max-w-[16ch] font-display text-[clamp(28px,3.2vw,38px)] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground">
            Reads what your vendors already send
          </h2>
          <p className="mt-4 max-w-[48ch] text-[17px] leading-[1.7] text-[oklch(0.46_0.02_264)]">
            No portal for vendors to log into, no template to enforce. If a person could read the
            file, Optra can pull line items out of it.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {FILE_TYPES.map((type) => (
              <li
                key={type}
                className="rounded-[9px] border border-[oklch(0.9_0.012_255)] bg-[oklch(0.978_0.004_255)] px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
              >
                {type}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={90}>
          <dl className="overflow-hidden rounded-2xl border border-border">
            {TRUST_ROWS.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-[140px_1fr] ${
                  i > 0 ? 'border-t border-[oklch(0.94_0.01_255)]' : ''
                }`}
              >
                <dt className="bg-[oklch(0.978_0.004_255)] px-4 py-5 font-mono text-[10px] uppercase tracking-[0.14em] text-primary-strong">
                  {row.label}
                </dt>
                <dd className="px-5 py-5 text-[15px] leading-[1.6] text-[oklch(0.46_0.02_264)]">
                  {row.text}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13px] text-muted-foreground">
            Optra flags. A buyer approves. No line is ever paid on the model&apos;s word alone.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
