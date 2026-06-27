import { AppHeader, Badge, Card, PageShell, Skeleton } from '@repo/ui'
import { Sparkles } from 'lucide-react'

export default function DashboardLoading() {
  return (
    <PageShell contentClassName="pb-16">
      <AppHeader
        className="mt-4 rounded-[calc(var(--radius)+0.5rem)] border border-border/70 bg-background/75"
        brand={<div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-md)]"><Sparkles className="size-5" /></div>}
        title="Operations dashboard"
        description="Loading metrics and onboarding state."
        badge={<Badge variant="secondary">Syncing</Badge>}
      />
      <div className="space-y-6 pb-6 pt-10">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} variant="elevated" className="space-y-5 p-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-4 w-40" />
            </Card>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <Skeleton className="h-[26rem] w-full" />
          <Skeleton className="h-[26rem] w-full" />
        </div>
      </div>
    </PageShell>
  )
}
