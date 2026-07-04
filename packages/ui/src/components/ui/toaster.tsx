'use client'

import * as React from 'react'
import { CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

export type ToastVariant = 'default' | 'success' | 'error' | 'loading'

interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastInput extends Omit<ToastItem, 'id'> {
  id?: string
}

interface ToastContextValue {
  toasts: ToastItem[]
  toast: (input: ToastInput) => string
  updateToast: (id: string, input: Partial<ToastInput>) => void
  dismissToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

// Surface = border + background tint ONLY. Text stays a neutral high-contrast
// token (see title/description below) so copy is always readable on the tint —
// the previous same-hue foreground (e.g. loading = text-primary on bg-primary/10)
// failed contrast.
const variantSurface: Record<ToastVariant, string> = {
  default: 'border-border/70 bg-card',
  success: 'border-emerald-500/30 bg-emerald-500/10',
  error: 'border-destructive/30 bg-destructive/10',
  loading: 'border-primary/30 bg-primary/10',
}

const variantIconColor: Record<ToastVariant, string> = {
  default: 'text-muted-foreground',
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-destructive',
  loading: 'text-primary',
}

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  default: <Info className="size-4" />,
  success: <CheckCircle2 className="size-4" />,
  error: <XCircle className="size-4" />,
  loading: <Loader2 className="size-4 animate-spin" />,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const timers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearTimer = React.useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const dismissToast = React.useCallback(
    (id: string) => {
      clearTimer(id)
      setToasts((current) => current.filter((toast) => toast.id !== id))
    },
    [clearTimer]
  )

  const scheduleDismiss = React.useCallback(
    (id: string, variant?: ToastVariant, duration?: number) => {
      clearTimer(id)
      if (variant === 'loading') {
        return
      }

      const timeout = setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
        timers.current.delete(id)
      }, duration ?? 4200)

      timers.current.set(id, timeout)
    },
    [clearTimer]
  )

  const toast = React.useCallback(
    ({ id, variant = 'default', duration, ...input }: ToastInput) => {
      const nextId = id ?? crypto.randomUUID()
      setToasts((current) => [{ id: nextId, variant, duration, ...input }, ...current].slice(0, 4))
      scheduleDismiss(nextId, variant, duration)
      return nextId
    },
    [scheduleDismiss]
  )

  const updateToast = React.useCallback(
    (id: string, input: Partial<ToastInput>) => {
      setToasts((current) =>
        current.map((toast) =>
          toast.id === id ? { ...toast, ...input, id } : toast
        )
      )
      scheduleDismiss(id, input.variant, input.duration)
    },
    [scheduleDismiss]
  )

  React.useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer))
      timers.current.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, toast, updateToast, dismissToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:justify-end">
        <div className="flex w-full max-w-sm flex-col gap-3">
          {toasts.map((item) => {
            const variant = item.variant ?? 'default'

            return (
              <div
                key={item.id}
                className={cn(
                  'pointer-events-auto fade-slide-in flex items-start gap-3 rounded-3xl border px-4 py-3 text-foreground shadow-[var(--shadow-xl)] backdrop-blur-xl',
                  variantSurface[variant]
                )}
                role="status"
                aria-live="polite"
              >
                <div className={cn('mt-0.5 shrink-0', variantIconColor[variant])}>{variantIcon[variant]}</div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm font-semibold text-foreground">{item.title}</div>
                  {item.description ? (
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(item.id)}
                  className="rounded-full p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                  aria-label="Dismiss notification"
                >
                  <X className="size-4" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }

  return context
}
