import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function FinalCta() {
  return (
    <section id="trial" className="border-b border-border">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,84px)]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-center gap-10 rounded-3xl bg-cta-surface p-[clamp(28px,4vw,56px)] text-cta-surface-foreground">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-cta-surface-accent">
              Start free
            </p>
            <h2 className="mt-4 max-w-[16ch] font-display text-[clamp(30px,3.6vw,44px)] font-semibold leading-[1.06] tracking-[-0.03em]">
              Check one purchase order tonight.
            </h2>
            <p className="mt-4 max-w-[46ch] text-[17px] leading-[1.7] text-cta-surface-muted">
              Upload a vendor catalog and a PO you already paid. If Optra finds nothing, you lost
              ten minutes. If it finds something, you know what it&apos;s worth.
            </p>
          </div>

          <div>
            <Link
              href="/workspaces"
              className="flex items-center justify-between gap-4 rounded-xl bg-cta-surface-foreground px-5 py-4 text-[15px] font-semibold text-cta-surface transition-opacity duration-200 hover:opacity-90"
            >
              Start free trial
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link
              href="#tour"
              className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-cta-surface-foreground/30 px-5 py-4 text-[15px] font-semibold text-cta-surface-foreground transition-colors duration-200 hover:border-cta-surface-foreground/60"
            >
              See the match demo
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <p className="mt-4 text-[13px] text-cta-surface-muted">
              14 days · no card · delete the workspace and every file goes with it
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
