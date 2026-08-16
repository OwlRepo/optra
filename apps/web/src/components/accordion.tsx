'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@repo/ui'

export type AccordionItem = {
  question: string
  answer: string
}

export function Accordion({ items, defaultOpenIndex = 0 }: { items: AccordionItem[]; defaultOpenIndex?: number | null }) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(defaultOpenIndex)

  return (
    <div className="divide-y divide-border border-t border-border">
      {items.map((item, index) => {
        const isOpen = openIndex === index
        return (
          <div key={item.question}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-center justify-between gap-4 py-6 text-left"
            >
              <span className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
                {item.question}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'size-5 shrink-0 text-muted-foreground transition-[transform,color] duration-300',
                  isOpen && 'rotate-180 text-primary-strong',
                )}
              />
            </button>

            <div
              className="grid transition-[grid-template-rows] duration-[320ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <p className="max-w-[68ch] pb-6 text-base leading-[1.7] text-[oklch(0.46_0.02_264)]">
                  {item.answer}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
