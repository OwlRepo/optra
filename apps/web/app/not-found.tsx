// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets and
// Insights are hidden from the UI. Their pages, BFF routes, API and jobs still
// exist and are tested. To re-enable: uncomment every line tagged
// [support-surfaces-off] in this file and restore each "was:" value noted there.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

import Link from 'next/link'
import { Badge, Button, Card, PageShell } from '@repo/ui'
// [support-surfaces-off] was: import { Compass, Home, MessageSquareText } from 'lucide-react'
import { BriefcaseBusiness, Compass, Home } from 'lucide-react'

export default function NotFound() {
  return (
    <PageShell contentClassName="flex min-h-screen items-center py-16">
      <Card variant="gradient" className="mx-auto max-w-2xl p-8 text-center sm:p-12">
        <Badge variant="outline" className="mx-auto w-fit">404</Badge>
        <div className="mx-auto mt-6 flex size-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
          <Compass className="size-7" />
        </div>
        <h1 className="mt-6 text-4xl font-semibold">Page not found</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">
          {/* [support-surfaces-off] was: Route does not exist yet. Use redesigned dashboard or assistant workspace to continue exploring product experience. */}
          This page does not exist. Go home or open your workspace to continue.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/">
              <Home className="size-4" />
              Go home
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/chat">
              {/* [support-surfaces-off] was: <MessageSquareText className="size-4" /> Open assistant */}
              <BriefcaseBusiness className="size-4" />
              Open workspace
            </Link>
          </Button>
        </div>
      </Card>
    </PageShell>
  )
}
