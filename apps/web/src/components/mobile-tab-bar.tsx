'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@repo/ui'

export interface MobileTabItem {
  href: string
  label: string
  icon: React.ReactNode
  exact?: boolean
}

const TAB_CLASS =
  'flex min-h-11 flex-1 flex-col items-center gap-[3px] py-1.5 text-[11px] transition-colors duration-200'
const TAB_ACTIVE = 'font-semibold text-primary-strong'
const TAB_INACTIVE = 'font-medium text-[oklch(0.5_0.02_264)]'

export function MobileTabBar({
  items,
  moreActive,
  onMoreClick,
}: {
  items: MobileTabItem[]
  moreActive: boolean
  onMoreClick: () => void
}) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/90 px-1 pb-[max(26px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-[16px] lg:hidden"
    >
      {items.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname?.startsWith(`${item.href}/`)

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(TAB_CLASS, isActive ? TAB_ACTIVE : TAB_INACTIVE)}
          >
            <span className="inline-flex" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
            {isActive ? (
              <span data-nav-indicator="dot" aria-hidden="true" className="size-1 rounded-full bg-primary-strong" />
            ) : null}
          </Link>
        )
      })}
      <button
        type="button"
        aria-label="More"
        aria-pressed={moreActive}
        onClick={onMoreClick}
        className={cn(TAB_CLASS, 'border-0 bg-transparent', moreActive ? TAB_ACTIVE : TAB_INACTIVE)}
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
        More
      </button>
    </nav>
  )
}
