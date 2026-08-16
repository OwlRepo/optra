import { Accordion } from '@/components/accordion'
import { ComparisonTable } from '@/components/comparison-table'
import { FilesTrust } from '@/components/landing/files-trust'
import { FinalCta } from '@/components/landing/final-cta'
import { Hero } from '@/components/landing/hero'
import { LandingNav } from '@/components/landing/landing-nav'
import { MetricsStrip } from '@/components/landing/metrics-strip'
import { PricingPlans } from '@/components/landing/pricing-plans'
import { ProductCards } from '@/components/landing/product-cards'
import { ProductTour } from '@/components/landing/product-tour'
import { SiteFooter } from '@/components/landing/site-footer'
import { UseCaseGrid } from '@/components/landing/use-case-grid'
import { WorkflowSteps } from '@/components/landing/workflow-steps'
import { WorkspaceModes } from '@/components/landing/workspace-modes'
import { Reveal } from '@/components/motion/reveal'

const WEB_URL = process.env.WEB_URL ?? 'https://optra.example.com'

const comparisons = [
  {
    before: 'Checking one invoice means opening five files by hand.',
    after: 'One workspace matches PO, catalog, and invoice on upload.',
  },
  {
    before: 'The catalog photo and what actually shipped are never compared.',
    after: 'Every line gets a photo-level catalog match before approval.',
  },
  {
    before: 'A price increase buried on line 9 gets approved.',
    after: 'Every price delta is flagged against the vendor’s own catalog.',
  },
  {
    before: 'The buyer who knew this vendor left in March.',
    after: 'The workspace remembers the price history and the old flags.',
  },
]

const faqItems = [
  {
    question: 'Is Optra only for procurement teams?',
    answer:
      'No. A solo buyer runs it as a private workspace; a procurement team shares one workspace across every buyer. Same matching, different seat count.',
  },
  {
    question: 'What documents can it read?',
    answer:
      'Vendor catalogs including product photos, purchase orders, invoices, and price lists — PDF, scanned PDF, spreadsheet, or image. If a person could read it, Optra can extract line items from it.',
  },
  {
    question: "Does it replace a buyer's approval?",
    answer:
      'Never. Optra flags likely mismatches between the PO, catalog, and invoice and shows its source. A human decides whether to approve, dispute, or ignore.',
  },
  {
    question: 'Why not just review the PDFs by hand?',
    answer:
      'Manual review catches obvious errors on the lines you happen to check. Optra checks all of them, every time, including the photo — so a nine-cent increase on line 3 of 14 does not slip through.',
  },
  {
    question: 'What happens to my files?',
    answer:
      'They live in your workspace and are used only to answer your matches. Delete the workspace and the files, matches, and history go with it.',
  },
]

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Optra',
    url: WEB_URL,
    logo: `${WEB_URL}/icon.png`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Optra',
    description:
      'Match purchase orders against vendor catalogs and invoices, with vision-based product matching and automatic discrepancy flagging.',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
  },
]

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <LandingNav />

      <main>
        <Hero />
        <MetricsStrip />
        <ProductCards />
        <ProductTour />
        <WorkspaceModes />
        <WorkflowSteps />

        {/* Why Optra */}
        <section className="border-b border-border bg-card">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
            <Reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
                Why Optra
              </p>
              <h2 className="mt-4 max-w-[20ch] font-display text-[clamp(28px,3.2vw,38px)] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground">
                A missed increase isn&apos;t an error. It&apos;s the next invoice.
              </h2>
            </Reveal>
            <div className="mt-9">
              <ComparisonTable
                rows={comparisons}
                beforeLabel="Today, by hand"
                afterLabel="With Optra"
              />
            </div>
          </div>
        </section>

        <UseCaseGrid />
        <FilesTrust />
        <PricingPlans />

        {/* FAQ */}
        <section id="faq" className="border-b border-border bg-card">
          <div className="mx-auto grid max-w-[1200px] grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-10 px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
            <Reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
                FAQ
              </p>
              <h2 className="mt-4 font-display text-[clamp(28px,3.2vw,38px)] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground">
                Before you connect a vendor
              </h2>
            </Reveal>
            <Accordion items={faqItems} defaultOpenIndex={0} />
          </div>
        </section>

        <FinalCta />
      </main>

      <SiteFooter />
    </>
  )
}
