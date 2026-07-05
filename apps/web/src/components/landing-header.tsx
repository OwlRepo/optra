'use client'

import * as React from 'react'
import { AppHeader, cn } from '@repo/ui'

type LandingHeaderProps = React.ComponentProps<typeof AppHeader>

export function LandingHeader({ className, ...props }: LandingHeaderProps) {
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AppHeader
      {...props}
      className={cn(
        'transition-[box-shadow,border-color] duration-300',
        scrolled ? 'shadow-lg shadow-primary/10' : 'shadow-sm',
        className,
      )}
    />
  )
}
