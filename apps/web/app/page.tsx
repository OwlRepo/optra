import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageSection,
  PageShell,
} from "@repo/ui";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
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
import { FeatureList } from "@/components/feature-list";
import { LandingHeader } from "@/components/landing-header";
import { CountUp } from "@/components/motion/count-up";
import { Marquee } from "@/components/motion/marquee";
import { Reveal } from "@/components/motion/reveal";
import { SpotlightCard } from "@/components/motion/spotlight-card";
import { TypingText } from "@/components/motion/typing-text";
import { Stepper } from "@/components/stepper";
import { WorkspaceTabs } from "@/components/workspace-tabs";

const WEB_URL = process.env.WEB_URL ?? "https://mnemra.tyvera.app";

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
    step: "01",
    title: "Connect your vendors",
    description:
      "Upload vendor catalogs, purchase orders, and invoices — PDFs, spreadsheets, or scanned copies — into your workspace.",
  },
  {
    step: "02",
    title: "Optra matches automatically",
    description:
      "Optra reads each line item, matches it to the vendor's catalog entry — including the product photo — and checks the price and quantity against the PO.",
  },
  {
    step: "03",
    title: "Review what got flagged",
    description:
      "Get a clear result for every line: confirmed, or flagged with the exact catalog source and the price or item difference.",
  },
];

const useCases = [
  "Procurement teams",
  "AP / accounts payable teams",
  "Multi-vendor sourcing teams",
  "Operations & supply chain teams",
  "Small business buyers",
  "Founder-led purchasing workflows",
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
          <div className="pointer-events-none absolute left-1/2 top-0 -z-10 size-[42rem] -translate-x-1/2 animate-float-slow rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute right-0 top-40 -z-10 size-[22rem] animate-float-slower rounded-full bg-secondary blur-3xl" />

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

                    <Badge variant="warning" className="shrink-0">
                      Flagged
                    </Badge>
                  </div>

                  <div className="space-y-4 rounded-3xl border border-border/70 bg-background/80 p-5 shadow-sm">
                    <div className="flex gap-3">
                      <FileSearch className="mt-1 size-5 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-semibold">PO line item</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          “PO #4417 · Line 3 — 200 × 3/8in steel hex bolts,
                          vendor Ironclad Supply, $0.42/unit.”
                        </p>
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
                        <p className="mt-3 text-2xl font-semibold text-foreground">
                          High
                        </p>
                      </div>

                      <div className="rounded-3xl border border-border/70 bg-secondary/50 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Catalog sources checked
                        </p>
                        <p className="mt-3 text-2xl font-semibold text-foreground">
                          03
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

        <PageSection
          className="py-20"
          eyebrow={<Badge variant="outline">Product</Badge>}
          title="Stop approving invoices you have not actually checked"
          description="Optra gives buyers one place to match purchase orders, vendor catalogs, and invoices — including the product photos — instead of comparing PDFs by hand."
        >
          <div className="grid gap-5 lg:grid-cols-3">
            {pillars.map(({ icon: Icon, title, description }, index) => (
              <Reveal key={title} delay={index * 90}>
                <SpotlightCard
                  variant="elevated"
                  className="group h-full rounded-3xl border-border/70 p-6 transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10"
                >
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>

                  <h3 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
                    {title}
                  </h3>

                  <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    {description}
                  </p>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </PageSection>

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
          <FeatureList items={features} />
        </PageSection>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="outline">Workflow</Badge>}
          title="A simple path from a stack of PDFs to a checked invoice"
          description="No complex migration. Start with the purchase orders and vendor catalogs you already have."
        >
          <Stepper steps={workflowSteps} />
        </PageSection>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="secondary">Use cases</Badge>}
          title="Built for teams who check the same vendor invoices repeatedly"
          description="Optra fits any procurement workflow where purchase orders, vendor catalogs, and invoices are scattered across email, PDFs, and spreadsheets."
        >
          <div className="space-y-3">
            <Marquee>
              {useCases.slice(0, 3).map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 whitespace-nowrap rounded-2xl border border-border/70 bg-card/80 p-4 text-sm font-medium shadow-sm"
                >
                  <CheckCircle2 className="size-5 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </Marquee>
            <Marquee reverse>
              {useCases.slice(3).map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 whitespace-nowrap rounded-2xl border border-border/70 bg-card/80 p-4 text-sm font-medium shadow-sm"
                >
                  <CheckCircle2 className="size-5 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </Marquee>
          </div>
        </PageSection>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="outline">Why Optra</Badge>}
          title="Matches your team can verify, not just trust"
          description="A missed price increase does not show up as an error. It shows up on the next invoice. Here is what changes once every match cites its source."
        >
          <ComparisonTable rows={comparisons} beforeLabel="Without Optra" afterLabel="With Optra" />
        </PageSection>

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
