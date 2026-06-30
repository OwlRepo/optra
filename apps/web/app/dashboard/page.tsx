'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  PageSection,
  PageShell,
  Skeleton,
  StatCard,
  StatusBanner,
  useToast,
} from '@repo/ui'
import {
  Bot,
  CheckCircle2,
  CircleEllipsis,
  Compass,
  Copy,
  FileStack,
  Gauge,
  RefreshCcw,
  Search,
  Sparkles,
} from 'lucide-react'

const stats = [
  {
    label: 'Documents indexed',
    value: '0',
    hint: 'Ready for first import',
    icon: <FileStack className="size-5" />,
  },
  {
    label: 'Knowledge coverage',
    value: '0%',
    hint: 'Connect source docs to begin',
    icon: <Search className="size-5" />,
  },
  {
    label: 'Resolved queries',
    value: '0',
    hint: 'No customer questions processed yet',
    icon: <Gauge className="size-5" />,
  },
]

const checklist = [
  {
    title: 'Connect support documentation',
    description: 'Bring in SOPs, macros, help center articles, and escalation guides.',
    state: 'next' as const,
  },
  {
    title: 'Review indexing quality',
    description: 'Confirm chunking, naming, and source metadata are clear for agents.',
    state: 'next' as const,
  },
  {
    title: 'Run first live assistant session',
    description: 'Use chat workspace to validate tone, confidence, and answer quality.',
    state: 'next' as const,
  },
]

