import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  ConfidenceMeter,
  EmptyState,
  PageSection,
  PageShell,
} from "@repo/ui";
import {
  Archive,
  ArrowRight,
  FileSearch,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { Accordion } from "@/components/accordion";
import { BrandMark } from "@/components/brand-mark";
import { ComparisonTable } from "@/components/comparison-table";
import { LandingHeader } from "@/components/landing-header";
import { AmbientDotGrid } from "@/components/landing/ambient-dot-grid";
import { DiscrepancyChip } from "@/components/landing/discrepancy-chip";
import { ExtractionReveal } from "@/components/landing/extraction-reveal";
import { PillarShowcase } from "@/components/landing/pillar-showcase";
import { UseCaseCloud } from "@/components/landing/use-case-cloud";
import { ValueShowcase } from "@/components/landing/value-showcase";
import { WorkflowPipeline } from "@/components/landing/workflow-pipeline";
import { CountUp } from "@/components/motion/count-up";
import { Reveal } from "@/components/motion/reveal";
import { TypingText } from "@/components/motion/typing-text";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { HERO_MATCH_EXAMPLE } from "@/lib/landing-example";

const WEB_URL = process.env.WEB_URL ?? "https://optra.example.com";

const metrics = [
  { label: "Avg. match time", prefix: "<", value: 10, suffix: "s" },
  { label: "Catalog coverage", value: 94, suffix: "%" },
  { label: "Manual review time", prefix: "-", value: 42, suffix: "%" },
];

const pillars = [
  {
    icon: Search,
    title: "Match it once, not line by line",
    description:
      "Check every PO line item against the vendor's catalog, price list, and past invoices from one workspace.",
  },
  {
    icon: Workflow,
    title: "Learn from every past order",
    description:
      "Surface prior orders from the same vendor, past pricing, and any discrepancy that was flagged before, so a pattern does not repeat unnoticed.",
  },
  {
    icon: ShieldCheck,
    title: "Approve with evidence, not a guess",
    description:
      "Every match is grounded in the vendor's actual catalog entry and product photo, so a buyer can verify before approving instead of assuming it is right.",
  },
];

const workspaceModes = [
  {
    id: "personal",
    icon: <User className="size-4" />,
    label: "Personal",
    title: "Your own purchasing memory",
    description:
      "Built for solo buyers and small-business owners juggling multiple vendors without a procurement team behind them.",
    bullets: [
      "Upload a PO or invoice the moment it lands, no formatting required",
      "Search your own order history instead of relying on memory",
      "Keep vendor-specific pricing history separate without mixing accounts",
    ],
  },
  {
    id: "team",
    icon: <Users className="size-4" />,
    label: "Team",
    title: "One catalog, every buyer",
    description:
      "Built for procurement teams where a price check should not depend on who happens to remember the last invoice.",
    bullets: [
      "Every buyer matches against the same approved vendor catalog",
      "New buyers search real order and pricing history starting day one",
      "Senior buyers stop re-checking the same vendor's pricing every week",
    ],
  },
];

const features = [
  {
    eyebrow: "Onboarding",
    title: "Ramp new buyers faster",
    description:
      "Give new buyers access to vendor catalogs, price history, and past discrepancies without waiting months to learn which vendors run high.",
    icon: UserPlus,
  },
  {
    eyebrow: "Continuity",
    title: "Keep vendor history when people leave",
    description:
      "Preserve every match, flagged discrepancy, and price history even after the buyer who caught it moves on.",
    icon: Archive,
  },
  {
    eyebrow: "Efficiency",
    title: "Cut manual line-by-line review",
    description:
      "Let the vision match run automatically so buyers only spend time on the line items that actually get flagged.",
    icon: Zap,
  },
];

const workflowSteps = [
  {
    title: "Connect your vendors",
    description:
      "Upload vendor catalogs, purchase orders, and invoices — PDFs, spreadsheets, or scanned copies — into your workspace.",
  },
  {
    title: "Optra matches automatically",
    description:
      "Optra reads each line item, matches it to the vendor's catalog entry — including the product photo — and checks the price and quantity against the PO.",
  },
  {
    title: "Review what got flagged",
    description:
      "Get a clear result for every line: confirmed, or flagged with the exact catalog source and the price or item difference.",
  },
];

const useCases = [
  {
    label: "Procurement teams",
    detail: "Match every PO against the vendor catalog before it is approved.",
  },
  {
    label: "AP / accounts payable teams",
    detail: "Catch a price or quantity mismatch before the invoice gets paid.",
  },
  { label: "Multi-vendor sourcing teams" },
  { label: "Operations & supply chain teams" },
  { label: "Small business buyers" },
  { label: "Founder-led purchasing workflows" },
];

const comparisons = [
  {
    before: "Checking a vendor invoice against the PO means opening five different files by hand.",
    after: "One workspace matches the PO, catalog, and invoice automatically.",
  },
  {
    before: "A catalog photo and the item that actually shipped do not always match, and nobody double-checks it.",
    after: "Every line item gets a vision-based catalog match before it is approved.",
  },
  {
    before: "A price increase buried in a PDF invoice gets approved because nobody compared it line by line.",
    after: "Every price mismatch is flagged against the vendor catalog before payment goes out.",
  },
];

const faqItems = [
  {
    question: "Is Optra only for procurement teams?",
    answer:
      "No. A solo buyer can run it as a personal workspace, and a procurement team can share it as one workspace across every buyer.",
  },
  {
    question: "What documents can Optra read?",
    answer:
      "Optra is designed for vendor catalogs (including product photos), purchase orders, invoices, and other PDFs your buyers already work from.",
  },
  {
    question: "Does it replace a buyer's approval?",
    answer:
      "No. It flags likely mismatches between the PO, catalog, and invoice. A buyer still reviews and decides whether to approve.",
  },
  {
    question: "Why not just review the PDFs manually?",
    answer:
      "Manual review catches obvious errors. Optra checks every line item against the vendor's catalog automatically, including the product photo, so a subtle price change or a swapped item does not slip through.",
  },
];

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Optra",
    url: WEB_URL,
    logo: `${WEB_URL}/icon.png`,
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Optra",
    description:
      "Match purchase orders against vendor catalogs and invoices, with vision-based product matching and automatic discrepancy flagging.",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
  },
];

