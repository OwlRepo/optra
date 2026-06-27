'use client'

import { useEffect } from 'react'
import { Badge, Button, Card, PageShell } from '@repo/ui'
import { AlertTriangle, Home, RefreshCcw } from 'lucide-react'
import Link from 'next/link'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html>
      <body>
        <PageShell contentClassName="flex min-h-screen items-center py-16">
          <Card variant="elevated" className="mx-auto max-w-2xl p-8 sm:p-10">
            <Badge variant="destructive" className="w-fit">Unexpected error</Badge>
            <div className="mt-6 flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </div>
            <h1 className="mt-6 text-3xl font-semibold">Something broke in workspace</h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Interface caught failure safely. Reload this view or go back to landing page while issue is investigated.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button onClick={reset}>
                <RefreshCcw className="size-4" />
                Try again
              </Button>
              <Button asChild variant="outline">
                <Link href="/">
                  <Home className="size-4" />
                  Back to home
                </Link>
              </Button>
            </div>
          </Card>
        </PageShell>
      </body>
    </html>
  )
}
