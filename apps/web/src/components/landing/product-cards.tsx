import { ImageIcon, Search, ShieldCheck } from 'lucide-react'
import { Reveal } from '@/components/motion/reveal'
import { DEMO_CATALOG_PHOTO, DEMO_HISTORY_ROWS } from '@/lib/landing-demo-docs'

export function ProductCards() {
  return (
    <section id="product" className="border-b border-border">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
            Product
          </p>
          <h2 className="mt-4 max-w-[18ch] font-display text-[clamp(30px,3.6vw,42px)] font-semibold leading-[1.06] tracking-[-0.03em] text-foreground">
            Three ways an invoice quietly costs you money
          </h2>
          <p className="mt-4 max-w-[62ch] text-lg leading-[1.65] text-[oklch(0.46_0.02_264)]">
            Wrong price, wrong item, wrong quantity — all three look the same on a PDF. Optra checks
            each against a source you can open.
          </p>
        </Reveal>

        <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-6">
          <Reveal>
            <ProductCard
              icon={<Search aria-hidden="true" className="size-[19px] text-primary-strong" />}
              title="Match once, not line by line"
              body="Every PO line is checked against the vendor's catalog, current price list, and your past invoices in a single pass."
            >
              <dl className="space-y-1.5 font-mono text-[11px]">
                {[
                  { k: 'po line', v: '200 × 3/8in hex bolt', tint: 'text-muted-foreground' },
                  { k: 'catalog', v: 'IRN-38HXB · $0.51', tint: 'text-muted-foreground' },
                  { k: 'delta', v: '+18.0%', tint: 'text-flag-text' },
                ].map((row) => (
                  <div key={row.k} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{row.k}</dt>
                    <dd className={row.tint}>{row.v}</dd>
                  </div>
                ))}
              </dl>
            </ProductCard>
          </Reveal>

          <Reveal delay={80}>
            <ProductCard
              icon={<ImageIcon aria-hidden="true" className="size-[19px] text-primary-strong" />}
              title="The photo is part of the check"
              body="A swapped part number reads fine as text. Optra compares the catalog product photo, so a substituted item surfaces before delivery."
            >
              <div className="flex gap-2">
                {[
                  { alt: 'Ordered item', border: 'border-border' },
                  { alt: 'Catalog item', border: 'border-primary-strong' },
                ].map((photo) => (
                  <div
                    key={photo.alt}
                    className={`h-[76px] flex-1 overflow-hidden rounded-lg border ${photo.border}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={DEMO_CATALOG_PHOTO}
                      alt={photo.alt}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2.5 font-mono text-[11px] text-muted-foreground">
                ordered ↔ catalog · 92% visual match
              </p>
            </ProductCard>
          </Reveal>

          <Reveal delay={160}>
            <ProductCard
              icon={<ShieldCheck aria-hidden="true" className="size-[19px] text-primary-strong" />}
              title="Approve on evidence, not memory"
              body="Every verdict cites the file, page, and price behind it — and past flags stay searchable, so the same increase can't run twice."
            >
              <ul className="space-y-1">
                {DEMO_HISTORY_ROWS.map((row) => (
                  <li
                    key={row.date}
                    className={`rounded-r px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground ${
                      row.highlighted
                        ? 'border-l-2 border-primary-strong bg-primary-strong/[0.07]'
                        : ''
                    }`}
                  >
                    {row.date} · {row.detail}
                  </li>
                ))}
              </ul>
            </ProductCard>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function ProductCard({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <article className="flex h-full flex-col rounded-[18px] border border-[oklch(0.9_0.012_255)] bg-card p-7">
      <span className="flex size-[38px] items-center justify-center rounded-[11px] bg-primary-strong/10">
        {icon}
      </span>
      <h3 className="mt-4 font-display text-[21px] font-semibold text-foreground">{title}</h3>
      <p className="mt-2.5 text-[15px] leading-[1.65] text-[oklch(0.46_0.02_264)]">{body}</p>
      <div className="mt-5 border-t border-[oklch(0.94_0.01_255)] pt-4">{children}</div>
    </article>
  )
}
