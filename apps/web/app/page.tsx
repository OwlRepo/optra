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
  Archive,
  ArrowRight,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'

const metrics = [
  { label: 'Avg. answer time', value: '<15s' },
  { label: 'Knowledge coverage', value: '94%' },
  { label: 'Team ramp time', value: '-42%' },
]

const pillars = [
  {
    icon: Search,
    title: 'Stop searching everywhere',
    description: 'One search across tickets, docs, Slack threads, and runbooks — instead of checking each tool separately.',
  },
  {
    icon: Workflow,
    title: 'Never solve it twice',
    description: "Surface similar past tickets and the exact fix that worked before, so issues don't get re-solved from scratch.",
  },
  {
    icon: ShieldCheck,
    title: 'Answer consistently, every time',
    description: 'Every answer is sourced from the same approved knowledge, so customers get the same answer no matter who replies.',
  },
]

const workspaceModes = [
  {
    icon: User,
    title: 'Personal workspace',
    description: 'For VAs, freelancers, and solo support agents who need one place for client notes, SOPs, and past fixes.',
  },
  {
    icon: Users,
    title: 'Team workspace',
    description: 'For support teams and agencies where every agent should answer from the same trusted knowledge.',
  },
]

const features = [
  {
    eyebrow: 'Knowledge ops',
    title: 'Onboard new agents on day one',
    description: "New hires get your team's full support history and proven fixes, instead of waiting months to learn tribal knowledge.",
    icon: UserPlus,
  },
  {
    eyebrow: 'Knowledge continuity',
    title: 'Keep knowledge when people leave',
    description: 'Past fixes and troubleshooting reasoning stay searchable even after the agent who found them is gone.',
    icon: Archive,
  },
  {
    eyebrow: 'Team efficiency',
    title: 'Free up your senior agents',
    description: 'Give junior agents self-serve access to what your experts already know, so interruptions drop and experts can focus on hard tickets.',
    icon: Zap,
  },
]

export default function Home() {
  return (
    <PageShell contentClassName="pb-24">
      <AppHeader
        className="mt-4 rounded-2xl border border-border/70 bg-background/75"
        brand={
          <Link href="/" aria-label="Home" className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
            <Sparkles className="size-5" />
          </Link>
        }
        title="Mnemra"
        description="Turn support history into instant, sourced answers"
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
              <Link href="/workspaces">Open workspace</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-10 pb-20 pt-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:pt-16">
        <div className="space-y-8">
          <Badge variant="secondary" className="w-fit">Modern SaaS support workspace</Badge>
          <div className="space-y-5">
            <h1 className="max-w-4xl text-5xl font-semibold leading-[0.95] tracking-[-0.04em] md:text-7xl lg:text-[5.5rem]">
              Your team already solved this.
              <span className="text-gradient block">Mnemra helps you find it.</span>
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
              Search past tickets, docs, and Slack threads to get a sourced answer before you start typing a reply.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="xl" className="min-w-[12rem]">
              <Link href="/workspaces">
                Launch workspace
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
          <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/40 to-transparent opacity-40" />
          <div className="relative space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-primary">Live answer preview</p>
                <p className="text-sm text-muted-foreground">Grounded response experience</p>
              </div>
              <Badge variant="success">Streaming</Badge>
            </div>
            <div className="space-y-4 rounded-xl border border-border/60 bg-background/80 p-5 shadow-md">
              <div className="flex items-center gap-3">
                <MessageSquareText className="size-5 text-primary" />
                <div>
                  <p className="text-sm font-semibold">Agent question</p>
                  <p className="text-sm text-muted-foreground">“Customer cannot update billing email. What should I do?”</p>
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
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
        title="Stop losing time to knowledge you already have"
        description="Stop digging through tickets, docs, and Slack threads for answers your team already found."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {pillars.map(({ icon: Icon, title, description }) => (
            <Card key={title} variant="elevated" className="group p-6 hover:-translate-y-1 hover:border-primary/20">
              <Icon className="size-5 text-primary" />
              <h3 className="mt-6 text-2xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection
        className="py-10"
        eyebrow={<Badge variant="outline">Workspaces</Badge>}
        title="Built for solo work and growing teams"
        description="Use Mnemra alone as your own support memory, or invite your team into a shared workspace everyone searches from."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          {workspaceModes.map(({ icon: Icon, title, description }) => (
            <Card key={title} variant="elevated" className="p-6">
              <Icon className="size-5 text-primary" />
              <h3 className="mt-6 text-2xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection
        className="py-10"
        eyebrow={<Badge variant="secondary" id="product">Product overview</Badge>}
        title="Everything support teams need, connected"
        description="Knowledge search, grounded chat, and ticket drafts all pull from the same source of truth, so answers never fall out of sync with your docs."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {features.map(({ eyebrow, title, description, icon: Icon }) => (
            <Card key={title} variant="subtle" className="p-6 hover:-translate-y-1 hover:shadow-lg">
              <Badge variant="outline" className="w-fit">{eyebrow}</Badge>
              <Icon className="mt-6 size-5 text-accent-foreground" />
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
        description="Go from zero documentation to confident answers in three steps — no engineering required."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {[
            ['01', 'Bring in source knowledge', 'Upload SOPs, help center docs, macros, and internal notes into single searchable layer.'],
            ['02', 'Review readiness', 'Workspace overview surfaces empty states, onboarding checklist, and confidence-building feedback patterns.'],
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
        title="Answers your team can verify, not just trust"
        description="Every answer cites its source, so agents can double-check before they reply and never guess in front of a customer."
      >
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="Ready to build your support memory?"
          description="Create a workspace, connect your first knowledge base, and see grounded answers in minutes."
          actions={
            <>
              <Button asChild size="lg">
                <Link href="/workspaces">Explore workspace</Link>
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
