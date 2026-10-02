import Link from 'next/link'
import { BrandMark } from '@/components/brand-mark'
import { CONTACT_EMAIL, SELLER_COUNTRY, SELLER_NAME } from '@/lib/legal-facts'

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Matching', href: '#product' },
      { label: 'Workflow', href: '#workflow' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'FAQ', href: '#faq' },
      { label: 'A look inside', href: '#tour' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Refunds', href: '/refund' },
      { label: 'Contact', href: `mailto:${CONTACT_EMAIL}` },
    ],
  },
  {
    heading: 'App',
    links: [
      { label: 'Workspace', href: '/workspaces' },
      { label: 'Sign in', href: '/login' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="bg-card">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-10">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark className="h-[26px] w-[26px]" decorative />
              <span className="font-display text-lg font-semibold tracking-[-0.04em] text-foreground">
                Optra
              </span>
            </div>
            <p className="mt-3 max-w-[34ch] text-sm leading-[1.65] text-[oklch(0.46_0.02_264)]">
              Purchase orders, vendor catalogs, and invoices — matched, cited, and flagged before
              payment.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-sm font-semibold text-foreground">{column.heading}</h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-6 items-center py-1 text-sm text-muted-foreground transition-colors duration-200 hover:text-primary-strong"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-[13px] text-muted-foreground">
          <p>{`© 2026 ${SELLER_NAME} · Optra · ${SELLER_COUNTRY}`}</p>
          <p>Product screens on this page show sample data.</p>
        </div>
      </div>
    </footer>
  )
}
