import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

type StatusVariant = 'info' | 'success' | 'error' | 'loading' | 'warning'

// Storyboard 01 C15: same anatomy as the toast, inline. r12, tone border at
// 25-30%, tone tint at 6%, 3px inset rule, 17px toned icon, ink copy.
const variantConfig: Record<StatusVariant, { icon: React.ReactNode; iconClassName: string; className: string }> = {
  info: {
    icon: <Info className="size-[17px]" aria-hidden="true" />,
    iconClassName: 'text-primary-strong',
    className: 'border-primary-strong/25 bg-primary-strong/6 inset-shadow-[3px_0_0_var(--primary-strong)]',
  },
  success: {
    icon: <CheckCircle2 className="size-[17px]" aria-hidden="true" />,
    iconClassName: 'text-primary-strong',
    className: 'border-primary-strong/25 bg-primary-strong/6 inset-shadow-[3px_0_0_var(--primary-strong)]',
  },
  error: {
    icon: <AlertTriangle className="size-[17px]" aria-hidden="true" />,
    iconClassName: 'text-destructive-tone',
    className: 'border-destructive-tone/30 bg-destructive-tone/6 inset-shadow-[3px_0_0_var(--destructive-tone)]',
  },
  warning: {
    icon: <AlertTriangle className="size-[17px]" aria-hidden="true" />,
    iconClassName: 'text-flag',
    className: 'border-flag/30 bg-flag/6 inset-shadow-[3px_0_0_var(--flag)]',
  },
  loading: {
    icon: <Loader2 className="size-[17px] animate-[spin_0.9s_linear_infinite]" aria-hidden="true" />,
    iconClassName: 'text-primary-strong',
    className: 'border-border-panel bg-card inset-shadow-[3px_0_0_var(--primary-strong)]/50',
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
        'flex flex-col gap-4 rounded-[12px] border px-4 py-[14px] text-foreground sm:flex-row sm:items-start sm:justify-between',
        config.className,
        className
      )}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-px shrink-0', config.iconClassName)}>{config.icon}</div>
        <div>
          <p className="text-[14px] font-semibold">{title}</p>
          {description ? <p className="mt-[3px] text-[14px] text-ink-body">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
