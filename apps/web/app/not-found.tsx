// [support-surfaces-off] 2026-10-02: Knowledge Bases, Datasets, Chat, Tickets and
// Insights are hidden from the UI. Their pages, BFF routes, API and jobs still
// exist and are tested. To re-enable: uncomment every line tagged
// [support-surfaces-off] in this file and restore each "was:" value noted there.
// Repo checklist: grep -rn "support-surfaces-off" apps/web apps/e2e

import Link from 'next/link'
import { Button, Eyebrow } from '@repo/ui'
// [support-surfaces-off] was: import { Compass, Home, MessageSquareText } from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background leading-[normal]">
      <header className="flex items-center gap-2.5 border-b border-border px-5 py-3.5 sm:px-8">
        <BrandMark decorative className="size-[26px]" />
        <span className="font-display text-[19px] font-semibold tracking-[-0.04em] text-foreground">Optra</span>
      </header>
      <main className="px-5 py-16 sm:px-12">
        <Eyebrow rule>404 · not found</Eyebrow>
        <h1 className="mt-5 text-[48px] leading-[1.02]">Page not found</h1>
        <p className="mt-[18px] max-w-[40ch] text-[17px] leading-[1.65] text-ink-body">
          {/* [support-surfaces-off] was: Route does not exist yet. Use redesigned dashboard or assistant workspace to continue exploring product experience. */}
          This page does not exist. Go home or open your workspace to continue.
        </p>
        <div className="mt-[30px] flex flex-wrap gap-3">
          <Button asChild className="h-auto gap-2.5 rounded-[14px] px-[22px] py-3.5 text-[15px]">
            <Link href="/workspaces">
              {/* [support-surfaces-off] was: <MessageSquareText className="size-4" /> Open assistant (href /chat) */}
              Open workspace <span aria-hidden="true">→</span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-auto rounded-[14px] px-[22px] py-3.5 text-[15px]">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
