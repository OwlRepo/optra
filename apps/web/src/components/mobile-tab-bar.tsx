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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl backdrop-saturate-150 lg:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {items.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname?.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-150 active:scale-95',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className={cn('flex size-6 items-center justify-center transition-transform duration-150', isActive && 'scale-110')}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          )
        })}
        <button
          type="button"
          aria-label="More"
          aria-pressed={moreActive}
          onClick={onMoreClick}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-150 active:scale-95',
            moreActive ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <span className={cn('flex size-6 items-center justify-center transition-transform duration-150', moreActive && 'scale-110')}>
            <MoreHorizontal className="size-5" />
          </span>
          More
        </button>
      </div>
    </nav>
  )
}
