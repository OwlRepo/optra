'use client'

import * as React from 'react'
import { cn } from '@repo/ui'
import { prefersReducedMotion, useInView } from '@/hooks/use-in-view'

type CountUpProps = {
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  duration?: number
  className?: string
}

const raf = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number

const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout

export function CountUp({ value, prefix = '', suffix = '', decimals = 0, duration = 1200, className }: CountUpProps) {
  const { ref, inView } = useInView<HTMLSpanElement>({ threshold: 0.4 })
  const [display, setDisplay] = React.useState(0)
  const started = React.useRef(false)

  React.useEffect(() => {
    if (!inView || started.current) return
    started.current = true

    if (prefersReducedMotion()) {
      setDisplay(value)
      return
    }

    const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
    let frame: number

    const tick = (now: number) => {
      const elapsed = (typeof performance !== 'undefined' ? now : Date.now()) - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(value * eased)
      if (progress < 1) {
        frame = raf(tick)
      }
    }

    frame = raf(tick)
    return () => caf(frame)
  }, [inView, value, duration])

  return (
    <span ref={ref} data-numeric className={cn('tabular-nums', className)}>
      {prefix}
      {display.toFixed(decimals)}
      {suffix}
    </span>
  )
}
