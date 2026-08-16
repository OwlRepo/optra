import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Reveal } from '@/components/motion/reveal'
import { HeroMatchDemo } from './hero-match-demo'

export function Hero() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] items-center gap-[clamp(36px,4.5vw,64px)] px-[clamp(20px,3.4vw,40px)] pb-[clamp(48px,5.5vw,76px)] pt-[clamp(48px,6vw,84px)]">
        <Reveal>
          <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
            <span aria-hidden="true" className="h-px w-6 bg-primary-strong" />
            Vision-verified invoice matching
          </p>

          <h1 className="mt-5 font-display text-[clamp(38px,5.4vw,62px)] font-semibold leading-[1.02] tracking-[-0.035em] text-foreground">
            Catch the mismatch
            <br />
            before you pay it.
          </h1>

          <p className="mt-5 max-w-[44ch] text-[19px] leading-[1.65] text-[oklch(0.46_0.02_264)]">
            Optra matches every purchase-order line to the vendor&apos;s own catalog entry — price,
            quantity, and product photo — and flags the difference while the invoice is still on
            your desk.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="#trial"
              className="inline-flex items-center gap-2 rounded-[14px] bg-primary-strong px-[26px] py-4 text-base font-semibold text-primary-strong-foreground shadow-[0_10px_24px_oklch(0.5_0.09_184/0.22)] transition-colors duration-200 hover:bg-primary-strong-hover"
            >
              Start free trial
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link
              href="#product"
              className="inline-flex items-center rounded-[14px] border border-[oklch(0.9_0.012_255)] bg-card px-[26px] py-4 text-base font-semibold text-foreground transition-colors duration-200 hover:border-primary-strong/50"
            >
              See how matching works
            </Link>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            14 days free · no card · works with the PDFs you already have
          </p>
        </Reveal>

        <Reveal delay={90}>
          <HeroMatchDemo />
        </Reveal>
      </div>
    </section>
  )
}