const heroLineItemText = `"PO #${HERO_MATCH_EXAMPLE.poNumber} · Line ${HERO_MATCH_EXAMPLE.lineNumber} — ${HERO_MATCH_EXAMPLE.quantity} × ${HERO_MATCH_EXAMPLE.itemDescription}, vendor ${HERO_MATCH_EXAMPLE.vendorName}, $${HERO_MATCH_EXAMPLE.poUnitPrice.toFixed(2)}/unit."`;

export default function Home() {
  return (
    <PageShell contentClassName="pb-0">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <LandingHeader
        className="mt-4 rounded-[2rem] border border-border/70 bg-background/80 backdrop-blur-xl"
        brand={
          <Link href="/" aria-label="Home" className="inline-flex">
            <BrandMark decorative className="size-11" />
          </Link>
        }
        title="Optra"
        description="Vision-verified vendor sourcing and invoice matching"
        navigation={
          <>
            <a
              href="#product"
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              Product
            </a>
            <a
              href="#workflow"
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              Workflow
            </a>
            <a
              href="#use-cases"
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              Use cases
            </a>
            <a
              href="#faq"
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              FAQ
            </a>
          </>
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/chat">Live demo</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/workspaces">Open workspace</Link>
            </Button>
          </>
        }
      />

      <main>
        <section className="relative overflow-hidden pb-20 pt-16 lg:pb-28 lg:pt-24">
          <AmbientDotGrid className="pointer-events-none absolute inset-0 -z-10" />

          <div className="grid gap-12 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
            <div className="space-y-8">
              <Reveal>
                <Badge
                  variant="secondary"
                  className="w-fit border border-border/70"
                >
                  Vision-verified vendor sourcing workspace
                </Badge>
              </Reveal>

              <div className="space-y-5">
                <Reveal delay={80}>
                  <h1 className="max-w-4xl text-5xl font-semibold leading-[0.95] tracking-[-0.055em] text-foreground md:text-7xl lg:text-[5.6rem]">
                    The mismatch is already in the paperwork.
                    <span className="block text-primary">
                      Optra helps you catch it before you pay.
                    </span>
                  </h1>
                </Reveal>

                <Reveal delay={160}>
                  <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
                    Match purchase orders against vendor catalogs, extract
                    line items from PDFs, and flag price or item mismatches
                    before an invoice gets approved.
                  </p>
                </Reveal>
              </div>

              <Reveal delay={240}>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    asChild
                    size="xl"
                    className="btn-shine min-w-[12rem] shadow-lg shadow-primary/20 transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
                  >
                    <Link href="/workspaces">
                      Launch workspace
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>

                  <Button
                    asChild
                    size="xl"
                    variant="outline"
                    className="min-w-[12rem] bg-background/70 transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
                  >
                    <Link href="/chat">Try chat assistant</Link>
                  </Button>
                </div>
              </Reveal>

              <div className="grid gap-4 sm:grid-cols-3">
                {metrics.map((item, index) => (
                  <Reveal key={item.label} delay={320 + index * 80}>
                    <Card
                      variant="subtle"
                      className="rounded-3xl border-border/70 bg-card/80 p-5 shadow-sm backdrop-blur transition-transform duration-300 hover:-translate-y-1"
                    >
                      <p className="text-sm text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-3 font-display text-3xl font-semibold text-foreground">
                        <CountUp
                          value={item.value}
                          prefix={item.prefix}
                          suffix={item.suffix}
                        />
                      </p>
                    </Card>
                  </Reveal>
                ))}
              </div>
            </div>

            <Reveal delay={200} distance={32}>
              <Card className="relative overflow-hidden rounded-[2rem] border-border/70 bg-card/90 p-6 shadow-2xl shadow-primary/10 backdrop-blur lg:p-8">
                <div className="pointer-events-none absolute inset-0 bg-primary/[0.03]" />

                <div className="relative space-y-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-primary">
                        Live match preview
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Vision-based catalog matching
                      </p>
                    </div>

                    <DiscrepancyChip>
                      <Badge variant="warning" className="shrink-0">
                        Flagged
                      </Badge>
                    </DiscrepancyChip>
                  </div>

                  <div className="space-y-4 rounded-3xl border border-border/70 bg-background/80 p-5 shadow-sm">
                    <div className="flex gap-3">
                      <FileSearch className="mt-1 size-5 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-semibold">PO line item</p>
                        <ExtractionReveal className="mt-1 text-sm leading-6 text-muted-foreground">
                          {heroLineItemText}
                        </ExtractionReveal>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
                      <p className="text-sm font-semibold text-primary">
                        Match result
                      </p>
                      <TypingText
                        text="Vendor catalog lists this SKU at $0.51/unit — 18% above the PO price. Product photo matches the catalog listing exactly, so the item itself is correct. Price mismatch flagged for review before this invoice is approved."
                        className="mt-3 text-sm leading-7 text-muted-foreground"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-3xl border border-border/70 bg-secondary/50 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Match confidence
                        </p>
                        <ConfidenceMeter
                          value={HERO_MATCH_EXAMPLE.matchConfidence}
                          label={HERO_MATCH_EXAMPLE.matchConfidenceLabel}
                          className="mt-3"
                        />
                      </div>

                      <div className="rounded-3xl border border-border/70 bg-secondary/50 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Catalog sources checked
                        </p>
                        <p className="mt-3 text-2xl font-semibold text-foreground">
                          {String(HERO_MATCH_EXAMPLE.catalogSourcesChecked).padStart(2, "0")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </Reveal>
          </div>
        </section>

        <section className="border-y border-border/70 bg-secondary py-6">
          <div className="grid gap-3 text-center sm:grid-cols-3">
            <div className="text-sm font-medium text-foreground/80">
              Built for repeat vendor invoices
            </div>
            <div className="text-sm font-medium text-foreground/80">
              Designed for solo buyers and procurement teams
            </div>
            <div className="text-sm font-medium text-foreground/80">
              Every match cites the catalog it came from
            </div>
          </div>
        </section>

        <div id="product" className="scroll-mt-28">
          <PageSection
            className="py-20"
            eyebrow={<Badge variant="outline">Product</Badge>}
            title="Stop approving invoices you have not actually checked"
            description="Optra gives buyers one place to match purchase orders, vendor catalogs, and invoices — including the product photos — instead of comparing PDFs by hand."
          >
            <PillarShowcase pillars={pillars} />
          </PageSection>
        </div>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="outline">Workspaces</Badge>}
          title="Use it alone, or bring the whole procurement team"
          description="Start by matching your own purchase orders, then grow into a shared workspace when every buyer needs the same vendor history."
        >
          <Reveal>
            <WorkspaceTabs modes={workspaceModes} />
          </Reveal>
        </PageSection>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="secondary">Core value</Badge>}
          title="Everything a buyer needs, connected"
          description="Vendor catalogs, PO matching, and invoice extraction all pull from the same workspace so a price check today matches the one from last quarter."
        >
          <ValueShowcase items={features} />
        </PageSection>

        <div id="workflow" className="scroll-mt-28">
          <PageSection
            className="py-16"
            eyebrow={<Badge variant="outline">Workflow</Badge>}
            title="A simple path from a stack of PDFs to a checked invoice"
            description="No complex migration. Start with the purchase orders and vendor catalogs you already have."
          >
            <WorkflowPipeline steps={workflowSteps} />
          </PageSection>
        </div>

        <div id="use-cases" className="scroll-mt-28">
          <PageSection
            className="py-16"
            eyebrow={<Badge variant="secondary">Use cases</Badge>}
            title="Built for teams who check the same vendor invoices repeatedly"
            description="Optra fits any procurement workflow where purchase orders, vendor catalogs, and invoices are scattered across email, PDFs, and spreadsheets."
          >
            <UseCaseCloud useCases={useCases} />
          </PageSection>
        </div>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="outline">Why Optra</Badge>}
          title="Matches your team can verify, not just trust"
          description="A missed price increase does not show up as an error. It shows up on the next invoice. Here is what changes once every match cites its source."
        >
          <ComparisonTable rows={comparisons} beforeLabel="Without Optra" afterLabel="With Optra" />
        </PageSection>

        <div id="faq" className="scroll-mt-28">
          <PageSection
            className="py-16"
            eyebrow={<Badge variant="outline">FAQ</Badge>}
            title="Common questions before you connect a vendor"
            description="Straight answers about how Optra is meant to fit into a procurement workflow."
          >
            <Reveal>
              <Accordion items={faqItems} />
            </Reveal>
          </PageSection>
        </div>

        <section className="py-20">
          <Reveal>
            <EmptyState
              icon={<Sparkles className="size-5" />}
              title="Ready to check your first purchase order?"
              description="Create a workspace, connect a vendor catalog, and match your first purchase order or invoice."
              actions={
                <>
                  <Button asChild size="lg" className="btn-shine">
                    <Link href="/workspaces">
                      Explore workspace
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>

                  <Button asChild size="lg" variant="outline">
                    <Link href="/chat">Run a live match test</Link>
                  </Button>
                </>
              }
            />
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border/70 py-10">
        <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr] md:items-start">
          <div className="flex items-start gap-4">
            <BrandMark decorative className="size-11 shrink-0" />
            <div>
              <p className="text-lg font-semibold">Optra</p>
              <p className="mt-2 max-w-md text-sm leading-7 text-muted-foreground">
                Match purchase orders, vendor catalogs, and invoices for solo
                buyers and procurement teams.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-3">
            <div className="space-y-3">
              <p className="font-semibold">Product</p>
              <a
                href="#product"
                className="block text-muted-foreground transition hover:text-foreground"
              >
                Overview
              </a>
              <a
                href="#workflow"
                className="block text-muted-foreground transition hover:text-foreground"
              >
                Workflow
              </a>
            </div>

            <div className="space-y-3">
              <p className="font-semibold">Use cases</p>
              <a
                href="#use-cases"
                className="block text-muted-foreground transition hover:text-foreground"
              >
                Who it helps
              </a>
              <a
                href="#faq"
                className="block text-muted-foreground transition hover:text-foreground"
              >
                FAQ
              </a>
            </div>

            <div className="space-y-3">
              <p className="font-semibold">App</p>
              <Link
                href="/chat"
                className="block text-muted-foreground transition hover:text-foreground"
              >
                Live match demo
              </Link>
              <Link
                href="/workspaces"
                className="block text-muted-foreground transition hover:text-foreground"
              >
                Workspace
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border/70 pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Optra. All rights reserved.</p>
          <p>
            Built for buyers who are tired of catching a price mismatch after
            it&apos;s already paid.
          </p>
        </div>
      </footer>
    </PageShell>
  );
}
