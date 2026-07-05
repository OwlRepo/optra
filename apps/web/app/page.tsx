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
  MessageSquareText,
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
  { label: "Avg. answer time", prefix: "<", value: 15, suffix: "s" },
  { label: "Knowledge coverage", value: 94, suffix: "%" },
  { label: "Team ramp time", prefix: "-", value: 42, suffix: "%" },
];

const pillars = [
  {
    icon: Search,
    title: "Search once, not everywhere",
    description:
      "Find answers across tickets, documents, support notes, Slack threads, and runbooks from one clean workspace.",
  },
  {
    icon: Workflow,
    title: "Reuse proven fixes",
    description:
      "Surface similar past issues, previous decisions, and the exact troubleshooting flow your team already used.",
  },
  {
    icon: ShieldCheck,
    title: "Reply with confidence",
    description:
      "Every answer is grounded in source material so agents can verify before replying instead of guessing beautifully.",
  },
];

const workspaceModes = [
  {
    id: "personal",
    icon: <User className="size-4" />,
    label: "Personal",
    title: "Your own second brain",
    description:
      "Built for VAs, freelancers, and solo support agents juggling multiple clients without a team behind them.",
    bullets: [
      "Save a fix the moment you find it, no formatting required",
      "Search your own ticket history instead of relying on memory",
      "Keep client-specific context separate without mixing accounts",
    ],
  },
  {
    id: "team",
    icon: <Users className="size-4" />,
    label: "Team",
    title: "One brain, every agent",
    description:
      "Built for support teams and agencies where the right answer should not depend on who happens to be on shift.",
    bullets: [
      "Every agent answers from the same approved knowledge",
      "New hires search real ticket history starting day one",
      "Senior agents stop re-explaining the same fix every week",
    ],
  },
];

const features = [
  {
    eyebrow: "Onboarding",
    title: "Ramp new agents faster",
    description:
      "Give new hires access to past support history, internal docs, and resolved cases without waiting months to absorb tribal knowledge.",
    icon: UserPlus,
  },
  {
    eyebrow: "Continuity",
    title: "Keep knowledge when people leave",
    description:
      "Preserve troubleshooting steps, customer context, and hard-won fixes even after the person who solved them moves on.",
    icon: Archive,
  },
  {
    eyebrow: "Efficiency",
    title: "Reduce repeated interruptions",
    description:
      "Let agents self-serve answers from trusted knowledge so senior teammates are not interrupted for the same questions all week.",
    icon: Zap,
  },
];

const workflowSteps = [
  {
    step: "01",
    title: "Add your knowledge",
    description:
      "Upload support docs, SOPs, ticket exports, troubleshooting notes, or copied support threads into your workspace.",
  },
  {
    step: "02",
    title: "Ask in natural language",
    description:
      "Agents ask questions the way they would ask a teammate, then Mnemra searches the workspace context behind the scenes.",
  },
  {
    step: "03",
    title: "Use sourced answers",
    description:
      "Get a grounded answer with source context, confidence signals, and enough detail to move the ticket forward.",
  },
];

const useCases = [
  "Customer support teams",
  "Virtual assistants",
  "Agencies handling multiple clients",
  "Internal operations teams",
  "Product support specialists",
  "Founder-led support workflows",
];

const comparisons = [
  {
    before: "Agents check five different tools before they can answer one ticket.",
    after: "One search across tickets, docs, and support threads finds it.",
  },
  {
    before: "The fix leaves the company the day the person who found it does.",
    after: "Every troubleshooting step stays searchable, permanently.",
  },
  {
    before: "A confident-sounding reply is still a guess dressed up nicely.",
    after: "Every answer cites the source it came from before it sends.",
  },
];

