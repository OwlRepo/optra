import { AppHeader, Badge, Card, PageShell, Skeleton } from '@repo/ui'
import { Sparkles } from 'lucide-react'

export default function ChatLoading() {
  return (
    <PageShell contentClassName="pb-16">
      <AppHeader
        className="mt-4 rounded-[calc(var(--radius)+0.5rem)] border border-border/70 bg-background/75"
        brand={<div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-md)]"><Sparkles className="size-5" /></div>}
        title="Assistant workspace"
        description="Loading conversation surface."
        badge={<Badge variant="secondary">Connecting</Badge>}
      />
      <div className="grid gap-6 pb-6 pt-10 xl:grid-cols-[1.2fr_0.8fr]">
        <Card variant="elevated" className="space-y-6 p-6">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="ml-auto h-24 w-2/3" />
          <Skeleton className="h-28 w-3/4" />
          <Skeleton className="h-12 w-full" />
        </Card>
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </PageShell>
  )
}