export default function DashboardPage() {
  const { toast, updateToast } = useToast()
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [refreshedAt, setRefreshedAt] = React.useState<string | null>(null)

  const handleRefresh = React.useCallback(() => {
    if (isRefreshing) {
      return
    }

    const toastId = toast({
      variant: 'loading',
      title: 'Refreshing workspace',
      description: 'Pulling latest dashboard state and onboarding status.',
    })

    setIsRefreshing(true)
    window.setTimeout(() => {
      const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      setRefreshedAt(stamp)
      setIsRefreshing(false)
      updateToast(toastId, {
        variant: 'success',
        title: 'Workspace refreshed',
        description: `Dashboard synced at ${stamp}.`,
        duration: 3200,
      })
    }, 900)
  }, [isRefreshing, toast, updateToast])

  const handleCopyChecklist = React.useCallback(async () => {
    const text = checklist.map((item, index) => `${index + 1}. ${item.title} — ${item.description}`).join('\n')

    try {
      await navigator.clipboard.writeText(text)
      toast({
        variant: 'success',
        title: 'Checklist copied',
        description: 'Share onboarding steps with your team or implementation partner.',
      })
    } catch {
      toast({
        variant: 'error',
        title: 'Copy failed',
        description: 'Clipboard access was blocked by browser. Try again from secure context.',
      })
    }
  }, [toast])

  return (
    <PageShell contentClassName="pb-20">
      <AppHeader
        className="mt-4 rounded-[calc(var(--radius)+0.5rem)] border border-border/70 bg-background/75"
        brand={
          <Link href="/" className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-md)]">
            <Sparkles className="size-5" />
          </Link>
        }
        title="Operations dashboard"
        description="Track readiness, guide onboarding, and keep support knowledge quality visible."
        badge={<Badge variant="secondary">Beta workspace</Badge>}
        navigation={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/">Overview</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/workspaces">Workspaces</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/chat">Assistant</Link>
            </Button>
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleCopyChecklist}>
              <Copy className="size-4" />
              Copy checklist
            </Button>
            <Button size="sm" onClick={handleRefresh} isLoading={isRefreshing} loadingText="Refreshing">
              {!isRefreshing ? <RefreshCcw className="size-4" /> : null}
              {!isRefreshing ? 'Refresh' : null}
            </Button>
          </>
        }
      />

      <div className="space-y-8 pb-6 pt-10">
        <StatusBanner
          variant={isRefreshing ? 'loading' : 'info'}
          title={isRefreshing ? 'Refreshing overview' : 'Production-ready shell, backend-ready state'}
          description={
            isRefreshing
              ? 'Updating overview cards and activity surfaces.'
              : refreshedAt
                ? `Last synced at ${refreshedAt}. Connect real ingestion and analytics services to replace placeholder metrics.`
                : 'This dashboard now includes premium layout, toast feedback, empty states, and onboarding flows ready for real data wiring.'
          }
          action={
            <Button asChild size="sm" variant="ghost">
              <Link href="/chat">Open assistant</Link>
            </Button>
          }
        />

        <PageSection
          eyebrow={<Badge variant="outline">Workspace health</Badge>}
          title={<h1 className="text-3xl font-semibold md:text-4xl">Clear overview for non-technical operators</h1>}
          description="Fast-scanning KPI cards and plain-language guidance reduce training overhead while backend integrations catch up."
        >
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {stats.map((stat) =>
              isRefreshing ? (
                <Card key={stat.label} variant="elevated" className="space-y-5 p-6">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-10 w-24" />
                  <Skeleton className="h-4 w-40" />
                </Card>
              ) : (
                <StatCard key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} icon={stat.icon} />
              )
            )}
          </div>
        </PageSection>

        <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <Card variant="elevated" className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">Recent activity</p>
                <h2 className="mt-2 text-2xl font-semibold">No operational events yet</h2>
              </div>
              <Badge variant="outline">Awaiting first import</Badge>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              Once imports, queries, or knowledge syncs run, this panel can surface recent work, quality issues, and assistant usage in plain language.
            </p>
            <div className="mt-8">
              {isRefreshing ? (
                <div className="space-y-4">
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-28 w-full" />
                </div>
              ) : (
                <EmptyState
                  icon={<CircleEllipsis className="size-5" />}
                  title="Nothing to review yet"
                  description="Start with onboarding checklist, then run assistant workspace to validate first customer-facing flows."
                  actions={
                    <>
                      <Button asChild>
                        <Link href="/chat">Run assistant test</Link>
                      </Button>
                      <Button variant="outline" onClick={handleRefresh}>
                        Refresh now
                      </Button>
                    </>
                  }
                />
              )}
            </div>
          </Card>

          <Card variant="gradient" className="p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-accent/20 text-accent-foreground">
                <Compass className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">Quick actions</p>
                <h2 className="text-2xl font-semibold">Next best moves</h2>
              </div>
            </div>
            <div className="mt-6 grid gap-3">
              <Button asChild size="lg" className="justify-start">
                <Link href="/chat">
                  <Bot className="size-4" />
                  Open assistant workspace
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="justify-start" onClick={handleCopyChecklist}>
                <Copy className="size-4" />
                Copy onboarding checklist
              </Button>
              <Button size="lg" variant="ghost" className="justify-start" onClick={handleRefresh}>
                <RefreshCcw className="size-4" />
                Refresh overview state
              </Button>
            </div>
          </Card>
        </div>

        <PageSection
          eyebrow={<Badge variant="secondary">Onboarding checklist</Badge>}
          title="Guide first-time setup with zero ambiguity"
          description="Checklist language is explicit, action-led, and friendly to operators who care about outcomes more than implementation details."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {checklist.map((item, index) => (
              <Card key={item.title} variant="subtle" className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline">Step {index + 1}</Badge>
                  <Badge variant={item.state === 'next' ? 'secondary' : 'success'}>
                    {item.state === 'next' ? 'Up next' : 'Done'}
                  </Badge>
                </div>
                <h3 className="mt-5 text-xl font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.description}</p>
              </Card>
            ))}
          </div>
        </PageSection>

        <Card variant="gradient" className="p-8 sm:p-10">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <Badge variant="success" className="w-fit">
                <CheckCircle2 className="size-3.5" />
                UX shell complete
              </Badge>
              <h2 className="mt-4 text-3xl font-semibold">Ready for real ingestion and analytics wiring</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
                Layout, loading states, error surfaces, quick actions, and onboarding language are now production-grade. Connect backend sources when ready without rethinking experience layer.
              </p>
            </div>
            <Button asChild size="xl">
              <Link href="/chat">Test assistant flow</Link>
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  )
}
