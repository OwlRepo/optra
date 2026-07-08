'use client'

import * as React from 'react'
import SplitText from '../SplitText'

/**
 * Renders `text` as plain content once `active` is false (e.g. after streaming
 * finishes, the caller switches to full Markdown rendering). While `active`,
 * each newly-arrived slice of `text` (since the last render) mounts as its own
 * SplitText instance keyed by arrival order, so only the NEW words animate in
 * -- already-rendered chunks keep a stable key/text and never re-animate.
 */
export function StreamingText({
  text,
  active,
  className,
}: {
  text: string
  active: boolean
  className?: string
}) {
  const [chunks, setChunks] = React.useState<string[]>([])
  const lengthRef = React.useRef(0)

  React.useEffect(() => {
    if (!active) {
      setChunks([])
      lengthRef.current = 0
      return
    }

    if (text.length < lengthRef.current) {
      lengthRef.current = text.length
      setChunks([text])
      return
    }

    if (text.length > lengthRef.current) {
      const delta = text.slice(lengthRef.current)
      lengthRef.current = text.length
      setChunks((current) => [...current, delta])
    }
  }, [text, active])

  if (!active) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={className}>
      {chunks.map((chunk, index) => (
        <SplitText
          key={index}
          text={chunk}
          tag="span"
          splitType="words"
          duration={0.5}
          delay={20}
          from={{ opacity: 0, y: 8 }}
          to={{ opacity: 1, y: 0 }}
          threshold={0}
          rootMargin="0px"
          textAlign="left"
          className="inline whitespace-pre-wrap"
        />
      ))}
    </span>
  )
}
