import Link from 'next/link'
import { CONTACT_EMAIL, TRIAL_DAYS } from '@/lib/legal-facts'
import { Check } from 'lucide-react'
import { Reveal } from '@/components/motion/reveal'

// Included volumes are the product decision of record and the API enforces
// them: BillingGateService (apps/api/src/billing/billing-gate.service.ts)
// refuses work past the cap once BILLING_ENFORCEMENT is on. The numbers live in
// apps/api/src/billing/plans.ts#quotasFor; this section mirrors them because web
// cannot import the API, and pricing-plans.spec.tsx fails if they drift.
// There is no overage billing: a workspace stops at its cap (owner decision
// 2026-10-08). A photo check is one PO line verified against up to 8 catalog photos.
const PLANS = [
  {
    name: 'Solo',
    price: '$29',
    unit: 'per month · 1 buyer',
    blurb: 'For an owner or single buyer checking their own vendors.',
    features: [
      '400 matched line items / month',
      '100 photo checks / month',
      'Unlimited vendors and catalogs',
      'Photo-level catalog matching',
      'Full order and price history',
      'Hard monthly cap, no overage charges',
    ],
    cta: 'Start free trial',
    href: '#trial',
    featured: false,
    tag: null,
  },
  {
    name: 'Team',
    price: '$69',
    unit: 'per buyer / month',
    blurb: 'For a procurement team sharing one approved catalog.',
    features: [
      '2,000 matched line items per buyer, pooled',
      '300 photo checks per buyer, pooled',
      'Shared workspace, roles, and flag history',
      'Scanned and photo-only PDFs included',
      'Exportable evidence trail',
      'Hard monthly cap, no overage charges',
    ],
    cta: 'Start free trial',
    href: '#trial',
    featured: true,
    tag: 'Most buyers',
  },
  {
    name: 'Scale',
    price: 'Talk',
    unit: 'annual · from 25,000 lines / mo',
    blurb: 'For high-volume AP with its own review process.',
    features: [
      'Committed line-item rate',
      'Priority extraction queue',
      'Custom retention and deletion',
      'Onboarding for existing archives',
    ],
    cta: 'Email us about Scale',
    href: `mailto:${CONTACT_EMAIL}?subject=Optra%20Scale`,
    external: true,
    featured: false,
    tag: null,
  },
]

export function PricingPlans() {
  return (
    <section id="pricing" className="border-b border-border">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
                Pricing
              </p>
              <h2 className="mt-4 max-w-[16ch] font-display text-[clamp(30px,3.6vw,42px)] font-semibold leading-[1.06] tracking-[-0.03em] text-foreground">
                One flagged invoice covers the month
              </h2>
            </div>
            <p className="max-w-[42ch] text-sm leading-[1.7] text-muted-foreground">
              {`Priced per matched line item, not per document. Your first workspace starts with a ${TRIAL_DAYS}-day trial.`}
            </p>
          </div>
        </Reveal>

        <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 80}>
              <article
                className={`flex h-full flex-col rounded-[20px] bg-card p-7 ${
                  plan.featured
                    ? 'border border-primary-strong shadow-[0_20px_44px_oklch(0.5_0.09_184/0.14)]'
                    : 'border border-[oklch(0.9_0.012_255)]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-foreground">{plan.name}</h3>
                  {plan.tag && (
                    <span className="rounded-full bg-primary-strong px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-primary-strong-foreground">
                      {plan.tag}
                    </span>
                  )}
                </div>

                <p className="mt-4 font-display text-[42px] font-semibold leading-none tracking-[-0.04em] text-foreground">
                  {plan.price}
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">{plan.unit}</p>
                <p className="mt-4 text-sm leading-[1.65] text-[oklch(0.46_0.02_264)]">
                  {plan.blurb}
                </p>

                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 size-[15px] shrink-0 text-primary-strong"
                      />
                      <span className="text-sm leading-[1.55] text-[oklch(0.46_0.02_264)]">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className={`mt-7 block rounded-xl px-4 py-3 text-center text-[15px] font-semibold transition-colors duration-200 ${
                    plan.featured
                      ? 'bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover'
                      : 'border border-[oklch(0.9_0.012_255)] text-foreground hover:border-primary-strong/50'
                  }`}
                >
                  {plan.cta}
                  {'external' in plan && plan.external && (
                    <span className="sr-only"> (opens email)</span>
                  )}
                </Link>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
