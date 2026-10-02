import type { ReactNode } from 'react'
import Link from 'next/link'
import { BrandMark } from '@/components/brand-mark'
import { SiteFooter } from '@/components/landing/site-footer'
import { LEGAL_LAST_UPDATED } from '@/lib/legal-facts'

const LINK_CLASS =
  'text-primary-strong underline underline-offset-4 hover:text-primary-strong-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm'

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={LINK_CLASS}>
      {children}
    </a>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-[1.7] text-muted-foreground">
        {children}
      </div>
    </section>
  )
}

export function LegalTable({
  caption,
  headers,
  rows,
}: {
  caption: string
  headers: string[]
  rows: ReactNode[][]
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-card">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-foreground"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border align-top">
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="px-4 py-3 font-medium text-foreground">
                    {cell}
                  </th>
                ) : (
                  <td key={j} className="px-4 py-3 text-muted-foreground">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-[1200px] items-center px-[clamp(20px,3.4vw,40px)] py-4">
          <Link
            href="/"
            aria-label="Home"
            className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <BrandMark className="h-[26px] w-[26px]" decorative />
            <span className="font-display text-lg font-semibold tracking-[-0.04em] text-foreground">
              Optra
            </span>
          </Link>
        </div>
      </header>
      <main>
        <article className="mx-auto max-w-3xl px-[clamp(20px,3.4vw,40px)] py-[clamp(40px,6vw,72px)]">
          <h1 className="font-display text-[clamp(30px,4vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground">
            {title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {LEGAL_LAST_UPDATED}</p>
          {children}
        </article>
      </main>
      <SiteFooter />
    </>
  )
}