const faqItems = [
  {
    question: "Is Mnemra only for teams?",
    answer:
      "No. You can use it as a personal workspace or as a shared team workspace. Solo agents can treat it as their private support memory, while teams can use it as a shared source of truth.",
  },
  {
    question: "What kind of knowledge can it use?",
    answer:
      "Mnemra is designed for support history, documents, SOPs, troubleshooting notes, copied chat threads, and other internal knowledge your agents already rely on.",
  },
  {
    question: "Does it replace support agents?",
    answer:
      "No. It helps agents answer faster by finding relevant context. The agent still reviews, verifies, and decides what to send.",
  },
  {
    question: "Why not just use normal document search?",
    answer:
      "Normal search returns files. Mnemra is designed to return usable support answers with context, source references, and patterns from previous fixes.",
  },
];

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Mnemra",
    url: WEB_URL,
    logo: `${WEB_URL}/icon.png`,
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Mnemra",
    description:
      "Search past tickets, docs, and support threads to get sourced answers before replying to customers.",
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
        title="Mnemra"
        description="Turn support history into instant, sourced answers"
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
                  Modern support knowledge workspace
                </Badge>
              </Reveal>

              <div className="space-y-5">
                <Reveal delay={80}>
                  <h1 className="max-w-4xl text-5xl font-semibold leading-[0.95] tracking-[-0.055em] text-foreground md:text-7xl lg:text-[5.6rem]">
                    Your team already solved this.
                    <span className="block text-primary">
                      Mnemra helps you find it.
                    </span>
                  </h1>
                </Reveal>

                <Reveal delay={160}>
                  <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
                    Search past tickets, docs, and support threads to get a
                    sourced answer before you start typing a reply.
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
                        Live answer preview
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Grounded response experience
                      </p>
                    </div>

                    <Badge variant="success" className="shrink-0">
                      Streaming
                    </Badge>
                  </div>

                  <div className="space-y-4 rounded-3xl border border-border/70 bg-background/80 p-5 shadow-sm">
                    <div className="flex gap-3">
                      <MessageSquareText className="mt-1 size-5 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-semibold">Agent question</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          “Customer cannot update billing email. What should I
                          do?”
                        </p>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
                      <p className="text-sm font-semibold text-primary">
                        Recommended answer
                      </p>
                      <TypingText
                        text="Verify account ownership, confirm whether invoice history must be retained, then guide the customer through the billing contact email flow. If billing is managed by an admin, escalate to the workspace owner."
                        className="mt-3 text-sm leading-7 text-muted-foreground"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-3xl border border-border/70 bg-secondary/50 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Confidence
                        </p>
                        <p className="mt-3 text-2xl font-semibold text-foreground">
                          High
                        </p>
                      </div>

                      <div className="rounded-3xl border border-border/70 bg-secondary/50 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Sources attached
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
              Built for repeat support questions
            </div>
            <div className="text-sm font-medium text-foreground/80">
              Designed for personal and team workspaces
            </div>
            <div className="text-sm font-medium text-foreground/80">
              Grounded answers with source context
            </div>
          </div>
        </section>

        <PageSection
          className="py-20"
          eyebrow={<Badge variant="outline">Product</Badge>}
          title="Stop losing time to knowledge you already have"
          description="Mnemra gives support agents one clean place to search previous fixes, internal notes, support documents, and copied team conversations."
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
          title="Use it alone, or bring the whole team"
          description="Start with your own support memory, then grow into a shared workspace when the team needs the same source of truth."
        >
          <Reveal>
            <WorkspaceTabs modes={workspaceModes} />
          </Reveal>
        </PageSection>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="secondary">Core value</Badge>}
          title="Everything support teams need, connected"
          description="Knowledge search, grounded chat, and support context all pull from the same workspace so answers stay consistent."
        >
          <FeatureList items={features} />
        </PageSection>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="outline">Workflow</Badge>}
          title="A simple path from scattered notes to usable answers"
          description="No complex migration ritual. Humanity has suffered enough. Start with the knowledge you already have."
        >
          <Stepper steps={workflowSteps} />
        </PageSection>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="secondary">Use cases</Badge>}
          title="Built for people who answer the same painful questions repeatedly"
          description="Mnemra fits any support-heavy workflow where past fixes, SOPs, and customer context are scattered across too many places."
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
          eyebrow={<Badge variant="outline">Why Mnemra</Badge>}
          title="Answers your team can verify, not just trust"
          description="Blind AI confidence is not a product strategy, it is a workplace incident waiting politely. Here is what changes once every answer comes with its source."
        >
          <ComparisonTable rows={comparisons} beforeLabel="Without Mnemra" afterLabel="With Mnemra" />
        </PageSection>

        <PageSection
          className="py-16"
          eyebrow={<Badge variant="outline">FAQ</Badge>}
          title="Questions before the obvious button-clicking begins"
          description="Straight answers about how Mnemra is meant to fit into a support workflow."
        >
          <Reveal>
            <Accordion items={faqItems} />
          </Reveal>
        </PageSection>

        <section className="py-20">
          <Reveal>
            <EmptyState
              icon={<Sparkles className="size-5" />}
              title="Ready to build your support memory?"
              description="Create a workspace, add your first knowledge source, and start asking questions from your own support history."
              actions={
                <>
                  <Button asChild size="lg" className="btn-shine">
                    <Link href="/workspaces">
                      Explore workspace
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>

                  <Button asChild size="lg" variant="outline">
                    <Link href="/chat">Run live chat test</Link>
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
              <p className="text-lg font-semibold">Mnemra</p>
              <p className="mt-2 max-w-md text-sm leading-7 text-muted-foreground">
                Turn support history into instant, sourced answers for personal
                and team support workflows.
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
                Live demo
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
          <p>© {new Date().getFullYear()} Mnemra. All rights reserved.</p>
          <p>
            Built for support teams that are tired of solving the same thing
            twice.
          </p>
        </div>
      </footer>
    </PageShell>
  );
}
