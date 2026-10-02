'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, Eyebrow } from '@repo/ui'
import { RefreshCcw } from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'

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
        <div className="min-h-screen bg-background leading-[normal]">
          <header className="flex items-center gap-2.5 border-b border-border px-5 py-3.5 sm:px-8">
            <BrandMark decorative className="size-[26px]" />
            <span className="font-display text-[19px] font-semibold tracking-[-0.04em] text-foreground">Optra</span>
          </header>
          <main className="px-5 py-16 sm:px-12">
            <Eyebrow rule tone="red">
              Unexpected error
            </Eyebrow>
            <h1 className="mt-5 text-[48px] leading-[1.02]">Something broke on this page</h1>
            <p className="mt-[18px] max-w-[42ch] text-[17px] leading-[1.65] text-ink-body">
              The error was caught and nothing was saved half-way. Try again, or go back home while we look into it.
            </p>
            <div className="mt-[30px] flex flex-wrap gap-3">
              <Button onClick={reset} className="h-auto gap-2.5 rounded-[14px] px-[22px] py-3.5 text-[15px]">
                <RefreshCcw className="size-4" aria-hidden="true" />
                Try again
              </Button>
              <Button asChild variant="outline" className="h-auto rounded-[14px] px-[22px] py-3.5 text-[15px]">
                <Link href="/">Back to home</Link>
              </Button>
            </div>
          </main>
        </div>
      </body>
    </html>
  )
}
