'use client'

import * as React from 'react'
import { cn } from '@repo/ui'
import { prefersReducedMotion, useInView } from '@/hooks/use-in-view'

type TypingTextProps = {
  text: string
  className?: string
  speed?: number
}

export function TypingText({ text, className, speed = 18 }: TypingTextProps) {
  const { ref, inView } = useInView<HTMLParagraphElement>({ threshold: 0.3 })
  const [count, setCount] = React.useState(0)
  const started = React.useRef(false)

  React.useEffect(() => {
    if (!inView || started.current) return
    started.current = true

    if (prefersReducedMotion()) {
      setCount(text.length)
      return
    }

    let i = 0
    const id = setInterval(() => {
      i += 1
      setCount(i)
      if (i >= text.length) clearInterval(id)
    }, speed)

    return () => clearInterval(id)
  }, [inView, text, speed])

  const done = count >= text.length

  return (
    <p ref={ref} className={className}>
      <span aria-hidden="true">
        {text.slice(0, count)}
        <span
          className={cn(
            'ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-primary',
            done ? 'animate-pulse' : 'opacity-100',
          )}
        />
      </span>
      <span className="sr-only">{text}</span>
    </p>
  )
}
