import Link from 'next/link'
import { BrandMark } from '@/components/brand-mark'

const NAV_LINKS = [
  { label: 'Product', href: '#product' },
  { label: 'Workflow', href: '#workflow' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/[0.86] backdrop-blur-[16px]">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-2 gap-y-3 px-[clamp(20px,3.4vw,40px)] py-3.5">
        <Link href="/" aria-label="Home" className="mr-auto flex min-h-11 items-center gap-2.5">
          <BrandMark className="h-7 w-7" decorative />
          <span className="font-display text-xl font-semibold tracking-[-0.04em] text-foreground">
            Optra
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center rounded-[10px] px-3.5 py-2 text-[15px] text-[oklch(0.45_0.02_264)] transition-colors duration-200 hover:text-primary-strong"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Link
          href="#trial"
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-xl bg-primary-strong px-[18px] py-2.5 text-[15px] font-semibold text-primary-strong-foreground transition-colors duration-200 hover:bg-primary-strong-hover"
        >
          Start free trial
        </Link>
      </div>
    </header>
  )
}
