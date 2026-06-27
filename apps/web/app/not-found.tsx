import Link from 'next/link'
import { Badge, Button, Card, PageShell } from '@repo/ui'
import { Compass, Home, MessageSquareText } from 'lucide-react'

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
          Route does not exist yet. Use redesigned dashboard or assistant workspace to continue exploring product experience.
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
              <MessageSquareText className="size-4" />
              Open assistant
            </Link>
          </Button>
        </div>
      </Card>
    </PageShell>
  )
}
