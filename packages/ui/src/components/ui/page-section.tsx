import * as React from 'react'
import { cn } from '../../lib/utils'

export function PageSection({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-6', className)}>
      {(eyebrow || title || description || actions) ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            {eyebrow ? <div>{eyebrow}</div> : null}
            {title ? <div className="space-y-2">{typeof title === 'string' ? <h2 className="text-3xl font-semibold md:text-4xl">{title}</h2> : title}</div> : null}
            {description ? <div className="text-base text-muted-foreground md:text-lg">{description}</div> : null}
          </div>
          {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
