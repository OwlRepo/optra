'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const BOTTOM_THRESHOLD_PX = 96

export function useStickToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)

  const checkNearBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return true
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    return distance < BOTTOM_THRESHOLD_PX
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    setIsNearBottom(true)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => setIsNearBottom(checkNearBottom())
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [checkNearBottom])

  return { containerRef, isNearBottom, scrollToBottom, checkNearBottom }
}
