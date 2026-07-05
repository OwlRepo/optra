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
    <div className="divide-y divide-border/70 overflow-hidden rounded-[2rem] border border-border/70 bg-card/60">
      {items.map((item, index) => {
        const isOpen = openIndex === index
        return (
          <div key={item.question}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-center justify-between gap-4 p-6 text-left"
            >
              <span className="text-lg font-semibold tracking-[-0.01em]">{item.question}</span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'size-5 shrink-0 text-muted-foreground transition-transform duration-300',
                  isOpen && 'rotate-180 text-primary',
                )}
              />
            </button>

            <div
              className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <p className="px-6 pb-6 text-sm leading-7 text-muted-foreground">{item.answer}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
