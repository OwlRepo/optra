import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

type StatusVariant = 'info' | 'success' | 'error' | 'loading'

const variantConfig: Record<StatusVariant, { icon: React.ReactNode; className: string }> = {
  info: {
    icon: <Info className="size-4" />,
    className: 'border-primary/15 bg-primary/10 text-primary',
  },
  success: {
    icon: <CheckCircle2 className="size-4" />,
    className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  error: {
    icon: <AlertTriangle className="size-4" />,
    className: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  loading: {
    icon: <Loader2 className="size-4 animate-spin" />,
    className: 'border-border/70 bg-secondary text-secondary-foreground',
  },
}

export function StatusBanner({
  title,
  description,
  variant = 'info',
  action,
  className,
}: {
  title: string
  description?: string
  variant?: StatusVariant
  action?: React.ReactNode
  className?: string
}) {
  const config = variantConfig[variant]

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-[calc(var(--radius)+0.25rem)] border px-4 py-4 sm:flex-row sm:items-start sm:justify-between',
        config.className,
        className
      )}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{config.icon}</div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          {description ? <p className="text-sm opacity-80">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
