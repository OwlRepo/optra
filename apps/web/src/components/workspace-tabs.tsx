'use client'

import * as React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@repo/ui'

export type WorkspaceMode = {
  id: string
  label: string
  icon: React.ReactNode
  title: string
  description: string
  bullets: string[]
}

export function WorkspaceTabs({ modes }: { modes: WorkspaceMode[] }) {
  const [activeId, setActiveId] = React.useState(modes[0]?.id)
  const active = modes.find((mode) => mode.id === activeId) ?? modes[0]

  if (!active) return null

  return (
    <div className="rounded-[2rem] border border-border/70 bg-card/90 p-3 shadow-sm sm:p-4">
      <div role="tablist" aria-label="Workspace type" className="inline-flex gap-1 rounded-full bg-secondary/60 p-1">
        {modes.map((mode) => {
          const selected = mode.id === active.id
          return (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(mode.id)}
              className={cn(
                'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200',
                selected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {mode.icon}
              {mode.label}
            </button>
          )
        })}
      </div>

      <div key={active.id} className="fade-slide-in mt-6 grid gap-6 p-2 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div>
          <h3 className="text-2xl font-semibold tracking-[-0.02em]">{active.title}</h3>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{active.description}</p>
        </div>

        <ul className="space-y-3">
          {active.bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-3 text-sm leading-6">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
