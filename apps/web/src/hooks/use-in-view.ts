'use client'

import { useEffect, useRef, useState } from 'react'

export const REVEAL_FALLBACK_MS = 2600

export function useInView<T extends HTMLElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    // Safety net: if the observer never fires -- a mis-tuned rootMargin, a
    // browser quirk, a container that never scrolls -- reveal anyway rather
    // than leaving content stranded at opacity 0. This can only ever flip
    // inView false -> true earlier, never hide something already shown.
    const fallback = setTimeout(() => setInView(true), REVEAL_FALLBACK_MS)

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true)
        observer.disconnect()
      }
    }, options)

    observer.observe(node)
    return () => {
      clearTimeout(fallback)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ref, inView }
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
