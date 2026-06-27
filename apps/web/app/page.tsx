import Link from 'next/link'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  PageSection,
  PageShell,
} from '@repo/ui'
import {
  ArrowRight,
  Bot,
  FileStack,
  Gauge,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react'

const metrics = [
  { label: 'Avg. answer time', value: '<15s' },
  { label: 'Knowledge coverage', value: '94%' },
  { label: 'Team ramp time', value: '-42%' },
]

const pillars = [
  {
    icon: Search,
    title: 'Find right answer instantly',
    description: 'Semantic retrieval surfaces exact sections, policies, and troubleshooting steps without forcing agents to know where content lives.',
  },
  {
    icon: Workflow,
    title: 'Turn docs into workflow memory',
    description: 'Convert SOPs, FAQs, and release notes into an operational layer your whole support org can use every day.',
  },
  {
    icon: ShieldCheck,
    title: 'Keep replies consistent',
    description: 'Every answer follows approved knowledge so non-technical teammates can respond with confidence and fewer escalations.',
  },
]

const features = [
  {
    eyebrow: 'Knowledge ops',
    title: 'One place for support context',
    description: 'Blend internal docs, customer-facing help, and tribal knowledge into one retrieval experience.',
    icon: FileStack,
  },
  {
    eyebrow: 'Assistive chat',
    title: 'Answers with context, not guesses',
    description: 'Grounded responses keep agents fast while still showing enough detail to understand the why behind each answer.',
    icon: Bot,
  },
  {
    eyebrow: 'Performance',
    title: 'Feels fast for every teammate',
    description: 'Clean layouts, clear states, and lightweight motion keep experience friendly for non-technical teams under pressure.',
    icon: Gauge,
  },
]

export default function Home() {
  return (
    <PageShell contentClassName="pb-24">
      <AppHeader
        className="mt-4 rounded-[calc(var(--radius)+0.5rem)] border border-border/70 bg-background/75"
        brand={
          <Link href="/" className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-md)]">
            <Sparkles className="size-5" />
          </Link>
        }
        title="Second Brain"
        description="Support intelligence for modern customer teams"
        navigation={
          <>
            <a href="#product" className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground">Product</a>
            <a href="#workflow" className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground">Workflow</a>
            <a href="#why-us" className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground">Why us</a>
          </>
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/chat">Live demo</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard">Open workspace</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-10 pb-20 pt-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:pt-16">
        <div className="space-y-8">
          <Badge variant="secondary" className="w-fit">Modern SaaS support workspace</Badge>
          <div className="space-y-5">
            <h1 className="max-w-4xl text-5xl font-semibold leading-[0.95] tracking-[-0.04em] md:text-7xl lg:text-[5.5rem]">
              Give every support teammate
              <span className="text-gradient block">expert-level context</span>
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
              Second Brain turns scattered documentation into fast, confident answers. It looks polished, feels easy, and helps non-technical teams solve customer issues without digging through tabs.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="xl" className="min-w-[12rem]">
              <Link href="/dashboard">
                Launch dashboard
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="xl" variant="outline" className="min-w-[12rem]">
              <Link href="/chat">Try chat assistant</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {metrics.map((item) => (
              <Card key={item.label} variant="subtle" className="p-5">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-3 font-display text-3xl font-semibold tabular-nums" data-numeric>
                  {item.value}
                </p>
              </Card>
            ))}
          </div>
        </div>

        <Card variant="gradient" className="relative overflow-hidden p-6 lg:p-8">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent,rgba(255,255,255,0.4),transparent)] opacity-40" />
          <div className="relative space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-primary">Live answer preview</p>
                <p className="text-sm text-muted-foreground">Grounded response experience</p>
              </div>
              <Badge variant="success">Streaming</Badge>
            </div>
            <div className="space-y-4 rounded-[calc(var(--radius)+0.25rem)] border border-border/60 bg-background/80 p-5 shadow-[var(--shadow-md)]">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <MessageSquareText className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Agent question</p>
                  <p className="text-sm text-muted-foreground">“Customer cannot update billing email. What should I do?”</p>
                </div>
              </div>
              <div className="rounded-[calc(var(--radius)+0.25rem)] border border-border/70 bg-card p-4 shadow-[var(--shadow-sm)]">
                <p className="text-sm font-semibold text-primary">Recommended answer</p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Verify account ownership, confirm whether invoice history must be retained, then guide customer through Settings → Billing → Contact email. If SSO billing is enabled, escalate to finance admin.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-secondary/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Confidence</p>
                  <p className="mt-2 text-2xl font-display font-semibold">High</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-secondary/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sources attached</p>
                  <p className="mt-2 text-2xl font-display font-semibold">03</p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>

      <PageSection
        className="py-10"
        eyebrow={<Badge variant="outline">Trusted workflow</Badge>}
        title="Fast answers for people who just need system to work"
        description="No jargon-heavy UI. No flashy motion overload. Just clear structure, helpful defaults, and enough polish to feel premium."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {pillars.map(({ icon: Icon, title, description }) => (
            <Card key={title} variant="elevated" className="group p-6 hover:-translate-y-1 hover:border-primary/20">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[var(--shadow-sm)]">
                <Icon className="size-5" />
              </div>
              <h3 className="mt-6 text-2xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection
        className="py-10"
        eyebrow={<Badge variant="secondary" id="product">Product overview</Badge>}
        title="Designed like real software, not placeholder screens"
        description="Production-ready layout patterns with strong hierarchy, premium cards, thoughtful empty states, and feedback components that keep teams oriented."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {features.map(({ eyebrow, title, description, icon: Icon }) => (
            <Card key={title} variant="subtle" className="p-6 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]">
              <Badge variant="outline" className="w-fit">{eyebrow}</Badge>
              <div className="mt-6 flex size-12 items-center justify-center rounded-2xl bg-accent/20 text-accent-foreground">
                <Icon className="size-5" />
              </div>
              <h3 className="mt-6 text-2xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection
        className="py-10"
        eyebrow={<Badge variant="outline" id="workflow">Operator workflow</Badge>}
        title="Simple three-step adoption path"
        description="From blank state to production workflow, layout guides users with clear next actions instead of assuming technical fluency."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {[
            ['01', 'Bring in source knowledge', 'Upload SOPs, help center docs, macros, and internal notes into single searchable layer.'],
            ['02', 'Review readiness', 'Dashboard surfaces empty states, onboarding checklist, and confidence-building feedback patterns.'],
            ['03', 'Answer with confidence', 'Chat experience handles loading, retries, and safe failure states so work never feels broken.'],
          ].map(([step, title, description]) => (
            <Card key={step} variant="elevated" className="p-6">
              <p className="font-mono text-sm font-semibold text-primary">{step}</p>
              <h3 className="mt-5 text-2xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection
        className="py-10"
        eyebrow={<Badge variant="secondary" id="why-us">Why teams choose it</Badge>}
        title="High-trust interface from first interaction"
        description="Users judge product quality before they read docs. Clean spacing, subtle motion, clear states, and premium surfaces increase trust immediately."
      >
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="Ready to turn support knowledge into product advantage?"
          description="Open redesigned workspace, test assistant flow, and use dashboard patterns as base for production integrations."
          actions={
            <>
              <Button asChild size="lg">
                <Link href="/dashboard">Explore dashboard</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/chat">Run live chat test</Link>
              </Button>
            </>
          }
        />
      </PageSection>
    </PageShell>
  )
}
