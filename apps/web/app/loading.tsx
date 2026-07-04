import { AppHeader, Badge, Card, PageShell, Skeleton } from '@repo/ui'
import { BrandMark } from '@/components/brand-mark'

export default function RootLoading() {
  return (
    <PageShell contentClassName="pb-16">
      <AppHeader
        className="mt-4 rounded-2xl border border-border/70 bg-background/75"
        brand={<BrandMark decorative className="size-11" />}
        title="Loading workspace"
        description="Preparing polished product shell."
        badge={<Badge variant="secondary">Please wait</Badge>}
      />
      <div className="space-y-6 pb-6 pt-10">
        <Skeleton className="h-12 w-48" />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} variant="elevated" className="space-y-5 p-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-40" />
            </Card>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Skeleton className="h-[28rem] w-full" />
          <Skeleton className="h-[28rem] w-full" />
        </div>
      </div>
    </PageShell>
  )
}
