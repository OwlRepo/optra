'use client'

import * as React from 'react'
import { cn } from '@repo/ui'
import { useInView } from '@/hooks/use-in-view'

type RevealProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'ref'> & {
  delay?: number
  distance?: number
}

export function Reveal({ children, className, delay = 0, distance = 24, style, ...props }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.15, rootMargin: '-40px 0px' })

  return (
    <div
      ref={ref}
      data-inview={inView}
      className={cn(
        'transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform',
        inView ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={{
        transitionDelay: inView ? `${delay}ms` : '0ms',
        transform: inView ? 'translateY(0px)' : `translateY(${distance}px)`,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}
